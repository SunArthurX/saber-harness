//! Typed sandbox plans, execution realms and deterministic plan validation.
//!
//! A [`SandboxPlan`] is pure data describing one isolated execution: realm,
//! mounts, allowlisted environment, budgets, network posture and an optional
//! child command. Validation is total and side-effect free so policy-to-broker
//! behavior stays deterministic and exhaustively testable before any backend
//! is contacted (ADR-008).

use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Plan validation failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlanError {
    /// The plan version is not supported.
    UnsupportedVersion,
    /// The realm forbids a declared element (command, writable mount, network).
    RealmViolation,
    /// A mount target or source is malformed.
    InvalidMount,
    /// Mount targets overlap or conflict.
    MountConflict,
    /// The environment allowlist contains a rejected key or value.
    InvalidEnvironment,
    /// A budget is missing or out of range.
    InvalidBudget,
    /// The command is malformed or resolves outside executable mounts.
    InvalidCommand,
    /// The network posture does not match the realm.
    InvalidNetwork,
}

impl Display for PlanError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::UnsupportedVersion => "unsupported_version",
            Self::RealmViolation => "realm_violation",
            Self::InvalidMount => "invalid_mount",
            Self::MountConflict => "mount_conflict",
            Self::InvalidEnvironment => "invalid_environment",
            Self::InvalidBudget => "invalid_budget",
            Self::InvalidCommand => "invalid_command",
            Self::InvalidNetwork => "invalid_network",
        })
    }
}

impl std::error::Error for PlanError {}

/// Isolation realm. Higher realms inherit every lower realm constraint.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Realm {
    /// Pure in-core typed computation; no process and no host access.
    S0Pure,
    /// In-core reads through the path guard only; no child process.
    S1GuardedRead,
    /// OS-isolated child with read-only workspace mounts and no network.
    S2IsolatedReadOnly,
    /// S2 plus an explicitly mounted writable overlay; no network.
    S3IsolatedOverlay,
    /// S3 plus network reachable only through the in-core Egress PEP.
    S4EgressMediated,
}

impl Realm {
    /// Stable schema value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::S0Pure => "s0_pure",
            Self::S1GuardedRead => "s1_guarded_read",
            Self::S2IsolatedReadOnly => "s2_isolated_read_only",
            Self::S3IsolatedOverlay => "s3_isolated_overlay",
            Self::S4EgressMediated => "s4_egress_mediated",
        }
    }

    /// Enforcement requirements that any backend must demonstrably cover.
    #[must_use]
    pub const fn requirements(self) -> RealmRequirements {
        match self {
            Self::S0Pure => RealmRequirements {
                filesystem: FsRequirement::None,
                network: NetRequirement::None,
                execution: ExecRequirement::InCore,
            },
            Self::S1GuardedRead => RealmRequirements {
                filesystem: FsRequirement::GuardedRead,
                network: NetRequirement::None,
                execution: ExecRequirement::InCore,
            },
            Self::S2IsolatedReadOnly => RealmRequirements {
                filesystem: FsRequirement::ConfinedReadOnly,
                network: NetRequirement::Denied,
                execution: ExecRequirement::Child,
            },
            Self::S3IsolatedOverlay => RealmRequirements {
                filesystem: FsRequirement::ConfinedOverlay,
                network: NetRequirement::Denied,
                execution: ExecRequirement::Child,
            },
            Self::S4EgressMediated => RealmRequirements {
                filesystem: FsRequirement::ConfinedOverlay,
                network: NetRequirement::EgressMediated,
                execution: ExecRequirement::Child,
            },
        }
    }
}

/// Filesystem enforcement a realm demands.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FsRequirement {
    /// No host filesystem access at all.
    None,
    /// In-core canonical-path guard; no child process exists.
    GuardedRead,
    /// Child confined to read-only mounts.
    ConfinedReadOnly,
    /// Child confined to read-only mounts plus a writable overlay.
    ConfinedOverlay,
}

