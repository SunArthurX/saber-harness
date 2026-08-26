//! Minimal allowlisted child environment construction.
//!
//! The host environment is never inherited. A child receives exactly the
//! plan's explicit allowlist plus broker lease channels, and every key is
//! checked against a conservative sensitive-key policy so home directories,
//! SSH agents, cloud credentials, IPC endpoints and signing material cannot
//! cross the boundary even by accident (ADR-008, SEC-ISO-006).

use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use crate::plan::{EnvSpec, MountSpec, PlanError};

/// Keys that are always rejected from child environments.
pub const SENSITIVE_ENV_KEYS: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
    "GPG_TTY",
    "GPG_AGENT_INFO",
    "KRB5CCNAME",
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_RUNTIME_DIR",
    "XDG_CONFIG_HOME",
    "CLOUDSDK_CONFIG",
    "AWS_PROFILE",
    "AZURE_CONFIG_DIR",
    "SUDO_ASKPASS",
];

/// Sensitive substrings matched against the whole key (case-insensitive).
const SENSITIVE_SUBSTRINGS: &[&str] = &[
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "PASSWD",
    "CREDENTIAL",
    "PRIVATE_KEY",
    "ACCESS_KEY",
    "API_KEY",
];

/// Decide whether one environment key may ever appear in the static
/// allowlist. Exact sensitive names and any key whose name embeds a
/// credential word are rejected; callers cannot opt out.
#[must_use]
pub fn is_sensitive_key(key: &str) -> bool {
    is_reserved_env_key(key) || {
        let upper = key.to_ascii_uppercase();
        SENSITIVE_SUBSTRINGS
            .iter()
            .any(|needle| upper.contains(needle))
    }
}

/// Decide whether one environment key is a reserved host-identity name that
/// no child may ever receive, including through a broker lease channel.
#[must_use]
pub fn is_reserved_env_key(key: &str) -> bool {
    SENSITIVE_ENV_KEYS.contains(&key)
}

/// Environment construction failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EnvironmentError {
    /// A key is sensitive or malformed.
    RejectedKey,
    /// A value is malformed.
    RejectedValue,
}

impl Display for EnvironmentError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::RejectedKey => "rejected_key",
            Self::RejectedValue => "rejected_value",
        })
    }
}

impl std::error::Error for EnvironmentError {}

/// A secret value that never renders in debug output or logs.
#[derive(Clone, Eq, PartialEq)]
pub struct RedactableValue(pub String);

impl std::fmt::Debug for RedactableValue {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("RedactableValue([redacted])")
    }
}

/// Build the complete child environment from a validated plan plus broker
/// lease material. This is the only sanctioned construction path.
///
/// # Errors
///
/// Rejects sensitive keys, malformed values and injected keys that were not
/// declared as lease channels in the plan.
pub fn build_environment(
    spec: &EnvSpec,
    mounts: &[MountSpec],
    injected: &BTreeMap<String, RedactableValue>,
) -> Result<BTreeMap<String, String>, EnvironmentError> {
    let mut environment = BTreeMap::new();
    for (key, value) in &spec.allow {
        insert_checked(&mut environment, key, value, mounts, false)?;
    }
    for channel in &spec.lease_channels {
        if let Some(material) = injected.get(channel) {
            // Lease channels are broker-mediated injection points: they may
            // carry credential-shaped names by design but never reserved
            // host-identity names.
            insert_checked(&mut environment, channel, &material.0, mounts, true)?;
        }
    }
    for unexpected in injected.keys() {
        if !spec.lease_channels.contains(unexpected) {
            return Err(EnvironmentError::RejectedKey);
        }
    }
    Ok(environment)
}

