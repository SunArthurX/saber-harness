//! Plugin and generated-code host admission with fault containment.
//!
//! Plugins and generated code run only after manifest admission (stable id,
//! version, content digest, closed-vocabulary declared actions, realm and
//! budgets) and inside a per-plugin fault domain with a deterministic circuit
//! breaker and a terminal quarantine kill switch. A quarantined host executes
//! zero effects regardless of policy permits (ADR-008, SEC-ISO-005).

use std::collections::BTreeMap;

use saber_policy::{Action, PolicyError, ResourcePattern};
use saber_sandbox::Realm;
use sha2::{Digest, Sha256};

/// Consecutive failures before the circuit opens.
pub const CIRCUIT_FAILURE_THRESHOLD: u32 = 3;

/// Host admission failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HostError {
    /// The manifest is malformed.
    InvalidManifest,
    /// The declared content digest does not match the code bytes.
    DigestMismatch,
    /// The declared action is outside the closed vocabulary.
    UnknownAction,
    /// The declared realm exceeds the S06 plugin ceiling.
    RealmTooHigh,
    /// The plugin is quarantined; only an operator can reset the host.
    Quarantined,
    /// The plugin circuit is open after repeated failures.
    CircuitOpen,
}

impl std::fmt::Display for HostError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidManifest => "invalid_manifest",
            Self::DigestMismatch => "digest_mismatch",
            Self::UnknownAction => "unknown_action",
            Self::RealmTooHigh => "realm_too_high",
            Self::Quarantined => "quarantined",
            Self::CircuitOpen => "circuit_open",
        })
    }
}

/// Declared capability of one plugin.
#[derive(Clone, Debug)]
pub struct DeclaredAction {
    /// Closed-vocabulary action.
    pub action: Action,
    /// Exact or prefix resource selector string.
    pub pattern: String,
}

/// Admission manifest of one plugin or generated-code bundle.
#[derive(Clone, Debug)]
pub struct PluginManifest {
    /// Stable plugin identifier.
    pub plugin_id: String,
    /// Stable version.
    pub version: String,
    /// Expected `sha256:<64 hex>` digest of the code bytes.
    pub content_digest: String,
    /// Declared actions with resource selectors.
    pub declared: Vec<DeclaredAction>,
    /// Execution realm the plugin requires.
    pub realm: Realm,
    /// Wall-clock budget per execution in milliseconds.
    pub wall_clock_ms: u64,
    /// Maximum captured output bytes.
    pub max_output_bytes: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CircuitState {
    Closed,
    Open,
    Quarantined,
}

struct PluginEntry {
    manifest: PluginManifest,
    consecutive_failures: u32,
    circuit: CircuitState,
}

/// The isolated plugin host.
#[derive(Default)]
pub struct PluginHost {
    entries: BTreeMap<String, PluginEntry>,
}

impl PluginHost {
    /// Admit a plugin after verifying its code digest.
    ///
    /// # Errors
    ///
    /// Rejects malformed manifests, digest mismatches, unknown actions and
    /// realms above the S06 plugin ceiling (S3).
    pub fn admit(&mut self, manifest: PluginManifest, code: &[u8]) -> Result<(), HostError> {
        if manifest.plugin_id.is_empty()
            || manifest.version.is_empty()
            || manifest.declared.is_empty()
            || manifest.wall_clock_ms == 0
            || manifest.max_output_bytes == 0
        {
            return Err(HostError::InvalidManifest);
        }
        if !manifest.content_digest.starts_with("sha256:")
            || manifest.content_digest.len() != 71
            || manifest.content_digest[7..]
                .bytes()
                .any(|byte| !byte.is_ascii_hexdigit())
        {
            return Err(HostError::InvalidManifest);
        }
        if manifest.realm > Realm::S3IsolatedOverlay {
            return Err(HostError::RealmTooHigh);
        }
        for declared in &manifest.declared {
            if ResourcePattern::prefix(declared.action, &declared.pattern).is_err()
                && ResourcePattern::exact(declared.action, &declared.pattern).is_err()
            {
                return Err(HostError::UnknownAction);
            }
        }
        let mut hasher = Sha256::new();
        hasher.update(code);
        let actual = format!("sha256:{}", hex_upper(&hasher.finalize()));
        if !constant_time_eq(&actual, &manifest.content_digest) {
            return Err(HostError::DigestMismatch);
        }
        self.entries.insert(
            manifest.plugin_id.clone(),
            PluginEntry {
                manifest,
                consecutive_failures: 0,
                circuit: CircuitState::Closed,
            },
        );
        Ok(())
    }

    /// Authorize one execution of an admitted plugin.
    ///
    /// # Errors
    ///
    /// Quarantined or circuit-open plugins are denied.
    pub fn authorize_exec(&self, plugin_id: &str) -> Result<&PluginManifest, HostError> {
        let entry = self
            .entries
            .get(plugin_id)
            .ok_or(HostError::InvalidManifest)?;
        match entry.circuit {
            CircuitState::Quarantined => Err(HostError::Quarantined),
            CircuitState::Open => Err(HostError::CircuitOpen),
            CircuitState::Closed => Ok(&entry.manifest),
        }
    }