/// Network enforcement a realm demands.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NetRequirement {
    /// No network dimension applies.
    None,
    /// The child must have no network reachability.
    Denied,
    /// Reachability exists only through the in-core Egress PEP.
    EgressMediated,
}

/// Whether and how code executes.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecRequirement {
    /// Nothing executes.
    Forbidden,
    /// Pure in-core evaluation.
    InCore,
    /// An isolated child process runs.
    Child,
}

/// Complete enforcement profile derived from a realm.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RealmRequirements {
    /// Filesystem enforcement.
    pub filesystem: FsRequirement,
    /// Network enforcement.
    pub network: NetRequirement,
    /// Execution mode.
    pub execution: ExecRequirement,
}

/// Host-side source of one mount.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MountSource {
    /// The canonical host workspace root; always mounted read-only.
    Workspace {
        /// Absolute canonical host directory.
        host_path: PathBuf,
    },
    /// A dedicated writable overlay or worktree directory.
    Overlay {
        /// Absolute host directory that receives mutations.
        host_path: PathBuf,
    },
    /// Pinned read-only system tools tree (for example `/usr`).
    SystemTools {
        /// Absolute host tools root.
        host_path: PathBuf,
    },
    /// A fresh temporary scratch directory.
    Temporary,
}

impl MountSource {
    fn inherent_writability(&self) -> bool {
        matches!(self, Self::Overlay { .. } | Self::Temporary)
    }
}

/// One declared mount inside the realm.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MountSpec {
    /// Relative mount point inside the realm root, for example `workspace`.
    pub target: String,
    /// Host-side source.
    pub source: MountSource,
    /// Must agree with the source's inherent writability.
    pub writable: bool,
    /// Whether binaries may execute from this mount.
    pub executable: bool,
}

/// Allowlisted child environment. Whole-environment inheritance is impossible
/// by construction: only explicitly listed entries exist.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct EnvSpec {
    /// Explicit non-sensitive entries.
    pub allow: BTreeMap<String, String>,
    /// Environment keys reserved for broker secret injection. The values are
    /// supplied out of band at exec time and never appear in this plan.
    pub lease_channels: Vec<String>,
}

/// Resource budget for one realm.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BudgetSpec {
    /// Wall-clock deadline in milliseconds; the child is killed after it.
    pub wall_clock_ms: u64,
    /// Maximum captured stdout/stderr bytes per stream.
    pub max_output_bytes: usize,
    /// Maximum stdin payload bytes.
    pub max_stdin_bytes: usize,
}

impl BudgetSpec {
    /// Conservative default budget used when a plan author omits one.
    #[must_use]
    pub const fn default_budget() -> Self {
        Self {
            wall_clock_ms: 30_000,
            max_output_bytes: 1 << 20,
            max_stdin_bytes: 1 << 16,
        }
    }
}

/// Network posture of the realm's child.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NetworkSpec {
    /// No network reachability at all.
    Denied,
    /// The child has no sockets; the trusted Core performs authorized egress
    /// through the Egress PEP on the child's behalf.
    Mediated {
        /// Stable purpose code the Egress PEP must match.
        purpose: String,
    },
}

/// Child command expressed with realm-internal absolute paths only.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CommandSpec {
    /// Argument vector; `argv[0]` is realm-absolute and must resolve inside an
    /// executable mount.
    pub argv: Vec<String>,
    /// Realm-internal working directory; defaults to `/`.
    pub cwd: String,
    /// Optional stdin payload.
    pub stdin: Option<Vec<u8>>,
}

/// A complete validated sandbox plan.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SandboxPlan {
    /// Contract version; currently only `1` is accepted.
    pub version: u32,
    /// Owning workspace partition.
    pub workspace_id: String,
    /// Requested isolation realm.
    pub realm: Realm,
    /// Declared mounts.
    pub mounts: Vec<MountSpec>,
    /// Allowlisted environment.
    pub env: EnvSpec,
    /// Resource budget.
    pub budget: BudgetSpec,
    /// Network posture.
    pub network: NetworkSpec,
    /// Optional child command.
    pub command: Option<CommandSpec>,
}

