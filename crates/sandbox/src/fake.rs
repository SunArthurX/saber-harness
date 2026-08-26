//! Deterministic in-memory backend for exhaustive SPI testing.
//!
//! The fake backend is never a production backend: its descriptor marks
//! `production: false` and the default registry refuses to select it. It
//! exists so realm/mount/env/network/exec/kill/snapshot/destroy semantics are
//! proven without depending on any operating-system facility.

use std::collections::BTreeMap;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::environment::{RedactableValue, build_environment};
use crate::plan::{CommandSpec, MountSpec, NetworkSpec, Realm, ValidatedPlan};
use crate::spi::{
    BackendDescriptor, DestroyReport, EnforcedCapabilities, ExecOutcome, FsConfinement,
    HealthReport, LifecycleCaps, NetConfinement, Platform, RealmHandle, SPI_VERSION,
    SandboxBackend, SandboxError, SnapshotRecord,
};
use sha2::{Digest, Sha256};

/// One recorded SPI operation, for test assertions.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RecordedOp {
    /// A realm was created.
    Created {
        /// Realm identifier.
        realm_id: String,
        /// Plan digest bound to the realm.
        plan_digest: String,
    },
    /// A mount was applied.
    Mounted {
        /// Realm identifier.
        realm_id: String,
        /// Mount target inside the realm.
        target: String,
    },
    /// The network posture was applied.
    NetworkApplied {
        /// Realm identifier.
        realm_id: String,
        /// Whether the posture was mediated egress.
        mediated: bool,
    },
    /// The command executed.
    Executed {
        /// Realm identifier.
        realm_id: String,
        /// Argument vector.
        argv: Vec<String>,
        /// Environment keys the child saw.
        env_keys: Vec<String>,
    },
    /// The child was killed.
    Killed {
        /// Realm identifier.
        realm_id: String,
    },
    /// A snapshot was taken.
    Snapshotted {
        /// Realm identifier.
        realm_id: String,
    },
    /// The realm was destroyed.
    Destroyed {
        /// Realm identifier.
        realm_id: String,
    },
}

/// Scripted behavior of the fake backend.
#[derive(Default)]
pub struct FakeBackendConfig {
    /// When set, `create` fails with this error.
    pub fail_create: Option<SandboxError>,
    /// When set, `exec` fails with this error.
    pub fail_exec: Option<SandboxError>,
    /// When set, `health` reports unhealthy with this detail.
    pub unhealthy_detail: Option<&'static str>,
    /// Queued exec results; the last one repeats.
    pub exec_results: VecDeque<ExecOutcome>,
    /// Shared operation sink so callers outside the registry can assert the
    /// exact SPI traffic after handing the backend over.
    pub ops_sink: Option<Arc<Mutex<Vec<RecordedOp>>>>,
    /// Test-only simulation of confined realm side effects: these host files
    /// are written when `exec` runs, standing in for what a real confined
    /// child would have produced. Never used by production backends.
    pub simulate_writes: Vec<(std::path::PathBuf, Vec<u8>)>,
    /// Test-only hook fired inside `exec`, used to inject external
    /// interference (for example a concurrent editor or `git add`) between
    /// checkpoint and verification.
    pub exec_hook: Option<std::sync::Arc<dyn Fn() + Send + Sync>>,
}

/// In-memory deterministic backend.
pub struct FakeBackend {
    descriptor: BackendDescriptor,
    config: FakeBackendConfig,
    realms: BTreeMap<String, ValidatedPlan>,
    destroyed: Vec<String>,
    operations: Vec<RecordedOp>,
    counter: u64,
}

impl FakeBackend {
    /// Construct a fake backend covering every realm on every platform.
    #[must_use]
    pub fn new(platform: Platform, config: FakeBackendConfig) -> Self {
        Self {
            descriptor: BackendDescriptor {
                backend_id: "fake://deterministic".to_owned(),
                platform,
                spi_version: SPI_VERSION.to_owned(),
                enforced: EnforcedCapabilities {
                    filesystem: Some(FsConfinement::Overlay),
                    network: Some(NetConfinement::Mediated),
                    environment_scrubbed: true,
                    lifecycle: LifecycleCaps {
                        deadline_kill: true,
                        output_cap: true,
                        orphan_reap: true,
                    },
                },
                max_realm: Realm::S4EgressMediated,
                isolation_self_tested: true,
                production: false,
            },
            config,
            realms: BTreeMap::new(),
            destroyed: Vec::new(),
            operations: Vec::new(),
            counter: 0,
        }
    }

    /// All recorded operations in order.
    #[must_use]
    pub fn operations(&self) -> &[RecordedOp] {
        &self.operations
    }

