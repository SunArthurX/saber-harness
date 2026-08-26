//! Versioned Sandbox Backend SPI.
//!
//! Every isolation mechanism reaches the trusted Core through this closed
//! operation set: `create`, `mount`, `network`, `exec`, `kill`, `snapshot`,
//! `destroy` and `health`. Backends publish honest capability descriptors;
//! selection is fail-closed and never implicit (ADR-008).

use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use crate::environment::RedactableValue;
use crate::plan::{CommandSpec, MountSpec, NetworkSpec, Realm, RealmRequirements, ValidatedPlan};

/// SPI contract version implemented by this crate.
pub const SPI_VERSION: &str = "1.0.0";

/// Host operating system of a backend.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[allow(non_camel_case_types)]
pub enum Platform {
    /// macOS hosts.
    MacOs,
    /// Linux hosts.
    Linux,
    /// Windows hosts.
    Windows,
}

/// Filesystem confinement a backend can actually enforce.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FsConfinement {
    /// Child sees read-only mounts only.
    ReadOnlyRootfs,
    /// Child sees read-only mounts plus a writable overlay.
    Overlay,
}

/// Network confinement a backend can actually enforce.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetConfinement {
    /// Child has no network reachability.
    Denied,
    /// Child has no raw sockets; egress exists only through the Core PEP.
    Mediated,
}

/// Lifecycle capabilities a backend can actually enforce.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LifecycleCaps {
    /// Deadline expiry kills the child.
    pub deadline_kill: bool,
    /// Captured output is bounded by the plan budget.
    pub output_cap: bool,
    /// Descendant processes are reaped/killed with the realm.
    pub orphan_reap: bool,
}

/// Everything a backend honestly enforces.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EnforcedCapabilities {
    /// Filesystem confinement, if any.
    pub filesystem: Option<FsConfinement>,
    /// Network confinement, if any.
    pub network: Option<NetConfinement>,
    /// Environment is constructed from the allowlist only.
    pub environment_scrubbed: bool,
    /// Lifecycle enforcement.
    pub lifecycle: LifecycleCaps,
}

impl EnforcedCapabilities {
    /// Whether these capabilities cover a realm's enforcement profile.
    #[must_use]
    pub fn covers(&self, requirements: &RealmRequirements) -> bool {
        let filesystem_ok = match requirements.filesystem {
            crate::plan::FsRequirement::None | crate::plan::FsRequirement::GuardedRead => true,
            crate::plan::FsRequirement::ConfinedReadOnly => {
                matches!(
                    self.filesystem,
                    Some(FsConfinement::ReadOnlyRootfs | FsConfinement::Overlay)
                )
            }
            crate::plan::FsRequirement::ConfinedOverlay => {
                matches!(self.filesystem, Some(FsConfinement::Overlay))
            }
        };
        let network_ok = match requirements.network {
            crate::plan::NetRequirement::None => true,
            crate::plan::NetRequirement::Denied | crate::plan::NetRequirement::EgressMediated => {
                matches!(
                    self.network,
                    Some(NetConfinement::Denied | NetConfinement::Mediated)
                )
            }
        };
        filesystem_ok && network_ok && self.environment_scrubbed
    }
}

/// Identity and honest capability set of one backend.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackendDescriptor {
    /// Stable backend identifier, for example `darwin://seatbelt-v1`.
    pub backend_id: String,
    /// Host platform this backend runs on.
    pub platform: Platform,
    /// SPI version the backend implements.
    pub spi_version: String,
    /// Enforced capabilities.
    pub enforced: EnforcedCapabilities,
    /// Highest realm this backend may host.
    pub max_realm: Realm,
    /// Whether the backend proved its own isolation with live probes.
    pub isolation_self_tested: bool,
    /// Whether this backend is admissible outside tests.
    pub production: bool,
}

/// Sandbox boundary failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SandboxError {
    /// No healthy backend covers the plan's requirements.
    BackendUnavailable,
    /// The backend exists but its health probe failed.
    BackendUnhealthy,
    /// The platform has no admitted isolation backend in this build.
    UnsupportedPlatform,
    /// The realm handle is unknown or already destroyed.
    InvalidHandle,
    /// An operation violated the validated plan.
    PlanViolation,
    /// The child exceeded its wall-clock deadline and was killed.
    DeadlineExceeded,
    /// Executing the child failed.
    ExecFailed,
    /// Killing the child failed.
    KillFailed,
    /// Snapshotting the realm failed.
    SnapshotFailed,
    /// Destroying the realm failed.
    DestroyFailed,
    /// The plan was invalid before backend contact.
    InvalidPlan,
}