impl SandboxPlan {
    /// Validate the plan totally and compute its digest.
    ///
    /// # Errors
    ///
    /// Returns the first violated constraint; no partial validation state
    /// escapes because the plan is unchanged.
    pub fn validate(&self) -> Result<ValidatedPlan, PlanError> {
        if self.version != 1
            || self.workspace_id.is_empty()
            || self.workspace_id.len() > 128
            || !self
                .workspace_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            return Err(PlanError::UnsupportedVersion);
        }
        let requirements = self.realm.requirements();
        self.validate_mounts(requirements)?;
        self.validate_environment()?;
        self.validate_budget()?;
        self.validate_network(requirements)?;
        self.validate_command(requirements)?;
        let digest = self.digest();
        Ok(ValidatedPlan {
            plan: self.clone(),
            digest,
            requirements,
        })
    }

    fn digest(&self) -> String {
        let encoded = serde_json::to_vec(self).unwrap_or_default();
        let mut hasher = Sha256::new();
        hasher.update(b"saber-sandbox-plan-v1\0");
        hasher.update(&encoded);
        format!("sha256:{}", crate::hex_upper(&hasher.finalize()))
    }

    fn validate_mounts(&self, requirements: RealmRequirements) -> Result<(), PlanError> {
        let mut seen_targets: Vec<(&str, bool)> = Vec::new();
        let mut overlay_count = 0_usize;
        for mount in &self.mounts {
            if !valid_mount_target(&mount.target) {
                return Err(PlanError::InvalidMount);
            }
            if mount.writable != mount.source.inherent_writability() {
                return Err(PlanError::InvalidMount);
            }
            let executable_ok = match &mount.source {
                MountSource::Workspace { .. } => true,
                MountSource::Overlay { .. } | MountSource::Temporary => !mount.executable,
                MountSource::SystemTools { .. } => mount.executable,
            };
            if !executable_ok {
                return Err(PlanError::InvalidMount);
            }
            if matches!(mount.source, MountSource::Overlay { .. }) {
                overlay_count += 1;
            }
            if let MountSource::Workspace { host_path }
            | MountSource::Overlay { host_path }
            | MountSource::SystemTools { host_path } = &mount.source
                && (!host_path.is_absolute() || host_path.components().count() < 2)
            {
                return Err(PlanError::InvalidMount);
            }
            for (existing, existing_writable) in &seen_targets {
                if target_conflict(existing, &mount.target, *existing_writable, mount.writable) {
                    return Err(PlanError::MountConflict);
                }
            }
            seen_targets.push((&mount.target, mount.writable));
        }
        match requirements.filesystem {
            FsRequirement::None => {
                if !self.mounts.is_empty() {
                    return Err(PlanError::RealmViolation);
                }
            }
            FsRequirement::GuardedRead => {
                if self
                    .mounts
                    .iter()
                    .any(|mount| !matches!(mount.source, MountSource::Workspace { .. }))
                {
                    return Err(PlanError::RealmViolation);
                }
            }
            FsRequirement::ConfinedReadOnly => {
                if overlay_count != 0 {
                    return Err(PlanError::RealmViolation);
                }
            }
            FsRequirement::ConfinedOverlay => {
                if overlay_count == 0 {
                    return Err(PlanError::RealmViolation);
                }
            }
        }
        Ok(())
    }

    fn validate_environment(&self) -> Result<(), PlanError> {
        for (key, value) in &self.env.allow {
            if !valid_env_key(key)
                || crate::environment::is_sensitive_key(key)
                || value.contains('\0')
                || key == "PATH" && !path_value_confined(value, &self.mounts)
            {
                return Err(PlanError::InvalidEnvironment);
            }
        }
        for channel in &self.env.lease_channels {
            if !valid_env_key(channel) || crate::environment::is_reserved_env_key(channel) {
                return Err(PlanError::InvalidEnvironment);
            }
            if self.env.allow.contains_key(channel) {
                return Err(PlanError::InvalidEnvironment);
            }
        }
        Ok(())
    }

    fn validate_budget(&self) -> Result<(), PlanError> {
        let budget = &self.budget;
        if budget.wall_clock_ms == 0
            || budget.wall_clock_ms > 3_600_000
            || budget.max_output_bytes == 0
            || budget.max_output_bytes > 64 << 20
            || budget.max_stdin_bytes > 1 << 20
        {
            return Err(PlanError::InvalidBudget);
        }
        Ok(())
    }

    fn validate_network(&self, requirements: RealmRequirements) -> Result<(), PlanError> {
        match (&self.network, requirements.network) {
            (NetworkSpec::Denied, NetRequirement::None | NetRequirement::Denied) => Ok(()),
            (NetworkSpec::Mediated { purpose }, NetRequirement::EgressMediated) => {
                if purpose.is_empty() || purpose.len() > 64 || !valid_purpose(purpose) {
                    return Err(PlanError::InvalidNetwork);
                }
                Ok(())
            }
            _ => Err(PlanError::InvalidNetwork),
        }
    }

    fn validate_command(&self, requirements: RealmRequirements) -> Result<(), PlanError> {
        let Some(command) = &self.command else {
            return match requirements.execution {
                ExecRequirement::Child => Err(PlanError::RealmViolation),
                ExecRequirement::Forbidden | ExecRequirement::InCore => Ok(()),
            };
        };
        match requirements.execution {
            ExecRequirement::Child => {}
            ExecRequirement::Forbidden | ExecRequirement::InCore => {
                return Err(PlanError::RealmViolation);
            }
        }
        if command.argv.is_empty()
            || command
                .argv
                .iter()
                .any(|argument| argument.is_empty() || argument.contains('\0'))
        {
            return Err(PlanError::InvalidCommand);
        }
        let entry = command.argv.first().ok_or(PlanError::InvalidCommand)?;
        if !entry.starts_with('/') || !path_within_executable_mount(entry, &self.mounts) {
            return Err(PlanError::InvalidCommand);
        }
        if !command.cwd.starts_with('/') || command.cwd.contains("..") || command.cwd.contains('\0')
        {
            return Err(PlanError::InvalidCommand);
        }
        if let Some(stdin) = &command.stdin
            && stdin.len() > self.budget.max_stdin_bytes
        {
            return Err(PlanError::InvalidCommand);
        }
        Ok(())
    }
}

