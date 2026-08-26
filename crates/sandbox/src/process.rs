//! Guarded child-process lifecycle shared by the non-isolating backend and
//! the OS-wrapper backends.
//!
//! [`run_scrubbed_child`] provides real lifecycle guarantees — cleared
//! environment, allowlisted variables, mapped working directory, wall-clock
//! deadline kill and bounded output capture. [`GuardedProcessBackend`] wraps
//! it without any filesystem or network confinement claim: its descriptor
//! caps it at S1 and the registry never selects it for confined children
//! (ADR-008).

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{ChildStderr, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::environment::{RedactableValue, build_environment};
use crate::plan::{BudgetSpec, CommandSpec, EnvSpec, MountSource, MountSpec};
use crate::spi::{
    BackendDescriptor, DestroyReport, EnforcedCapabilities, ExecOutcome, HealthReport,
    LifecycleCaps, Platform, RealmHandle, SPI_VERSION, SandboxBackend, SandboxError,
    SnapshotRecord,
};
use sha2::{Digest, Sha256};

/// Run one scrubbed child process with deadline kill and bounded capture.
///
/// The caller supplies host-resolved paths; confinement, when required, must
/// come from `wrapper_argv` (for example a `bwrap`/`sandbox-exec` prefix).
///
/// # Errors
///
/// Fails closed on spawn, I/O or lifecycle failure.
#[allow(clippy::too_many_arguments)]
pub fn run_scrubbed_child(
    host_argv: &[String],
    host_cwd: &Path,
    env: &EnvSpec,
    mounts: &[MountSpec],
    budget: BudgetSpec,
    injected: &BTreeMap<String, RedactableValue>,
    stdin_payload: Option<&[u8]>,
    wrapper_argv: &[String],
) -> Result<ExecOutcome, SandboxError> {
    let started = Instant::now();
    let environment =
        build_environment(env, mounts, injected).map_err(|_| SandboxError::PlanViolation)?;
    let mut full_argv: Vec<String> = wrapper_argv.to_vec();
    full_argv.extend_from_slice(host_argv);
    let mut process = Command::new(&full_argv[0]);
    process
        .args(&full_argv[1..])
        .env_clear()
        .envs(&environment)
        .current_dir(host_cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        process.process_group(0);
    }
    let mut child = process.spawn().map_err(|_| SandboxError::ExecFailed)?;
    if let Some(payload) = stdin_payload {
        if let Some(stdin) = child.stdin.take() {
            let mut stdin = stdin;
            let capped = &payload[..payload.len().min(budget.max_stdin_bytes)];
            stdin
                .write_all(capped)
                .map_err(|_| SandboxError::ExecFailed)?;
            drop(stdin);
        }
    } else {
        drop(child.stdin.take());
    }
    let shared = Arc::new(Mutex::new(child));
    let watcher_shared = Arc::clone(&shared);
    let killed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let watcher_killed = Arc::clone(&killed);
    let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let watcher_finished = Arc::clone(&finished);
    let deadline = Duration::from_millis(budget.wall_clock_ms);
    let watcher = std::thread::spawn(move || {
        let started = Instant::now();
        while !watcher_finished.load(std::sync::atomic::Ordering::Acquire) {
            if started.elapsed() >= deadline {
                if let Ok(mut guard) = watcher_shared.lock() {
                    let running = guard.try_wait().is_ok_and(|status| status.is_none());
                    if running {
                        let _ = guard.kill();
                        watcher_killed.store(true, std::sync::atomic::Ordering::Release);
                    }
                }
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    });
    let mut stdout_pipe: Option<ChildStdout> = None;
    let mut stderr_pipe: Option<ChildStderr> = None;
    if let Ok(mut guard) = shared.lock() {
        stdout_pipe = guard.stdout.take();
        stderr_pipe = guard.stderr.take();
    }
    let (stdout, stdout_truncated) = read_capped(&mut stdout_pipe, budget.max_output_bytes);
    let (stderr, stderr_truncated) = read_capped(&mut stderr_pipe, budget.max_output_bytes);
    let status = if let Ok(mut guard) = shared.lock() {
        let status = guard.wait().map_err(|_| SandboxError::ExecFailed)?;
        finished.store(true, std::sync::atomic::Ordering::Release);
        let _ = watcher.join();
        status
    } else {
        return Err(SandboxError::ExecFailed);
    };
    Ok(ExecOutcome {
        exit_code: status.code(),
        stdout,
        stderr,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        truncated: stdout_truncated || stderr_truncated,
        killed: killed.load(std::sync::atomic::Ordering::Acquire),
    })
}

/// Test-only entry that exposes [`run_scrubbed_child`] for lifecycle and
/// environment canary tests. Production selection never routes through it.
///
/// # Errors
///
/// Mirrors [`run_scrubbed_child`].
#[cfg(test)]
pub fn scrubbed_child_probe_for_tests(
    host_argv: &[String],
    env: &EnvSpec,
    mounts: &[MountSpec],
    budget: BudgetSpec,
    injected: &BTreeMap<String, RedactableValue>,
) -> Result<ExecOutcome, SandboxError> {
    run_scrubbed_child(
        host_argv,
        &std::env::temp_dir(),
        env,
        mounts,
        budget,
        injected,
        None,
        &[],
    )
}

struct RealmState {
    plan: crate::plan::ValidatedPlan,
    host_mounts: BTreeMap<String, PathBuf>,
}

/// Non-isolating guarded backend, admissible only for S0/S1 plans.
pub struct GuardedProcessBackend {
    descriptor: BackendDescriptor,
    realms: BTreeMap<String, RealmState>,
    counter: u64,
}

impl GuardedProcessBackend {
    /// Construct the backend for one platform.
    #[must_use]
    pub fn new(platform: Platform) -> Self {
        Self {
            descriptor: BackendDescriptor {
                backend_id: "process://guarded-v1".to_owned(),
                platform,
                spi_version: SPI_VERSION.to_owned(),
                enforced: EnforcedCapabilities {
                    filesystem: None,
                    network: None,
                    environment_scrubbed: true,
                    lifecycle: LifecycleCaps {
                        deadline_kill: true,
                        output_cap: true,
                        orphan_reap: false,
                    },
                },
                max_realm: crate::plan::Realm::S1GuardedRead,
                isolation_self_tested: true,
                production: true,
            },
            realms: BTreeMap::new(),
            counter: 0,
        }
    }

    fn next_id(&mut self) -> String {
        self.counter += 1;
        format!("guarded-realm-{:08}", self.counter)
    }
}

/// Map a realm-internal path to its host counterpart using declared mounts.
///
/// # Errors
///
/// Rejects unmapped prefixes and `..` segments.
pub fn map_realm_path(
    host_mounts: &BTreeMap<String, PathBuf>,
    realm_path: &str,
) -> Result<PathBuf, SandboxError> {
    let normalized = realm_path.trim_start_matches('/');
    let mut best: Option<(&String, &PathBuf)> = None;
    for (target, host) in host_mounts {
        let prefix = format!("{target}/");
        if (normalized.starts_with(&prefix) || normalized == target.as_str())
            && best.is_none_or(|(existing, _)| existing.len() < target.len())
        {
            best = Some((target, host));
        }
    }
    let Some((target, host)) = best else {
        return Err(SandboxError::PlanViolation);
    };
    let remainder = normalized
        .strip_prefix(target.as_str())
        .unwrap_or_default()
        .trim_start_matches('/');
    if remainder.split('/').any(|segment| segment == "..") || remainder.contains('\0') {
        return Err(SandboxError::PlanViolation);
    }
    let path = host.join(remainder);
    if !path.starts_with(host) {
        return Err(SandboxError::PlanViolation);
    }
    Ok(path)
}

/// Derive the host mount table of a validated plan.
#[must_use]
pub fn host_mounts_of(plan: &crate::plan::ValidatedPlan) -> BTreeMap<String, PathBuf> {
    plan.plan
        .mounts
        .iter()
        .map(|mount| {
            (
                mount.target.clone(),
                match &mount.source {
                    MountSource::Workspace { host_path }
                    | MountSource::Overlay { host_path }
                    | MountSource::SystemTools { host_path } => host_path.clone(),
                    MountSource::Temporary => std::env::temp_dir(),
                },
            )
        })
        .collect()
}

impl SandboxBackend for GuardedProcessBackend {
    fn descriptor(&self) -> &BackendDescriptor {
        &self.descriptor
    }

    fn health(&mut self) -> HealthReport {
        HealthReport::healthy()
    }

    fn create(&mut self, plan: &crate::plan::ValidatedPlan) -> Result<RealmHandle, SandboxError> {
        if plan.plan.command.is_some() {
            // This backend makes no isolation claim; confined or even
            // unconfined children are not admissible through it.
            return Err(SandboxError::BackendUnavailable);
        }
        let realm_id = self.next_id();
        let handle = RealmHandle {
            realm_id: realm_id.clone(),
            plan_digest: plan.digest.clone(),
        };
        self.realms.insert(
            realm_id,
            RealmState {
                plan: plan.clone(),
                host_mounts: host_mounts_of(plan),
            },
        );
        Ok(handle)
    }

    fn mount(&mut self, handle: &RealmHandle, mount: &MountSpec) -> Result<(), SandboxError> {
        let state = self
            .realms
            .get(&handle.realm_id)
            .filter(|state| state.plan.digest == handle.plan_digest)
            .ok_or(SandboxError::InvalidHandle)?;
        if !state
            .plan
            .plan
            .mounts
            .iter()
            .any(|declared| declared == mount)
        {
            return Err(SandboxError::PlanViolation);
        }
        Ok(())
    }

    fn network(
        &mut self,
        handle: &RealmHandle,
        spec: &crate::plan::NetworkSpec,
    ) -> Result<(), SandboxError> {
        let state = self
            .realms
            .get(&handle.realm_id)
            .filter(|state| state.plan.digest == handle.plan_digest)
            .ok_or(SandboxError::InvalidHandle)?;
        if &state.plan.plan.network != spec {
            return Err(SandboxError::PlanViolation);
        }
        if matches!(spec, crate::plan::NetworkSpec::Mediated { .. }) {
            return Err(SandboxError::BackendUnavailable);
        }
        Ok(())
    }

    fn exec(
        &mut self,
        handle: &RealmHandle,
        _command: &CommandSpec,
        _injected: BTreeMap<String, RedactableValue>,
    ) -> Result<ExecOutcome, SandboxError> {
        let known = self.realms.contains_key(&handle.realm_id)
            && self
                .realms
                .get(&handle.realm_id)
                .is_some_and(|state| state.plan.digest == handle.plan_digest);
        if !known {
            return Err(SandboxError::InvalidHandle);
        }
        // Unconfined child execution is never admissible here.
        Err(SandboxError::BackendUnavailable)
    }

    fn kill(&mut self, _handle: &RealmHandle) -> Result<(), SandboxError> {
        Ok(())
    }

    fn snapshot(&mut self, handle: &RealmHandle) -> Result<SnapshotRecord, SandboxError> {
        let state = self
            .realms
            .get(&handle.realm_id)
            .filter(|state| state.plan.digest == handle.plan_digest)
            .ok_or(SandboxError::InvalidHandle)?;
        let mut hasher = Sha256::new();
        hasher.update(handle.realm_id.as_bytes());
        hasher.update(state.plan.digest.as_bytes());
        for (target, host) in &state.host_mounts {
            hasher.update(target.as_bytes());
            hasher.update(structural_inventory(host));
        }
        Ok(SnapshotRecord {
            snapshot_id: format!("sha256:{}", crate::hex_upper(&hasher.finalize())),
            realm_id: handle.realm_id.clone(),
        })
    }

    fn destroy(&mut self, handle: &RealmHandle) -> Result<DestroyReport, SandboxError> {
        self.realms
            .remove(&handle.realm_id)
            .map(|_| DestroyReport {
                realm_id: handle.realm_id.clone(),
                killed_processes: 0,
            })
            .ok_or(SandboxError::InvalidHandle)
    }
}

fn read_capped<R: std::io::Read>(stream: &mut Option<R>, cap: usize) -> (Vec<u8>, bool) {
    let mut buffer = vec![0_u8; 4096];
    let mut collected = Vec::new();
    let mut truncated = false;
    let Some(stream) = stream.as_mut() else {
        return (collected, truncated);
    };
    loop {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                if collected.len() + read > cap {
                    let room = cap.saturating_sub(collected.len());
                    collected.extend_from_slice(&buffer[..room]);
                    truncated = true;
                    break;
                }
                collected.extend_from_slice(&buffer[..read]);
            }
        }
    }
    (collected, truncated)
}

fn structural_inventory(host: &Path) -> Vec<u8> {
    let mut names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(host) {
        for entry in entries.flatten() {
            names.extend_from_slice(entry.file_name().to_string_lossy().as_bytes());
            names.push(0);
        }
    }
    names.sort_unstable();
    names
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::items_after_statements
    )]
    use std::collections::BTreeMap;

    use super::*;
    use crate::plan::{EnvSpec, MountSource, MountSpec, SandboxPlan};

    #[test]
    fn any_child_plan_is_refused_fail_closed() {
        let temp = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
        let plan = SandboxPlan {
            version: 1,
            workspace_id: "ws_01".to_owned(),
            realm: crate::plan::Realm::S2IsolatedReadOnly,
            mounts: vec![MountSpec {
                target: "tools".to_owned(),
                source: MountSource::SystemTools {
                    host_path: temp.path().to_owned(),
                },
                writable: false,
                executable: true,
            }],
            env: EnvSpec::default(),
            budget: BudgetSpec::default_budget(),
            network: crate::plan::NetworkSpec::Denied,
            command: Some(CommandSpec {
                argv: vec!["/tools/bin/true".to_owned()],
                cwd: "/tools".to_owned(),
                stdin: None,
            }),
        }
        .validate()
        .unwrap_or_else(|error| unreachable!("{error}"));
        let mut backend = GuardedProcessBackend::new(Platform::Linux);
        assert_eq!(
            backend.create(&plan).unwrap_err(),
            SandboxError::BackendUnavailable
        );
    }

    #[cfg(unix)]
    #[test]
    fn environment_canary_finds_no_sensitive_host_authority() {
        use std::fs;
        let temp = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
        let probe = temp.path().join("probe.sh");
        fs::write(&probe, "#!/bin/sh\nenv | sort\nsleep 30\n")
            .unwrap_or_else(|error| unreachable!("{error}"));
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&probe, fs::Permissions::from_mode(0o755))
            .unwrap_or_else(|error| unreachable!("{error}"));

        let mut env_spec = EnvSpec::default();
        env_spec
            .allow
            .insert("SABER_PROBE".to_owned(), "canary".to_owned());
        let mounts = vec![MountSpec {
            target: "tools".to_owned(),
            source: MountSource::SystemTools {
                host_path: temp.path().to_owned(),
            },
            writable: false,
            executable: true,
        }];
        let outcome = scrubbed_child_probe_for_tests(
            &[temp.path().join("probe.sh").to_string_lossy().into_owned()],
            &env_spec,
            &mounts,
            BudgetSpec {
                wall_clock_ms: 3_000,
                ..BudgetSpec::default_budget()
            },
            &BTreeMap::new(),
        )
        .unwrap_or_else(|error| unreachable!("{error}"));
        assert!(outcome.killed, "deadline must kill the sleeping probe");
        assert_eq!(outcome.exit_code, None);
        let stdout = String::from_utf8_lossy(&outcome.stdout).into_owned();
        assert!(stdout.contains("SABER_PROBE=canary"));
        for forbidden in [
            "HOME=",
            "SSH_AUTH_SOCK=",
            "USER=",
            "LOGNAME=",
            "TOKEN=",
            "SECRET=",
            "PASSWORD=",
        ] {
            let leaked = stdout
                .lines()
                .any(|line| line.starts_with(forbidden) || line.contains(forbidden));
            assert!(!leaked, "canary leaked {forbidden}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn environment_canary_finds_no_sensitive_host_authority() {
        let mut env_spec = EnvSpec::default();
        env_spec
            .allow
            .insert("SABER_PROBE".to_owned(), "canary".to_owned());
        let outcome = scrubbed_child_probe_for_tests(
            &["cmd".to_owned(), "/c".to_owned(), "set".to_owned()],
            &env_spec,
            &[],
            BudgetSpec::default_budget(),
            &BTreeMap::new(),
        )
        .unwrap_or_else(|error| unreachable!("{error}"));
        let stdout = String::from_utf8_lossy(&outcome.stdout).to_ascii_uppercase();
        assert!(stdout.contains("SABER_PROBE=CANARY"));
        for forbidden in [
            "HOME=",
            "USERPROFILE=",
            "SSH_AUTH_SOCK=",
            "TOKEN=",
            "SECRET=",
            "PASSWORD=",
        ] {
            assert!(!stdout.contains(forbidden), "canary leaked {forbidden}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn output_cap_truncates_large_streams() {
        use std::fs;
        let temp = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
        let probe = temp.path().join("flood.sh");
        let spam = "spam".repeat(64);
        fs::write(
            &probe,
            format!("#!/bin/sh\nbig='{spam}'\nwhile :; do echo \"$big\"; done\n"),
        )
        .unwrap_or_else(|error| unreachable!("{error}"));
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&probe, fs::Permissions::from_mode(0o755))
            .unwrap_or_else(|error| unreachable!("{error}"));
        let outcome = scrubbed_child_probe_for_tests(
            &[temp.path().join("flood.sh").to_string_lossy().into_owned()],
            &EnvSpec::default(),
            &[],
            BudgetSpec {
                wall_clock_ms: 1_000,
                max_output_bytes: 4_096,
                max_stdin_bytes: 1 << 16,
            },
            &BTreeMap::new(),
        )
        .unwrap_or_else(|error| unreachable!("{error}"));
        assert!(outcome.truncated);
        assert!(outcome.stdout.len() <= 4_096);
    }
}