impl Display for SandboxError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::BackendUnavailable => "backend_unavailable",
            Self::BackendUnhealthy => "backend_unhealthy",
            Self::UnsupportedPlatform => "unsupported_platform",
            Self::InvalidHandle => "invalid_handle",
            Self::PlanViolation => "plan_violation",
            Self::DeadlineExceeded => "deadline_exceeded",
            Self::ExecFailed => "exec_failed",
            Self::KillFailed => "kill_failed",
            Self::SnapshotFailed => "snapshot_failed",
            Self::DestroyFailed => "destroy_failed",
            Self::InvalidPlan => "invalid_plan",
        })
    }
}

impl std::error::Error for SandboxError {}

/// Opaque handle to one allocated realm.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RealmHandle {
    /// Stable realm identifier.
    pub realm_id: String,
    /// Digest of the validated plan the realm was created from.
    pub plan_digest: String,
}

/// Result of one child execution.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecOutcome {
    /// Exit code when the child terminated normally.
    pub exit_code: Option<i32>,
    /// Captured stdout, bounded by the budget. Redaction happens broker-side.
    pub stdout: Vec<u8>,
    /// Captured stderr, bounded by the budget.
    pub stderr: Vec<u8>,
    /// Wall-clock duration in milliseconds.
    pub duration_ms: u64,
    /// Whether output was truncated at the budget cap.
    pub truncated: bool,
    /// Whether the child was killed by the deadline or an explicit kill.
    pub killed: bool,
}

/// Record of one realm snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SnapshotRecord {
    /// Stable snapshot identifier.
    pub snapshot_id: String,
    /// Realm the snapshot belongs to.
    pub realm_id: String,
}

/// Report after destroying a realm.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DestroyReport {
    /// Realm that was destroyed.
    pub realm_id: String,
    /// Number of processes killed during destruction.
    pub killed_processes: u32,
}

/// The closed backend contract. Implementations must fail closed: any doubt
/// about confinement, health or lifecycle resolves to an error, never to a
/// best-effort host execution.
pub trait SandboxBackend {
    /// Honest identity and capability set.
    fn descriptor(&self) -> &BackendDescriptor;

    /// Probe health, including live isolation self-tests for platform
    /// backends. Unhealthy backends must never be selected.
    fn health(&mut self) -> HealthReport;

    /// Allocate a realm from a validated plan.
    ///
    /// # Errors
    ///
    /// Fails closed on any allocation doubt.
    fn create(&mut self, plan: &ValidatedPlan) -> Result<RealmHandle, SandboxError>;

    /// Apply one declared mount to an allocated realm.
    ///
    /// # Errors
    ///
    /// Rejects mounts that were not part of the validated plan.
    fn mount(&mut self, handle: &RealmHandle, mount: &MountSpec) -> Result<(), SandboxError>;

    /// Apply the network posture to an allocated realm.
    ///
    /// # Errors
    ///
    /// Rejects postures that were not part of the validated plan.
    fn network(&mut self, handle: &RealmHandle, spec: &NetworkSpec) -> Result<(), SandboxError>;

    /// Execute the plan's command inside the realm.
    ///
    /// # Errors
    ///
    /// Fails closed on preparation, exec or lifecycle failure.
    fn exec(
        &mut self,
        handle: &RealmHandle,
        command: &CommandSpec,
        injected: BTreeMap<String, RedactableValue>,
    ) -> Result<ExecOutcome, SandboxError>;

    /// Kill the realm's child without destroying the realm.
    ///
    /// # Errors
    ///
    /// Fails when the child cannot be signalled.
    fn kill(&mut self, handle: &RealmHandle) -> Result<(), SandboxError>;

    /// Snapshot the realm for later comparison.
    ///
    /// # Errors
    ///
    /// Fails when a consistent snapshot cannot be taken.
    fn snapshot(&mut self, handle: &RealmHandle) -> Result<SnapshotRecord, SandboxError>;

    /// Destroy the realm and every process inside it.
    ///
    /// # Errors
    ///
    /// Fails when teardown cannot be completed.
    fn destroy(&mut self, handle: &RealmHandle) -> Result<DestroyReport, SandboxError>;
}

/// Health probe outcome.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HealthReport {
    /// Whether the backend is selectable.
    pub healthy: bool,
    /// Stable detail code safe for audit.
    pub detail: &'static str,
}

impl HealthReport {
    /// A healthy report with the standard detail.
    #[must_use]
    pub const fn healthy() -> Self {
        Self {
            healthy: true,
            detail: "self_test_passed",
        }
    }

    /// An unhealthy report with a stable reason.
    #[must_use]
    pub const fn unhealthy(detail: &'static str) -> Self {
        Self {
            healthy: false,
            detail,
        }
    }
}
