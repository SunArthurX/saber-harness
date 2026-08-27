//! Fail-closed backend selection.
//!
//! A plan reaches a backend only through [`BackendRegistry::select_for`]:
//! candidates are considered in a fixed order, each must report a healthy
//! self-test, an SPI version match and enforced capabilities that cover the
//! plan's realm requirements, and non-production backends are refused unless
//! the registry was explicitly built for tests. When no backend qualifies the
//! caller receives [`SandboxError::BackendUnavailable`] and must deny the
//! effect or degrade to safe in-core read-only behavior — never run it on the
//! host (ADR-008).

use crate::plan::ValidatedPlan;
use crate::platform::{OsWrapperBackend, WrapperKind, current_platform};
use crate::process::GuardedProcessBackend;
use crate::spi::{BackendDescriptor, Platform, SPI_VERSION, SandboxBackend, SandboxError};

/// One selected backend plus its registry slot.
#[derive(Debug)]
pub struct BackendSelection {
    /// Index of the selected backend inside the registry.
    pub index: usize,
    /// Descriptor snapshot for audit.
    pub descriptor: BackendDescriptor,
}

/// Ordered, fail-closed backend registry.
pub struct BackendRegistry {
    backends: Vec<Box<dyn SandboxBackend>>,
    testing: bool,
}

impl BackendRegistry {
    /// Build the production registry for the current platform.
    ///
    /// macOS probes Seatbelt, Linux probes bubblewrap, Windows intentionally
    /// admits no confinement backend in S06; every platform additionally
    /// carries the non-isolating guarded backend for S0/S1 plans.
    #[must_use]
    pub fn for_current_platform() -> Self {
        // The lightest capable backend is preferred: in-core guarded
        // realms (S0/S1) select the guarded backend without paying for
        // an OS wrapper, while child-execution realms (S2+) can only be
        // hosted by the wrapper backends because the guarded backend
        // refuses command plans.
        let mut backends: Vec<Box<dyn SandboxBackend>> =
            vec![Box::new(GuardedProcessBackend::new(current_platform()))];
        match current_platform() {
            Platform::MacOs => {
                backends.push(Box::new(OsWrapperBackend::probe(
                    WrapperKind::DarwinSeatbelt,
                )));
            }
            Platform::Linux => {
                backends.push(Box::new(OsWrapperBackend::probe(WrapperKind::LinuxBwrap)));
            }
            Platform::Windows => {}
        }
        Self {
            backends,
            testing: false,
        }
    }

    /// Build an explicit registry for deterministic tests.
    #[must_use]
    pub fn with_testing_backends(backends: Vec<Box<dyn SandboxBackend>>) -> Self {
        Self {
            backends,
            testing: true,
        }
    }

    /// Number of registered backends.
    #[must_use]
    pub fn len(&self) -> usize {
        self.backends.len()
    }

    /// Whether the registry is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.backends.is_empty()
    }

    /// Mutable access to one backend by slot, for the broker that selected it.
    ///
    /// # Errors
    ///
    /// Unknown slot.
    pub fn backend_mut(
        &mut self,
        index: usize,
    ) -> Result<&mut (dyn SandboxBackend + 'static), SandboxError> {
        let backend = self
            .backends
            .get_mut(index)
            .ok_or(SandboxError::InvalidHandle)?;
        Ok(backend.as_mut())
    }

    /// Select a healthy backend that covers the plan's requirements.
    ///
    /// # Errors
    ///
    /// [`SandboxError::BackendUnavailable`] when nothing qualifies; the
    /// caller must fail closed.
    pub fn select_for(&mut self, plan: &ValidatedPlan) -> Result<BackendSelection, SandboxError> {
        let requirements = plan.requirements;
        for (index, backend) in self.backends.iter_mut().enumerate() {
            let descriptor = backend.descriptor().clone();
            if !self.testing && !descriptor.production {
                continue;
            }
            if descriptor.spi_version != SPI_VERSION {
                continue;
            }
            if plan.plan.realm > descriptor.max_realm {
                continue;
            }
            if !descriptor.isolation_self_tested
                && plan.plan.realm > crate::plan::Realm::S1GuardedRead
            {
                continue;
            }
            if !descriptor.enforced.covers(&requirements) {
                continue;
            }
            if !backend.health().healthy {
                continue;
            }
            return Ok(BackendSelection {
                index,
                descriptor: descriptor.clone(),
            });
        }
        Err(SandboxError::BackendUnavailable)
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
    use crate::fake::{FakeBackend, FakeBackendConfig};
    use crate::plan::{
        BudgetSpec, CommandSpec, EnvSpec, MountSource, MountSpec, NetworkSpec, Realm, SandboxPlan,
    };

    fn s3_plan() -> ValidatedPlan {
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
        .validate()
        .unwrap_or_else(|error| unreachable!("{error}"))
    }

    #[test]
    fn production_registry_never_selects_non_production_backends() {
        let mut registry = BackendRegistry::with_testing_backends(vec![Box::new(
            FakeBackend::new(current_platform(), FakeBackendConfig::default()),
        )]);
        registry.testing = false;
        assert_eq!(
            registry.select_for(&s3_plan()).unwrap_err(),
            SandboxError::BackendUnavailable
        );
    }

    #[test]
    fn unhealthy_and_uncovered_backends_are_skipped_fail_closed() {
        let mut registry = BackendRegistry::with_testing_backends(vec![
            Box::new(FakeBackend::new(
                current_platform(),
                FakeBackendConfig {
                    unhealthy_detail: Some("probe_failed"),
                    ..FakeBackendConfig::default()
                },
            )),
            Box::new(FakeBackend::new(
                current_platform(),
                FakeBackendConfig::default(),
            )),
        ]);
        let selection = registry
            .select_for(&s3_plan())
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert_eq!(selection.index, 1);
    }

    #[test]
    fn current_platform_registry_is_fail_closed_for_confined_children() {
        let mut registry = BackendRegistry::for_current_platform();
        let selection = registry.select_for(&s3_plan());
        match current_platform() {
            Platform::Windows => {
                assert_eq!(selection.unwrap_err(), SandboxError::BackendUnavailable);
            }
            Platform::MacOs | Platform::Linux => match selection {
                Ok(chosen) => {
                    assert!(chosen.descriptor.production);
                    assert!(chosen.descriptor.isolation_self_tested);
                    assert!(chosen.descriptor.enforced.covers(&s3_plan().requirements));
                }
                Err(error) => assert_eq!(error, SandboxError::BackendUnavailable),
            },
        }
    }

    #[test]
    fn s1_plans_select_the_guarded_backend_everywhere() {
        use crate::plan::SandboxPlan;
        let plan = SandboxPlan {
            version: 1,
            workspace_id: "ws_01".to_owned(),
            realm: Realm::S1GuardedRead,
            mounts: vec![MountSpec {
                target: "workspace".to_owned(),
                source: MountSource::Workspace {
                    host_path: std::env::temp_dir(),
                },
                writable: false,
                executable: false,
            }],
            env: EnvSpec::default(),
            budget: BudgetSpec::default_budget(),
            network: NetworkSpec::Denied,
            command: None,
        }
        .validate()
        .unwrap_or_else(|error| unreachable!("{error}"));
        let mut registry = BackendRegistry::for_current_platform();
        let selection = registry
            .select_for(&plan)
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert_eq!(selection.descriptor.backend_id, "process://guarded-v1");
    }
}
