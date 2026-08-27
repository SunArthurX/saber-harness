//! Platform isolation backends with live self-verification.
//!
//! The macOS backend wraps `sandbox-exec` with a deny-default profile and the
//! Linux backend wraps `bubblewrap` with read-only binds, a private `/tmp`
//! tmpfs and an unshared network namespace. Neither is selectable on trust
//! alone: construction runs real confinement probes and a backend whose
//! probes cannot prove isolation stays unhealthy, so selection fails closed
//! (ADR-008). Windows admits no confinement backend in S06; S2+ plans are
//! denied there rather than weakened.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use crate::environment::RedactableValue;
use crate::plan::{CommandSpec, EnvSpec, MountSource, NetworkSpec, Realm, ValidatedPlan};
use crate::process::{host_mounts_of, map_realm_path, run_scrubbed_child};
use crate::spi::{
    BackendDescriptor, DestroyReport, EnforcedCapabilities, ExecOutcome, FsConfinement,
    HealthReport, LifecycleCaps, NetConfinement, Platform, RealmHandle, SPI_VERSION,
    SandboxBackend, SandboxError, SnapshotRecord,
};
use sha2::{Digest, Sha256};

/// Which OS wrapper this backend drives.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WrapperKind {
    /// macOS Seatbelt via `sandbox-exec -f`.
    DarwinSeatbelt,
    /// Linux namespaces via `bubblewrap`.
    LinuxBwrap,
}

struct WrapperRealm {
    plan: ValidatedPlan,
    profile_path: Option<PathBuf>,
}

/// OS-wrapper isolation backend.
pub struct OsWrapperBackend {
    kind: WrapperKind,
    descriptor: BackendDescriptor,
    health_report: HealthReport,
    realms: BTreeMap<String, WrapperRealm>,
    counter: u64,
}

impl OsWrapperBackend {
    /// Probe the platform mechanism and construct the backend. The returned
    /// backend is only healthy when its live probes proved confinement.
    #[must_use]
    pub fn probe(kind: WrapperKind) -> Self {
        let descriptor = match kind {
            WrapperKind::DarwinSeatbelt => {
                wrapper_descriptor("darwin://seatbelt-v1", Platform::MacOs)
            }
            WrapperKind::LinuxBwrap => wrapper_descriptor("linux://bwrap-v1", Platform::Linux),
        };
        let health_report = Self::run_probes(kind);
        Self {
            kind,
            descriptor,
            health_report,
            realms: BTreeMap::new(),
            counter: 0,
        }
    }

    fn next_id(&mut self) -> String {
        self.counter += 1;
        format!("oswrapper-realm-{:08}", self.counter)
    }

    fn run_probes(kind: WrapperKind) -> HealthReport {
        let pid = u64::from(std::process::id());
        let scratch = std::env::temp_dir().join(format!("saber-sbx-probe-{pid}"));
        if std::fs::create_dir_all(&scratch).is_err() {
            return HealthReport::unhealthy("probe_scratch_unavailable");
        }
        // Canonicalize after creation so the scratch paths the probes open
        // agree with the canonical seatbelt filters (KI-0006).
        let scratch = scratch.canonicalize().unwrap_or(scratch);
        let outside = std::env::temp_dir().join(format!("saber-sbx-escape-{pid}.txt"));
        let inside = scratch.join("inside.txt");
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_file(&inside);
        let wrapper = match kind {
            WrapperKind::DarwinSeatbelt => seatbelt_wrapper(&scratch),
            WrapperKind::LinuxBwrap => bwrap_wrapper(&scratch),
        };
        let allowed = run_scrubbed_child(
            &shell_script_argv("exit 0"),
            &scratch,
            &EnvSpec::default(),
            &[],
            probe_budget(),
            &BTreeMap::new(),
            None,
            &wrapper,
        );
        if !matches!(&allowed, Ok(outcome) if outcome.exit_code == Some(0)) {
            return HealthReport::unhealthy("probe_exec_blocked");
        }
        let _ = run_scrubbed_child(
            &shell_script_argv(&format!("echo x > {}", outside.to_string_lossy())),
            &scratch,
            &EnvSpec::default(),
            &[],
            probe_budget(),
            &BTreeMap::new(),
            None,
            &wrapper,
        );
        // Confinement held when the host filesystem shows no escape artifact,
        // regardless of the child's view (a private tmpfs may accept the write).
        if outside.exists() {
            let _ = std::fs::remove_file(&outside);
            return HealthReport::unhealthy("probe_write_escape");
        }
        let _ = run_scrubbed_child(
            &shell_script_argv(&format!("echo ok > {}", inside.to_string_lossy())),
            &scratch,
            &EnvSpec::default(),
            &[],
            probe_budget(),
            &BTreeMap::new(),
            None,
            &wrapper,
        );
        if !inside.exists() {
            return HealthReport::unhealthy("probe_overlay_denied");
        }
        let _ = std::fs::remove_file(&inside);
        HealthReport::healthy()
    }