    /// Record one execution result; repeated failures open the circuit.
    pub fn note_result(&mut self, plugin_id: &str, ok: bool) {
        let Some(entry) = self.entries.get_mut(plugin_id) else {
            return;
        };
        if ok {
            entry.consecutive_failures = 0;
            if entry.circuit == CircuitState::Open {
                entry.circuit = CircuitState::Closed;
            }
            return;
        }
        entry.consecutive_failures += 1;
        if entry.consecutive_failures >= CIRCUIT_FAILURE_THRESHOLD {
            entry.circuit = CircuitState::Open;
        }
    }

    /// Terminal kill switch: quarantined plugins never execute again through
    /// this host.
    pub fn quarantine(&mut self, plugin_id: &str) {
        if let Some(entry) = self.entries.get_mut(plugin_id) {
            entry.circuit = CircuitState::Quarantined;
        }
    }

    /// Whether a plugin is currently executable.
    #[must_use]
    pub fn is_executable(&self, plugin_id: &str) -> bool {
        self.authorize_exec(plugin_id).is_ok()
    }

    /// Access an admitted manifest.
    ///
    /// # Errors
    ///
    /// Unknown plugin.
    pub fn manifest(&self, plugin_id: &str) -> Result<&PluginManifest, HostError> {
        self.entries
            .get(plugin_id)
            .map(|entry| &entry.manifest)
            .ok_or(HostError::InvalidManifest)
    }
}

fn hex_upper(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02X}");
    }
    out
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let (left, right) = (left.as_bytes(), right.as_bytes());
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0_u8;
    for (a, b) in left.iter().zip(right) {
        difference |= a ^ b;
    }
    difference == 0
}

/// Map sandbox plan realm violations onto the host denial path.
#[must_use]
pub fn action_out_of_vocabulary(error: PolicyError) -> bool {
    error == PolicyError::UnknownAction
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

    fn manifest() -> PluginManifest {
        PluginManifest {
            plugin_id: "formatter".to_owned(),
            version: "1.0.0".to_owned(),
            content_digest: String::new(),
            declared: vec![DeclaredAction {
                action: Action::FsRead,
                pattern: "workspace://ws_01/repo".to_owned(),
            }],
            realm: Realm::S2IsolatedReadOnly,
            wall_clock_ms: 5_000,
            max_output_bytes: 1 << 16,
        }
    }

    fn digest_of(code: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(code);
        format!("sha256:{}", hex_upper(&hasher.finalize()))
    }

    #[test]
    fn admission_requires_matching_digest_and_closed_actions() {
        let mut host = PluginHost::default();
        let mut wrong = manifest();
        wrong.content_digest = digest_of(b"different bytes");
        assert_eq!(
            host.admit(wrong, b"plugin code"),
            Err(HostError::DigestMismatch)
        );
        let mut unknown = manifest();
        unknown.content_digest = digest_of(b"plugin code");
        unknown.declared = vec![DeclaredAction {
            action: Action::FsRead,
            pattern: "not a resource".to_owned(),
        }];
        assert_eq!(
            host.admit(unknown, b"plugin code"),
            Err(HostError::UnknownAction)
        );
        let mut too_high = manifest();
        too_high.content_digest = digest_of(b"plugin code");
        too_high.realm = Realm::S4EgressMediated;
        assert_eq!(
            host.admit(too_high, b"plugin code"),
            Err(HostError::RealmTooHigh)
        );
        let mut valid = manifest();
        valid.content_digest = digest_of(b"plugin code");
        assert!(host.admit(valid, b"plugin code").is_ok());
    }

    #[test]
    fn fault_domain_opens_circuit_then_stays_contained() {
        let mut host = PluginHost::default();
        let mut valid = manifest();
        valid.content_digest = digest_of(b"plugin code");
        host.admit(valid, b"plugin code")
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert!(host.is_executable("formatter"));
        host.note_result("formatter", false);
        host.note_result("formatter", false);
        assert!(host.is_executable("formatter"));
        host.note_result("formatter", false);
        assert!(!host.is_executable("formatter"));
        assert_eq!(
            host.authorize_exec("formatter").unwrap_err(),
            HostError::CircuitOpen
        );
        host.note_result("formatter", true);
        assert!(host.is_executable("formatter"));
        host.quarantine("formatter");
        assert_eq!(
            host.authorize_exec("formatter").unwrap_err(),
            HostError::Quarantined
        );
        host.note_result("formatter", true);
        assert!(!host.is_executable("formatter"));
    }

    #[test]
    fn one_plugin_fault_does_not_touch_neighbors() {
        let mut host = PluginHost::default();
        for id in ["formatter", "linter"] {
            let mut entry = manifest();
            entry.plugin_id = id.to_owned();
            entry.content_digest = digest_of(b"plugin code");
            host.admit(entry, b"plugin code")
                .unwrap_or_else(|error| unreachable!("{error}"));
        }
        host.quarantine("formatter");
        assert!(!host.is_executable("formatter"));
        assert!(host.is_executable("linter"));
    }
}