/// A plan that passed total validation plus its digest and derived profile.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedPlan {
    /// The validated immutable plan.
    pub plan: SandboxPlan,
    /// Content digest bound into the realm handle and audit.
    pub digest: String,
    /// Realm enforcement profile.
    pub requirements: RealmRequirements,
}

fn valid_mount_target(target: &str) -> bool {
    !target.is_empty()
        && !target.contains('\0')
        && !target.contains('\\')
        && !target.starts_with('/')
        && !target
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
}

fn target_conflict(first: &str, second: &str, first_writable: bool, second_writable: bool) -> bool {
    first == second || {
        let prefix = format!("{first}/");
        (second.starts_with(&prefix) || {
            let other = format!("{second}/");
            first.starts_with(&other)
        }) && first_writable != second_writable
    }
}

fn valid_env_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn valid_purpose(purpose: &str) -> bool {
    purpose
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn path_value_confined(value: &str, mounts: &[MountSpec]) -> bool {
    value
        .split(':')
        .all(|entry| entry.starts_with('/') && path_within_executable_mount(entry, mounts))
}

fn path_within_executable_mount(realm_path: &str, mounts: &[MountSpec]) -> bool {
    mounts
        .iter()
        .any(|mount| mount.executable && realm_path.starts_with(&format!("/{}/", mount.target)))
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

    fn overlay_mount(target: &str) -> MountSpec {
        MountSpec {
            target: target.to_owned(),
            source: MountSource::Overlay {
                host_path: std::env::temp_dir(),
            },
            writable: true,
            executable: false,
        }
    }

    fn workspace_mount(target: &str) -> MountSpec {
        MountSpec {
            target: target.to_owned(),
            source: MountSource::Workspace {
                host_path: std::env::temp_dir(),
            },
            writable: false,
            executable: false,
        }
    }

    fn tools_mount() -> MountSpec {
        MountSpec {
            target: "tools".to_owned(),
            source: MountSource::SystemTools {
                host_path: std::env::temp_dir(),
            },
            writable: false,
            executable: true,
        }
    }

    fn plan(realm: Realm, mounts: Vec<MountSpec>, command: Option<CommandSpec>) -> SandboxPlan {
        SandboxPlan {
            version: 1,
            workspace_id: "ws_01".to_owned(),
            realm,
            mounts,
            env: EnvSpec::default(),
            budget: BudgetSpec::default_budget(),
            network: NetworkSpec::Denied,
            command,
        }
    }

    fn command(argv: &[&str]) -> CommandSpec {
        CommandSpec {
            argv: argv.iter().map(ToString::to_string).collect(),
            cwd: "/workspace".to_owned(),
            stdin: None,
        }
    }

    #[test]
    fn realm_ladder_is_monotonic() {
        let realms = [
            Realm::S0Pure,
            Realm::S1GuardedRead,
            Realm::S2IsolatedReadOnly,
            Realm::S3IsolatedOverlay,
            Realm::S4EgressMediated,
        ];
        for window in realms.windows(2) {
            assert!(window[0] < window[1]);
        }
        assert_eq!(
            Realm::S2IsolatedReadOnly.requirements().filesystem,
            FsRequirement::ConfinedReadOnly
        );
        assert_eq!(
            Realm::S4EgressMediated.requirements().network,
            NetRequirement::EgressMediated
        );
    }

    #[test]
    fn realm_governs_mounts_command_and_network() {
        assert_eq!(
            plan(Realm::S0Pure, vec![workspace_mount("workspace")], None)
                .validate()
                .unwrap_err(),
            PlanError::RealmViolation
        );
        assert_eq!(
            plan(
                Realm::S1GuardedRead,
                Vec::new(),
                Some(command(&["/tools/bin/ls"]))
            )
            .validate()
            .unwrap_err(),
            PlanError::RealmViolation
        );
        let mut s2 = plan(
            Realm::S2IsolatedReadOnly,
            vec![workspace_mount("workspace"), tools_mount()],
            Some(command(&["/tools/bin/ls"])),
        );
        assert!(s2.validate().is_ok());
        s2.mounts.push(overlay_mount("scratch"));
        assert_eq!(s2.validate().unwrap_err(), PlanError::RealmViolation);
        let mut s3 = plan(
            Realm::S3IsolatedOverlay,
            vec![
                workspace_mount("workspace"),
                tools_mount(),
                overlay_mount("scratch"),
            ],
            Some(command(&["/tools/bin/ls"])),
        );
        assert!(s3.validate().is_ok());
        s3.network = NetworkSpec::Mediated {
            purpose: "model-provider".to_owned(),
        };
        assert_eq!(s3.validate().unwrap_err(), PlanError::InvalidNetwork);
        let s4 = SandboxPlan {
            realm: Realm::S4EgressMediated,
            network: NetworkSpec::Mediated {
                purpose: "model-provider".to_owned(),
            },
            ..s3.clone()
        };
        assert!(s4.validate().is_ok());
        let s4_bad_purpose = SandboxPlan {
            network: NetworkSpec::Mediated {
                purpose: "Model Provider!".to_owned(),
            },
            ..s4.clone()
        };
        assert_eq!(
            s4_bad_purpose.validate().unwrap_err(),
            PlanError::InvalidNetwork
        );
    }

    #[test]
    fn mount_targets_reject_traversal_duplicates_and_writability_lies() {
        let traversing = MountSpec {
            target: "a/../b".to_owned(),
            ..workspace_mount("workspace")
        };
        assert_eq!(
            plan(Realm::S1GuardedRead, vec![traversing], None)
                .validate()
                .unwrap_err(),
            PlanError::InvalidMount
        );
        let lying = MountSpec {
            writable: true,
            ..workspace_mount("workspace")
        };
        assert_eq!(
            plan(Realm::S1GuardedRead, vec![lying], None)
                .validate()
                .unwrap_err(),
            PlanError::InvalidMount
        );
        let conflicting = vec![
            workspace_mount("workspace"),
            MountSpec {
                target: "workspace/src".to_owned(),
                source: MountSource::Overlay {
                    host_path: std::env::temp_dir(),
                },
                writable: true,
                executable: false,
            },
        ];
        assert_eq!(
            plan(Realm::S1GuardedRead, conflicting, None)
                .validate()
                .unwrap_err(),
            PlanError::MountConflict
        );
        let executable_overlay = MountSpec {
            executable: true,
            ..overlay_mount("scratch")
        };
        assert_eq!(
            plan(
                Realm::S3IsolatedOverlay,
                vec![workspace_mount("workspace"), executable_overlay],
                None
            )
            .validate()
            .unwrap_err(),
            PlanError::InvalidMount
        );
    }

    #[test]
    fn environment_allowlist_rejects_sensitive_and_unconfined_path() {
        let mut rejected = plan(
            Realm::S1GuardedRead,
            vec![workspace_mount("workspace")],
            None,
        );
        rejected
            .env
            .allow
            .insert("HOME".to_owned(), "/Users/bob".to_owned());
        assert_eq!(
            rejected.validate().unwrap_err(),
            PlanError::InvalidEnvironment
        );
        rejected.env.allow.clear();
        rejected
            .env
            .allow
            .insert("AWS_SECRET_ACCESS_KEY".to_owned(), "x".to_owned());
        assert_eq!(
            rejected.validate().unwrap_err(),
            PlanError::InvalidEnvironment
        );
        rejected.env.allow.clear();
        let mut host_path = plan(
            Realm::S2IsolatedReadOnly,
            vec![tools_mount()],
            Some(command(&["/tools/bin/ls"])),
        );
        host_path
            .env
            .allow
            .insert("PATH".to_owned(), "/usr/bin".to_owned());
        assert_eq!(
            host_path.validate().unwrap_err(),
            PlanError::InvalidEnvironment
        );
        host_path
            .env
            .allow
            .insert("PATH".to_owned(), "/tools/bin".to_owned());
        assert!(host_path.validate().is_ok());
        let mut duplicate_channel = host_path.clone();
        duplicate_channel.env.lease_channels.push("PATH".to_owned());
        assert_eq!(
            duplicate_channel.validate().unwrap_err(),
            PlanError::InvalidEnvironment
        );
    }

    #[test]
    fn commands_must_resolve_inside_executable_mounts() {
        let mounts = vec![tools_mount(), workspace_mount("workspace")];
        assert_eq!(
            plan(
                Realm::S2IsolatedReadOnly,
                mounts.clone(),
                Some(command(&["/bin/sh"]))
            )
            .validate()
            .unwrap_err(),
            PlanError::InvalidCommand
        );
        assert_eq!(
            plan(
                Realm::S2IsolatedReadOnly,
                mounts.clone(),
                Some(command(&["/workspace/../../bin/sh"]))
            )
            .validate()
            .unwrap_err(),
            PlanError::InvalidCommand
        );
        let mut relative = command(&["tools/bin/ls"]);
        relative.argv[0] = "tools/bin/ls".to_owned();
        assert_eq!(
            plan(Realm::S2IsolatedReadOnly, mounts, Some(relative))
                .validate()
                .unwrap_err(),
            PlanError::InvalidCommand
        );
    }

    #[test]
    fn digest_binds_exact_plan_content() {
        let first = plan(
            Realm::S2IsolatedReadOnly,
            vec![workspace_mount("workspace"), tools_mount()],
            Some(command(&["/tools/bin/ls"])),
        )
        .validate()
        .unwrap_or_else(|error| unreachable!("{error}"));
        let mut changed = first.plan.clone();
        changed.budget.wall_clock_ms += 1;
        let second = changed
            .validate()
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert_ne!(first.digest, second.digest);
        assert_eq!(
            first.digest,
            first
                .plan
                .validate()
                .unwrap_or_else(|error| unreachable!("{error}"))
                .digest
        );
    }
}