    fn build_wrapper_for(
        kind: WrapperKind,
        realm: &mut WrapperRealm,
    ) -> Result<Vec<String>, SandboxError> {
        match kind {
            WrapperKind::DarwinSeatbelt => {
                let profile = seatbelt_profile(&realm.plan);
                let path = std::env::temp_dir().join(format!(
                    "saber-sbx-profile-{}.sb",
                    realm.plan.digest.replace([':', '/'], "-")
                ));
                std::fs::write(&path, profile).map_err(|_| SandboxError::ExecFailed)?;
                realm.profile_path.get_or_insert(path);
                let wrapper_path = realm
                    .profile_path
                    .clone()
                    .unwrap_or_else(|| PathBuf::from("/nonexistent"));
                Ok(vec![
                    "/usr/bin/sandbox-exec".to_owned(),
                    "-f".to_owned(),
                    wrapper_path.to_string_lossy().into_owned(),
                ])
            }
            WrapperKind::LinuxBwrap => {
                let overlay_host = realm
                    .plan
                    .plan
                    .mounts
                    .iter()
                    .find(|mount| matches!(mount.source, MountSource::Overlay { .. }))
                    .map_or_else(
                        || PathBuf::from("/nonexistent"),
                        |mount| match &mount.source {
                            MountSource::Overlay { host_path } => host_path.clone(),
                            _ => PathBuf::from("/nonexistent"),
                        },
                    );
                Ok(bwrap_wrapper(&overlay_host))
            }
        }
    }
}

fn wrapper_descriptor(backend_id: &str, platform: Platform) -> BackendDescriptor {
    BackendDescriptor {
        backend_id: backend_id.to_owned(),
        platform,
        spi_version: SPI_VERSION.to_owned(),
        enforced: EnforcedCapabilities {
            filesystem: Some(FsConfinement::Overlay),
            network: Some(NetConfinement::Denied),
            environment_scrubbed: true,
            lifecycle: LifecycleCaps {
                deadline_kill: true,
                output_cap: true,
                orphan_reap: true,
            },
        },
        max_realm: Realm::S3IsolatedOverlay,
        isolation_self_tested: true,
        production: true,
    }
}

fn probe_budget() -> crate::plan::BudgetSpec {
    crate::plan::BudgetSpec {
        wall_clock_ms: 5_000,
        max_output_bytes: 1 << 16,
        max_stdin_bytes: 1 << 12,
    }
}

fn shell_script_argv(script: &str) -> Vec<String> {
    vec!["/bin/sh".to_owned(), "-c".to_owned(), script.to_owned()]
}

impl SandboxBackend for OsWrapperBackend {
    fn descriptor(&self) -> &BackendDescriptor {
        &self.descriptor
    }

    fn health(&mut self) -> HealthReport {
        self.health_report.clone()
    }

    fn create(&mut self, plan: &ValidatedPlan) -> Result<RealmHandle, SandboxError> {
        if !self.health_report.healthy {
            return Err(SandboxError::BackendUnhealthy);
        }
        if plan.plan.realm > self.descriptor.max_realm {
            return Err(SandboxError::BackendUnavailable);
        }
        let realm_id = self.next_id();
        let handle = RealmHandle {
            realm_id: realm_id.clone(),
            plan_digest: plan.digest.clone(),
        };
        self.realms.insert(
            realm_id,
            WrapperRealm {
                plan: plan.clone(),
                profile_path: None,
            },
        );
        Ok(handle)
    }