fn insert_checked(
    environment: &mut BTreeMap<String, String>,
    key: &str,
    value: &str,
    mounts: &[MountSpec],
    lease_channel: bool,
) -> Result<(), EnvironmentError> {
    let key_rejected = if lease_channel {
        is_reserved_env_key(key)
    } else {
        is_sensitive_key(key)
    };
    if key.is_empty()
        || key.contains('=')
        || key.contains('\0')
        || key_rejected
        || value.contains('\0')
    {
        return Err(EnvironmentError::RejectedKey);
    }
    if key == "PATH" && !path_confined(value, mounts) {
        return Err(EnvironmentError::RejectedValue);
    }
    environment.insert(key.to_owned(), value.to_owned());
    Ok(())
}

fn path_confined(value: &str, mounts: &[MountSpec]) -> bool {
    value.split(':').all(|entry| {
        mounts
            .iter()
            .any(|mount| mount.executable && entry.starts_with(&format!("/{}/", mount.target)))
    })
}

/// Map a plan validation error onto the environment denial path for callers
/// that validate plans and environments together.
#[must_use]
pub fn plan_error_is_environment(error: PlanError) -> bool {
    error == PlanError::InvalidEnvironment
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
    use crate::plan::MountSource;

    fn tools_mount() -> MountSpec {
        MountSpec {
            target: "tools".to_owned(),
            source: MountSource::SystemTools {
                host_path: PathBuf::from("/usr"),
            },
            writable: false,
            executable: true,
        }
    }

    fn spec(allow: &[(&str, &str)], channels: &[&str]) -> EnvSpec {
        EnvSpec {
            allow: allow
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect(),
            lease_channels: channels.iter().map(ToString::to_string).collect(),
        }
    }

    fn injected(pairs: &[(&str, &str)]) -> BTreeMap<String, RedactableValue> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), RedactableValue((*value).to_owned())))
            .collect()
    }

    #[test]
    fn sensitive_keys_are_rejected_by_exact_name_and_pattern() {
        for key in [
            "HOME",
            "SSH_AUTH_SOCK",
            "AWS_SECRET_ACCESS_KEY",
            "GITHUB_TOKEN",
            "MY_API_KEY",
            "DB_PASSWORD",
            "SERVICE_ACCOUNT_CREDENTIAL",
        ] {
            assert!(is_sensitive_key(key), "{key} must be sensitive");
        }
        assert!(!is_sensitive_key("RUST_LOG"));
        assert!(!is_sensitive_key("CI"));
        assert!(!is_sensitive_key("LC_ALL"));
    }

    #[test]
    fn built_environment_contains_only_declared_entries() {
        let env_spec = spec(
            &[("RUST_LOG", "debug"), ("PATH", "/tools/bin")],
            &["DEPLOY_TOKEN"],
        );
        let material = injected(&[("DEPLOY_TOKEN", "lease-material-value")]);
        let built = build_environment(&env_spec, &[tools_mount()], &material)
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert_eq!(built.len(), 3);
        assert_eq!(built["DEPLOY_TOKEN"], "lease-material-value");
        let mut undeclared = injected(&[("AWS_SECRET_ACCESS_KEY", "x")]);
        undeclared.insert(
            "EXTRA".to_owned(),
            RedactableValue("not-a-channel".to_owned()),
        );
        assert_eq!(
            build_environment(&env_spec, &[tools_mount()], &undeclared).unwrap_err(),
            EnvironmentError::RejectedKey
        );
    }

    #[test]
    fn host_environment_cannot_leak_through_construction() {
        let env_spec = spec(&[], &[]);
        let built = build_environment(&env_spec, &[tools_mount()], &BTreeMap::new())
            .unwrap_or_else(|error| unreachable!("{error}"));
        for (host_key, _) in std::env::vars_os() {
            let Some(host_key) = host_key.to_str() else {
                continue;
            };
            assert!(
                !built.contains_key(host_key) || !is_sensitive_key(host_key),
                "host key {host_key} crossed the boundary"
            );
        }
    }

    #[test]
    fn redactable_value_never_prints_material() {
        let value = RedactableValue("super-secret-material".to_owned());
        let rendered = format!("{value:?}");
        assert!(!rendered.contains("super-secret-material"));
        assert!(rendered.contains("[redacted]"));
    }
}
