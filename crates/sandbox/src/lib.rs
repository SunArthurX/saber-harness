//! Fail-closed sandbox realms, secret-free execution guards and the versioned
//! Sandbox Backend SPI for Saber (ADR-008).
//!
//! Every effect that needs a child process must pass through a validated
//! [`plan::SandboxPlan`] and a [`registry::BackendRegistry`] selection.
//! Unavailable, unhealthy or capability-insufficient isolation denies the
//! effect; nothing ever silently degrades to plain host execution.

pub mod environment;
pub mod fake;
pub mod path;
pub mod plan;
pub mod platform;
pub mod process;
pub mod registry;
pub mod spi;

pub use environment::{RedactableValue, SENSITIVE_ENV_KEYS, build_environment, is_sensitive_key};
pub use path::{PathError, PathGuard};
pub use plan::{
    BudgetSpec, CommandSpec, EnvSpec, ExecRequirement, FsRequirement, MountSource, MountSpec,
    NetRequirement, NetworkSpec, PlanError, Realm, RealmRequirements, SandboxPlan, ValidatedPlan,
};
pub use platform::{OsWrapperBackend, WrapperKind, current_platform};
pub use process::GuardedProcessBackend;
pub use registry::{BackendRegistry, BackendSelection};
pub use spi::{
    BackendDescriptor, DestroyReport, EnforcedCapabilities, ExecOutcome, FsConfinement,
    HealthReport, LifecycleCaps, NetConfinement, Platform, RealmHandle, SPI_VERSION,
    SandboxBackend, SandboxError, SnapshotRecord,
};

/// Canonical execution-realm ladder shared with the platform matrix schema.
///
/// The JSON data at `schemas/sandbox/v1/matrix.json` must list the same
/// realms in the same order; the parity test and the S06 verifier check it.
#[must_use]
pub const fn realm_ladder() -> [&'static str; 5] {
    [
        Realm::S0Pure.as_str(),
        Realm::S1GuardedRead.as_str(),
        Realm::S2IsolatedReadOnly.as_str(),
        Realm::S3IsolatedOverlay.as_str(),
        Realm::S4EgressMediated.as_str(),
    ]
}

/// Uppercase hex of a finalized digest.
#[must_use]
pub fn hex_upper(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02X}");
    }
    out
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
    fn realm_ladder_matches_platform_matrix_schema_data() -> Result<(), Box<dyn std::error::Error>>
    {
        let matrix: serde_json::Value =
            serde_json::from_str(include_str!("../../../schemas/sandbox/v1/matrix.json"))?;
        let realms = matrix["realms"]
            .as_array()
            .ok_or_else(|| Box::<dyn std::error::Error>::from("missing realms"))?;
        let ladder = realm_ladder();
        assert_eq!(realms.len(), ladder.len());
        for (index, realm) in realms.iter().enumerate() {
            assert_eq!(realm.as_str(), Some(ladder[index]));
        }
        assert_eq!(matrix["spi_version"].as_str(), Some(SPI_VERSION));
        let platforms = matrix["platforms"]
            .as_array()
            .ok_or_else(|| Box::<dyn std::error::Error>::from("missing platforms"))?;
        for platform in platforms {
            let declared = platform["max_realm"]
                .as_str()
                .ok_or_else(|| Box::<dyn std::error::Error>::from("missing max_realm"))?;
            assert!(
                ladder.contains(&declared),
                "unknown realm {declared} in platform matrix"
            );
        }
        Ok(())
    }
}