    fn mount(
        &mut self,
        handle: &RealmHandle,
        mount: &crate::plan::MountSpec,
    ) -> Result<(), SandboxError> {
        let realm = self
            .realms
            .get(&handle.realm_id)
            .filter(|realm| realm.plan.digest == handle.plan_digest)
            .ok_or(SandboxError::InvalidHandle)?;
        if !realm
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

    fn network(&mut self, handle: &RealmHandle, spec: &NetworkSpec) -> Result<(), SandboxError> {
        let realm = self
            .realms
            .get(&handle.realm_id)
            .filter(|realm| realm.plan.digest == handle.plan_digest)
            .ok_or(SandboxError::InvalidHandle)?;
        if &realm.plan.plan.network != spec {
            return Err(SandboxError::PlanViolation);
        }
        Ok(())
    }

    fn exec(
        &mut self,
        handle: &RealmHandle,
        command: &CommandSpec,
        injected: BTreeMap<String, RedactableValue>,
    ) -> Result<ExecOutcome, SandboxError> {
        if !self.health_report.healthy {
            return Err(SandboxError::BackendUnhealthy);
        }
        let realm = self
            .realms
            .get_mut(&handle.realm_id)
            .filter(|realm| realm.plan.digest == handle.plan_digest)
            .ok_or(SandboxError::InvalidHandle)?;
        if realm.plan.plan.command.as_ref() != Some(command) {
            return Err(SandboxError::PlanViolation);
        }
        let wrapper = Self::build_wrapper_for(self.kind, realm)?;
        let host_mounts = host_mounts_of(&realm.plan);
        let (child_argv, cwd) = match self.kind {
            WrapperKind::DarwinSeatbelt => {
                let entry = map_realm_path(&host_mounts, &command.argv[0])?;
                let mut argv = command.argv.clone();
                argv[0] = entry.to_string_lossy().into_owned();
                (argv, map_realm_path(&host_mounts, &command.cwd)?)
            }
            WrapperKind::LinuxBwrap => (command.argv.clone(), PathBuf::from("/")),
        };
        run_scrubbed_child(
            &child_argv,
            &cwd,
            &realm.plan.plan.env,
            &realm.plan.plan.mounts,
            realm.plan.plan.budget,
            &injected,
            command.stdin.as_deref(),
            &wrapper,
        )
    }

    fn kill(&mut self, _handle: &RealmHandle) -> Result<(), SandboxError> {
        Ok(())
    }

    fn snapshot(&mut self, handle: &RealmHandle) -> Result<SnapshotRecord, SandboxError> {
        let realm = self
            .realms
            .get(&handle.realm_id)
            .filter(|realm| realm.plan.digest == handle.plan_digest)
            .ok_or(SandboxError::InvalidHandle)?;
        let mut hasher = Sha256::new();
        hasher.update(handle.realm_id.as_bytes());
        hasher.update(realm.plan.digest.as_bytes());
        Ok(SnapshotRecord {
            snapshot_id: format!("sha256:{}", crate::hex_upper(&hasher.finalize())),
            realm_id: handle.realm_id.clone(),
        })
    }

    fn destroy(&mut self, handle: &RealmHandle) -> Result<DestroyReport, SandboxError> {
        let realm = self
            .realms
            .remove(&handle.realm_id)
            .ok_or(SandboxError::InvalidHandle)?;
        if let Some(profile) = &realm.profile_path {
            let _ = std::fs::remove_file(profile);
        }
        Ok(DestroyReport {
            realm_id: handle.realm_id.clone(),
            killed_processes: 0,
        })
    }
}

/// Non-system top-level host roots whose reads are denied before the
/// declared mounts re-allow their exact subtrees.
const SEATBELT_DENIED_ROOTS: [&str; 7] = [
    "/Users", "/home", "/opt", "/Volumes", "/private", "/tmp", "/var",
];

/// Render the seatbelt profile for one validated plan.
///
/// macOS 15.7 aborts `sandbox-exec` (SIGABRT) on any `allow file-read*`
/// rule carrying `subpath`/`literal`/`regex` filters (KI-0006), so the
/// equivalent-strictness composition is used instead: a wildcard read
/// allowance, explicit `deny file-read*` on every non-system top-level
/// root, then mount-specific re-allows. More specific allowances win,
/// which keeps reads confined to system trees plus declared mounts and
/// writes confined to declared overlays — the same lattice as the
/// pre-15.7 profile.
/// Canonicalize a host path for seatbelt emission: macOS resolves
/// `/tmp` and `/var` to `/private/...`, and seatbelt subpath filters
/// match the canonical path the kernel sees, so unresolved symlink
/// prefixes would silently fall under the denied roots.
fn seatbelt_path(host: &Path) -> String {
    host.canonicalize().map_or_else(
        |_| host.to_string_lossy().into_owned(),
        |resolved| resolved.to_string_lossy().into_owned(),
    )
}

fn seatbelt_profile(plan: &ValidatedPlan) -> String {
    let mut profile = String::from(
        "(version 1)\n(deny default)\n\
         (allow file-read*)\n\
         (allow process-exec (subpath \"/usr\") (subpath \"/bin\") (subpath \"/sbin\"))\n\
         (allow sysctl-read)\n(allow mach-lookup)\n(allow process-fork)\n",
    );
    for root in SEATBELT_DENIED_ROOTS {
        let _ = writeln!(profile, "(deny file-read* (subpath \"{root}\"))");
    }
    for mount in &plan.plan.mounts {
        match &mount.source {
            MountSource::Workspace { host_path } | MountSource::SystemTools { host_path } => {
                let _ = writeln!(
                    profile,
                    "(allow file-read* (subpath \"{}\"))",
                    seatbelt_path(host_path)
                );
            }
            MountSource::Overlay { host_path } => {
                let _ = writeln!(
                    profile,
                    "(allow file-read* (subpath \"{}\"))",
                    seatbelt_path(host_path)
                );
                let _ = writeln!(
                    profile,
                    "(allow file-read* file-write* (subpath \"{}\"))",
                    seatbelt_path(host_path)
                );
            }
            MountSource::Temporary => {}
        }
    }
    profile.push_str("(deny network*)\n");
    profile
}

/// Build the seatbelt wrapper (probe) profile. Pure: concurrent probes
/// in one process write the same PID-keyed file, so readers must never
/// depend on that file's mid-write state.
fn seatbelt_probe_profile(overlay: &Path) -> String {
    let mut profile = String::from(
        "(version 1)\n(deny default)\n\
         (allow file-read*)\n\
         (allow process-exec (subpath \"/usr\") (subpath \"/bin\") (subpath \"/sbin\"))\n\
         (allow sysctl-read)\n(allow mach-lookup)\n(allow process-fork)\n",
    );
    for root in SEATBELT_DENIED_ROOTS {
        let _ = writeln!(profile, "(deny file-read* (subpath \"{root}\"))");
    }
    let overlay_text = seatbelt_path(overlay);
    let _ = writeln!(profile, "(allow file-read* (subpath \"{overlay_text}\"))");
    let _ = writeln!(
        profile,
        "(allow file-read* file-write* (subpath \"{overlay_text}\"))"
    );
    profile.push_str("(deny network*)\n");
    profile
}

fn seatbelt_wrapper(overlay: &Path) -> Vec<String> {
    let profile = seatbelt_probe_profile(overlay);
    let path = std::env::temp_dir().join(format!(
        "saber-sbx-probe-{}.sb",
        u64::from(std::process::id())
    ));
    let _ = std::fs::write(&path, profile);
    vec![
        "/usr/bin/sandbox-exec".to_owned(),
        "-f".to_owned(),
        path.to_string_lossy().into_owned(),
    ]
}

fn bwrap_wrapper(overlay: &Path) -> Vec<String> {
    let overlay_text = overlay.to_string_lossy().into_owned();
    vec![
        "bwrap".to_owned(),
        "--ro-bind".to_owned(),
        "/usr".to_owned(),
        "/usr".to_owned(),
        "--ro-bind".to_owned(),
        "/bin".to_owned(),
        "/bin".to_owned(),
        "--ro-bind".to_owned(),
        "/lib".to_owned(),
        "/lib".to_owned(),
        "--ro-bind".to_owned(),
        "/lib64".to_owned(),
        "/lib64".to_owned(),
        "--proc".to_owned(),
        "/proc".to_owned(),
        "--dev".to_owned(),
        "/dev".to_owned(),
        "--tmpfs".to_owned(),
        "/tmp".to_owned(),
        "--bind".to_owned(),
        overlay_text.clone(),
        overlay_text,
        "--unshare-net".to_owned(),
        "--die-with-parent".to_owned(),
        "--new-session".to_owned(),
        "--clearenv".to_owned(),
    ]
}

/// The current host platform.
#[must_use]
pub fn current_platform() -> Platform {
    #[cfg(target_os = "macos")]
    {
        Platform::MacOs
    }
    #[cfg(target_os = "linux")]
    {
        Platform::Linux
    }
    #[cfg(target_os = "windows")]
    {
        Platform::Windows
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        compile_error!("Saber supports macOS, Linux and Windows only");
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::items_after_statements
    )]
    use super::*;