    /// Mutable access to the scripted configuration before handover.
    pub fn config_mut(&mut self) -> &mut FakeBackendConfig {
        &mut self.config
    }

    /// Whether any exec operation was recorded.
    #[must_use]
    pub fn executed_any(&self) -> bool {
        self.operations
            .iter()
            .any(|op| matches!(op, RecordedOp::Executed { .. }))
    }

    fn next_id(&mut self, prefix: &str) -> String {
        self.counter += 1;
        format!("{prefix}-{:08}", self.counter)
    }

    fn record(&mut self, op: RecordedOp) {
        if let Some(sink) = &self.config.ops_sink
            && let Ok(mut guard) = sink.lock()
        {
            guard.push(op.clone());
        }
        self.operations.push(op);
    }
}

impl SandboxBackend for FakeBackend {
    fn descriptor(&self) -> &BackendDescriptor {
        &self.descriptor
    }

    fn health(&mut self) -> HealthReport {
        match self.config.unhealthy_detail {
            Some(detail) => HealthReport::unhealthy(detail),
            None => HealthReport::healthy(),
        }
    }

    fn create(&mut self, plan: &ValidatedPlan) -> Result<RealmHandle, SandboxError> {
        if let Some(error) = self.config.fail_create {
            return Err(error);
        }
        let realm_id = self.next_id("realm");
        let handle = RealmHandle {
            realm_id: realm_id.clone(),
            plan_digest: plan.digest.clone(),
        };
        self.realms.insert(realm_id.clone(), plan.clone());
        self.record(RecordedOp::Created {
            realm_id,
            plan_digest: plan.digest.clone(),
        });
        Ok(handle)
    }

    fn mount(&mut self, handle: &RealmHandle, mount: &MountSpec) -> Result<(), SandboxError> {
        let plan = self.plan_of(handle)?;
        if !plan.plan.mounts.iter().any(|declared| declared == mount) {
            return Err(SandboxError::PlanViolation);
        }
        self.record(RecordedOp::Mounted {
            realm_id: handle.realm_id.clone(),
            target: mount.target.clone(),
        });
        Ok(())
    }

    fn network(&mut self, handle: &RealmHandle, spec: &NetworkSpec) -> Result<(), SandboxError> {
        let plan = self.plan_of(handle)?;
        if &plan.plan.network != spec {
            return Err(SandboxError::PlanViolation);
        }
        self.record(RecordedOp::NetworkApplied {
            realm_id: handle.realm_id.clone(),
            mediated: matches!(spec, NetworkSpec::Mediated { .. }),
        });
        Ok(())
    }

    fn exec(
        &mut self,
        handle: &RealmHandle,
        command: &CommandSpec,
        injected: BTreeMap<String, RedactableValue>,
    ) -> Result<ExecOutcome, SandboxError> {
        let plan = self.plan_of(handle)?;
        if plan.plan.command.as_ref() != Some(command) {
            return Err(SandboxError::PlanViolation);
        }
        let environment = build_environment(&plan.plan.env, &plan.plan.mounts, &injected)
            .map_err(|_| SandboxError::PlanViolation)?;
        if let Some(error) = self.config.fail_exec {
            return Err(error);
        }
        for (target, content) in &self.config.simulate_writes {
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(target, content).map_err(|_| SandboxError::ExecFailed)?;
        }
        if let Some(hook) = &self.config.exec_hook {
            hook();
        }
        let outcome = self.config.exec_results.pop_front().unwrap_or(ExecOutcome {
            exit_code: Some(0),
            stdout: Vec::new(),
            stderr: Vec::new(),
            duration_ms: 0,
            truncated: false,
            killed: false,
        });
        self.record(RecordedOp::Executed {
            realm_id: handle.realm_id.clone(),
            argv: command.argv.clone(),
            env_keys: environment.keys().cloned().collect(),
        });
        Ok(outcome)
    }

    fn kill(&mut self, handle: &RealmHandle) -> Result<(), SandboxError> {
        self.plan_of(handle)?;
        self.record(RecordedOp::Killed {
            realm_id: handle.realm_id.clone(),
        });
        Ok(())
    }

    fn snapshot(&mut self, handle: &RealmHandle) -> Result<SnapshotRecord, SandboxError> {
        let plan = self.plan_of(handle)?;
        let mut hasher = Sha256::new();
        hasher.update(handle.realm_id.as_bytes());
        hasher.update(plan.digest.as_bytes());
        let snapshot_id = format!("sha256:{}", crate::hex_upper(&hasher.finalize()));
        self.record(RecordedOp::Snapshotted {
            realm_id: handle.realm_id.clone(),
        });
        Ok(SnapshotRecord {
            snapshot_id,
            realm_id: handle.realm_id.clone(),
        })
    }