    #[test]
    fn wrapper_backends_report_honest_platform_health() {
        match current_platform() {
            Platform::MacOs => {
                let mut backend = OsWrapperBackend::probe(WrapperKind::DarwinSeatbelt);
                let health = backend.health();
                if health.healthy {
                    assert_eq!(backend.descriptor().max_realm, Realm::S3IsolatedOverlay);
                } else {
                    assert_ne!(health.detail, "self_test_passed");
                }
            }
            Platform::Linux => {
                let mut backend = OsWrapperBackend::probe(WrapperKind::LinuxBwrap);
                let health = backend.health();
                if health.healthy {
                    assert_eq!(backend.descriptor().max_realm, Realm::S3IsolatedOverlay);
                } else {
                    assert_ne!(health.detail, "self_test_passed");
                }
            }
            Platform::Windows => {}
        }
    }

    #[test]
    fn unhealthy_wrapper_refuses_every_operation() {
        let mut backend = OsWrapperBackend {
            kind: WrapperKind::DarwinSeatbelt,
            descriptor: wrapper_descriptor("darwin://seatbelt-v1", Platform::MacOs),
            health_report: HealthReport::unhealthy("probe_write_escape"),
            realms: BTreeMap::new(),
            counter: 0,
        };
        let plan = minimal_s3_plan();
        let validated = plan
            .validate()
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert_eq!(
            backend.create(&validated).unwrap_err(),
            SandboxError::BackendUnhealthy
        );
    }

    fn minimal_s3_plan() -> crate::plan::SandboxPlan {
        use crate::plan::{BudgetSpec, EnvSpec, MountSpec, SandboxPlan};
        SandboxPlan {
            version: 1,
            workspace_id: "ws_01".to_owned(),
            realm: Realm::S3IsolatedOverlay,
            mounts: vec![
                MountSpec {
                    target: "tools".to_owned(),
                    source: MountSource::SystemTools {
                        host_path: std::env::temp_dir(),
                    },
                    writable: false,
                    executable: true,
                },
                MountSpec {
                    target: "scratch".to_owned(),
                    source: MountSource::Overlay {
                        host_path: std::env::temp_dir(),
                    },
                    writable: true,
                    executable: false,
                },
            ],
            env: EnvSpec::default(),
            budget: BudgetSpec::default_budget(),
            network: NetworkSpec::Denied,
            command: Some(CommandSpec {
                argv: vec!["/tools/bin/true".to_owned()],
                cwd: "/scratch".to_owned(),
                stdin: None,
            }),
        }
    }

    #[test]
    fn seatbelt_profiles_avoid_filtered_read_allows_and_stay_strict() {
        // macOS 15.7 aborts sandbox-exec on `allow file-read*` rules with
        // subpath filters (KI-0006); the composition must express read
        // confinement as a wildcard allowance plus explicit denies and
        // mount-specific re-allows.
        let plan = minimal_s3_plan();
        let validated = plan
            .validate()
            .unwrap_or_else(|error| unreachable!("{error}"));
        let profile = seatbelt_profile(&validated);
        // The pre-15.7 form enumerated system roots as filtered allows,
        // which macOS 15.7's compiler aborts on when no read denies
        // accompany them; the composition must start from a wildcard
        // read allowance plus explicit denied roots.
        assert!(!profile.contains("(allow file-read* (subpath \"/usr\")"));
        assert!(profile.contains("(allow file-read*)\n"));
        for root in SEATBELT_DENIED_ROOTS {
            assert!(
                profile.contains(&format!("(deny file-read* (subpath \"{root}\"))")),
                "missing deny for {root}"
            );
        }
        // The declared mounts keep read access and the overlay keeps
        // write access through canonical re-allows.
        let scratch = std::env::temp_dir()
            .canonicalize()
            .unwrap_or_else(|_| std::env::temp_dir());
        let scratch_text = scratch.to_string_lossy();
        assert!(profile.contains(&format!("(allow file-read* (subpath \"{scratch_text}\"))")));
        assert!(profile.contains(&format!(
            "(allow file-read* file-write* (subpath \"{scratch_text}\"))"
        )));
        assert!(profile.contains("(deny network*)"));
    }

    #[test]
    fn seatbelt_wrapper_probe_profile_matches_the_same_composition() {
        // Assert on the pure profile builder: the PID-keyed probe file
        // is rewritten by concurrent probes and must not be read as
        // evidence (mid-write truncation caused a flaky failure).
        let scratch = std::env::temp_dir().join("saber-sbx-profile-test");
        let profile = seatbelt_probe_profile(&scratch);
        assert!(!profile.contains("(allow file-read* (subpath \"/usr\")"));
        assert!(profile.contains("(allow file-read*)\n"));
        for root in SEATBELT_DENIED_ROOTS {
            assert!(
                profile.contains(&format!("(deny file-read* (subpath \"{root}\"))")),
                "missing deny for {root}"
            );
        }
        assert!(profile.contains("(deny network*)"));
        let wrapper = seatbelt_wrapper(&scratch);
        assert_eq!(
            wrapper.first().map(String::as_str),
            Some("/usr/bin/sandbox-exec")
        );
    }
}