    fn destroy(&mut self, handle: &RealmHandle) -> Result<DestroyReport, SandboxError> {
        if self.realms.remove(&handle.realm_id).is_none() {
            return Err(SandboxError::InvalidHandle);
        }
        self.destroyed.push(handle.realm_id.clone());
        self.record(RecordedOp::Destroyed {
            realm_id: handle.realm_id.clone(),
        });
        Ok(DestroyReport {
            realm_id: handle.realm_id.clone(),
            killed_processes: 0,
        })
    }
}

impl FakeBackend {
    fn plan_of(&self, handle: &RealmHandle) -> Result<&ValidatedPlan, SandboxError> {
        self.realms
            .get(&handle.realm_id)
            .filter(|plan| plan.digest == handle.plan_digest)
            .ok_or(SandboxError::InvalidHandle)
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
    use std::path::PathBuf;

    use super::*;
    use crate::plan::{BudgetSpec, EnvSpec, MountSource, SandboxPlan};

    fn validated(realm: Realm) -> ValidatedPlan {
        let tools = MountSpec {
            target: "tools".to_owned(),
            source: MountSource::SystemTools {
                host_path: std::env::temp_dir(),
            },
            writable: false,
            executable: true,
        };
        let scratch = MountSpec {
            target: "scratch".to_owned(),
            source: MountSource::Overlay {
                host_path: std::env::temp_dir(),
            },
            writable: true,
            executable: false,
        };
        let mounts = match realm {
            Realm::S3IsolatedOverlay | Realm::S4EgressMediated => vec![tools, scratch],
            _ => vec![tools],
        };
        SandboxPlan {
            version: 1,
            workspace_id: "ws_01".to_owned(),
            realm,
            mounts,
            env: EnvSpec::default(),
            budget: BudgetSpec::default_budget(),
            network: NetworkSpec::Denied,
            command: Some(CommandSpec {
                argv: vec!["/tools/bin/true".to_owned()],
                cwd: "/tools".to_owned(),
                stdin: None,
            }),
        }
        .validate()
        .unwrap_or_else(|error| unreachable!("{error}"))
    }

    #[test]
    fn fake_backend_enforces_plan_binding_and_records_operations() {
        let plan = validated(Realm::S3IsolatedOverlay);
        let mut backend = FakeBackend::new(Platform::Linux, FakeBackendConfig::default());
        assert!(backend.health().healthy);
        let handle = backend
            .create(&plan)
            .unwrap_or_else(|error| unreachable!("{error}"));
        let mount = plan.plan.mounts[0].clone();
        assert!(backend.mount(&handle, &mount).is_ok());
        let undeclared = MountSpec {
            target: "evil".to_owned(),
            source: MountSource::Overlay {
                host_path: PathBuf::from("/tmp/evil"),
            },
            writable: true,
            executable: false,
        };
        assert_eq!(
            backend.mount(&handle, &undeclared).unwrap_err(),
            SandboxError::PlanViolation
        );
        assert!(backend.network(&handle, &NetworkSpec::Denied).is_ok());
        let command = plan
            .plan
            .command
            .clone()
            .unwrap_or_else(|| unreachable!("validated child plan carries a command"));
        let outcome = backend
            .exec(&handle, &command, BTreeMap::new())
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert_eq!(outcome.exit_code, Some(0));
        let smuggled = CommandSpec {
            argv: vec!["/tools/bin/other".to_owned()],
            cwd: "/tools".to_owned(),
            stdin: None,
        };
        assert_eq!(
            backend
                .exec(&handle, &smuggled, BTreeMap::new())
                .unwrap_err(),
            SandboxError::PlanViolation
        );
        assert_eq!(backend.operations().len(), 4);
        assert!(backend.snapshot(&handle).is_ok());
        assert!(backend.destroy(&handle).is_ok());
        assert_eq!(
            backend.destroy(&handle).unwrap_err(),
            SandboxError::InvalidHandle
        );
    }

    #[test]
    fn failing_health_and_create_never_reach_exec() {
        let plan = validated(Realm::S2IsolatedReadOnly);
        let mut backend = FakeBackend::new(
            Platform::MacOs,
            FakeBackendConfig {
                fail_create: Some(SandboxError::BackendUnhealthy),
                unhealthy_detail: Some("probe_failed"),
                ..FakeBackendConfig::default()
            },
        );
        assert!(!backend.health().healthy);
        assert_eq!(
            backend.create(&plan).unwrap_err(),
            SandboxError::BackendUnhealthy
        );
        assert!(!backend.executed_any());
    }
}
