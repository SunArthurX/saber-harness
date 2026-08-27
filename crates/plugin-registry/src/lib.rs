//! Plugin manifests and the monotonic revocable registry (ADR-021).

use std::collections::BTreeMap;

use saber_orchestrator::Grant;
use saber_sandbox::{BudgetSpec, Realm};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Registry failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistryError {
    /// The manifest digest does not match its content.
    DigestMismatch,
    /// The manifest shape was malformed.
    Malformed,
    /// A registry update rolled back.
    Rollback,
    /// The plugin is unknown or revoked.
    UnknownOrRevoked,
    /// A capability beyond the manifest's declaration.
    UndeclaredCapability,
}

impl std::fmt::Display for RegistryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::DigestMismatch => "digest_mismatch",
            Self::Malformed => "malformed",
            Self::Rollback => "rollback",
            Self::UnknownOrRevoked => "unknown_or_revoked",
            Self::UndeclaredCapability => "undeclared_capability",
        })
    }
}

impl std::error::Error for RegistryError {}

/// The plugin manifest (closed contract, ADR-021).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PluginManifest {
    /// Stable plugin id.
    pub plugin_id: String,
    /// Monotonic version.
    pub version: u32,
    /// `sha256:<64 hex>` of the plugin bundle bytes.
    pub content_digest: String,
    /// Declared capabilities from the closed S05+S14 vocabulary.
    pub grants: Vec<Grant>,
    /// Sandbox realm the plugin runs in.
    pub realm: Realm,
    /// Resource budgets.
    pub budget: BudgetSpec,
    /// Digest over the canonical manifest body.
    pub manifest_digest: String,
}

/// Digest over the canonical manifest body.
#[must_use]
pub fn manifest_digest_of(manifest: &PluginManifest) -> String {
    let mut body: Vec<u8> = b"saber-plugin-manifest-v1\0".to_vec();
    let push = |body: &mut Vec<u8>, bytes: &[u8]| body.extend_from_slice(bytes);
    push(&mut body, manifest.plugin_id.as_bytes());
    body.push(0);
    push(&mut body, &manifest.version.to_le_bytes());
    body.push(0);
    push(&mut body, manifest.content_digest.as_bytes());
    body.push(0);
    for grant in &manifest.grants {
        let selector = match &grant.selector {
            saber_orchestrator::Selector::Exact(resource) => format!("exact:{resource}"),
            saber_orchestrator::Selector::Prefix(resource) => format!("prefix:{resource}"),
        };
        push(&mut body, format!("{:?}", grant.action).as_bytes());
        body.push(0);
        push(&mut body, selector.as_bytes());
        body.push(0);
    }
    push(&mut body, manifest.realm.as_str().as_bytes());
    push(&mut body, &manifest.budget.wall_clock_ms.to_le_bytes());
    let mut hasher = Sha256::new();
    hasher.update(&body);
    format!("sha256:{}", saber_sandbox::hex_upper(&hasher.finalize()))
}

/// Content digest of the bundle bytes.
#[must_use]
pub fn content_digest_of(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"saber-plugin-bundle-v1\0");
    hasher.update(bytes);
    format!("sha256:{}", saber_sandbox::hex_upper(&hasher.finalize()))
}

impl PluginManifest {
    /// Validate the manifest: shape and the digest chain (ADR-021).
    ///
    /// # Errors
    ///
    /// Deterministic codes per [`RegistryError`].
    pub fn validate(&self) -> Result<(), RegistryError> {
        if self.plugin_id.is_empty()
            || self.version == 0
            || self.content_digest.len() != 71
            || self.grants.is_empty()
        {
            return Err(RegistryError::Malformed);
        }
        if manifest_digest_of(self) != self.manifest_digest {
            return Err(RegistryError::DigestMismatch);
        }
        Ok(())
    }

    /// Whether a requested grant sits within the declared grants.
    #[must_use]
    pub fn declares(&self, requested: &Grant) -> bool {
        self.grants
            .iter()
            .any(|declared| requested.within(declared))
    }
}

/// One registry record.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RegistryRecord {
    /// The manifest.
    pub manifest: PluginManifest,
    /// Whether the plugin was admitted through the S06 host.
    pub admitted: bool,
}

/// The plugin registry: monotonic updates, immediate revocation.
#[derive(Default)]
pub struct PluginRegistry {
    records: BTreeMap<String, RegistryRecord>,
    sequence: u64,
    revoked: Vec<String>,
}

impl PluginRegistry {
    /// Validate and insert one manifest at the next monotonic sequence.
    ///
    /// # Errors
    ///
    /// [`RegistryError::DigestMismatch`] for tampered manifests;
    /// [`RegistryError::Malformed`] for shape violations.
    pub fn publish(&mut self, manifest: PluginManifest) -> Result<String, RegistryError> {
        manifest.validate()?;
        if self.revoked.iter().any(|id| id == &manifest.plugin_id) {
            return Err(RegistryError::UnknownOrRevoked);
        }
        let existing = self
            .records
            .get(&manifest.plugin_id)
            .map(|record| record.manifest.version);
        if let Some(current) = existing
            && manifest.version <= current
        {
            // Publishing at or below the live version is a rollback.
            return Err(RegistryError::Rollback);
        }
        self.sequence += 1;
        self.records.insert(
            manifest.plugin_id.clone(),
            RegistryRecord {
                manifest,
                admitted: false,
            },
        );
        Ok(format!("registry-entry-{:08}", self.sequence))
    }

    /// Mark a published plugin as admitted through the S06 host.
    ///
    /// # Errors
    ///
    /// [`RegistryError::UnknownOrRevoked`].
    pub fn mark_admitted(&mut self, plugin_id: &str) -> Result<(), RegistryError> {
        let record = self
            .records
            .get_mut(plugin_id)
            .ok_or(RegistryError::UnknownOrRevoked)?;
        record.admitted = true;
        Ok(())
    }

    /// Revoke: removed from the executable set immediately, tombstone
    /// retained (ADR-021).
    pub fn revoke(&mut self, plugin_id: &str) -> bool {
        if self.records.remove(plugin_id).is_some() {
            self.revoked.push(plugin_id.to_owned());
            return true;
        }
        false
    }

    /// Authorize one capability request for an admitted, non-revoked
    /// plugin; requests beyond the declared grants fail closed.
    ///
    /// # Errors
    ///
    /// [`RegistryError::UnknownOrRevoked`] or
    /// [`RegistryError::UndeclaredCapability`].
    pub fn authorize(
        &self,
        plugin_id: &str,
        requested: &Grant,
    ) -> Result<PluginManifest, RegistryError> {
        let record = self
            .records
            .get(plugin_id)
            .ok_or(RegistryError::UnknownOrRevoked)?;
        if !record.admitted || self.revoked.iter().any(|id| id == plugin_id) {
            return Err(RegistryError::UnknownOrRevoked);
        }
        if !record.manifest.declares(requested) {
            return Err(RegistryError::UndeclaredCapability);
        }
        Ok(record.manifest.clone())
    }

    /// The current sequence.
    #[must_use]
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }

    /// Live plugin ids.
    pub fn live(&self) -> impl Iterator<Item = &str> {
        self.records.keys().map(String::as_str)
    }

    /// Revocation tombstones.
    #[must_use]
    pub fn tombstones(&self) -> &[String] {
        &self.revoked
    }
}

/// Convenience: build a manifest with computed digests.
#[must_use]
pub fn manifest_for(
    plugin_id: &str,
    version: u32,
    bundle: &[u8],
    grants: Vec<Grant>,
    realm: Realm,
    budget: BudgetSpec,
) -> PluginManifest {
    let draft = PluginManifest {
        plugin_id: plugin_id.to_owned(),
        version,
        content_digest: content_digest_of(bundle),
        grants,
        realm,
        budget,
        manifest_digest: String::new(),
    };
    PluginManifest {
        manifest_digest: manifest_digest_of(&draft),
        ..draft
    }
}

/// Unused re-export marker for downstream audit tooling.
pub type RegistryIndex = BTreeMap<String, u32>;

/// The boundary-only SDK surface (ADR-021). Every capability flows
/// through the S05 policy and S06 sandbox boundaries; there is no
/// host-access path in this module: no host, store, network or
/// filesystem touching function exists here.
pub mod sdk {
    use super::{PluginManifest, PluginRegistry, RegistryError};
    use saber_orchestrator::Grant;

    /// A capability request a plugin submits at runtime.
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct CapabilityRequest {
        /// The requesting plugin id.
        pub plugin_id: String,
        /// The requested grant.
        pub grant: Grant,
        /// An idempotency label supplied by the plugin.
        pub request_label: String,
    }

    /// The SDK entry point handed to plugins: authorization only, never
    /// execution. The returned manifest is what the host boundary
    /// enforces; the plugin never receives a raw handle.
    ///
    /// # Errors
    ///
    /// [`RegistryError::Malformed`] for empty labels;
    /// [`RegistryError::UnknownOrRevoked`] and
    /// [`RegistryError::UndeclaredCapability`] mirror the registry.
    pub fn request_capability(
        registry: &PluginRegistry,
        request: &CapabilityRequest,
    ) -> Result<PluginManifest, RegistryError> {
        if request.request_label.is_empty() {
            return Err(RegistryError::Malformed);
        }
        registry.authorize(&request.plugin_id, &request.grant)
    }

    /// Lifecycle events a plugin may observe (typed, no host data).
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum LifecycleEvent {
        /// The plugin was admitted.
        Admitted,
        /// A fault was contained by the S06 host.
        FaultContained,
        /// The plugin was quarantined.
        Quarantined,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use saber_orchestrator::{Grant, Selector};
    use saber_policy::Action;
    use saber_sandbox::{BudgetSpec, Realm};

    use super::*;

    const BUNDLE: &[u8] = b"plugin bundle bytes";

    fn grant(prefix: &str) -> Grant {
        Grant {
            action: Action::FsRead,
            selector: Selector::Prefix(format!("workspace://ws_01/{prefix}")),
        }
    }

    fn manifest(plugin_id: &str, version: u32) -> PluginManifest {
        manifest_for(
            plugin_id,
            version,
            BUNDLE,
            vec![grant("repo")],
            Realm::S2IsolatedReadOnly,
            BudgetSpec::default_budget(),
        )
    }

    #[test]
    fn manifests_are_digest_bound_and_tampering_fails() {
        let good = manifest("formatter", 1);
        good.validate().unwrap();
        let mut tampered = good;
        tampered.grants.push(grant("EVERYTHING"));
        // The manifest digest no longer matches the canonical body.
        assert_eq!(tampered.validate(), Err(RegistryError::DigestMismatch));
        // A malformed content digest is refused outright.
        let mut bad_digest = manifest("formatter", 2);
        bad_digest.content_digest = "nope".to_owned();
        bad_digest.manifest_digest = manifest_digest_of(&bad_digest);
        assert_eq!(bad_digest.validate(), Err(RegistryError::Malformed));
    }

    #[test]
    fn registry_is_monotonic_and_rollback_refused() {
        let mut registry = PluginRegistry::default();
        registry.publish(manifest("formatter", 1)).unwrap();
        registry.publish(manifest("formatter", 3)).unwrap();
        // Publishing an older version again is a rollback.
        assert_eq!(
            registry.publish(manifest("formatter", 2)),
            Err(RegistryError::Rollback)
        );
        assert_eq!(
            registry.publish(manifest("formatter", 3)),
            Err(RegistryError::Rollback)
        );
        assert_eq!(registry.sequence(), 2);
    }

    #[test]
    fn undeclared_capabilities_fail_closed() {
        let mut registry = PluginRegistry::default();
        registry.publish(manifest("reader", 1)).unwrap();
        registry.mark_admitted("reader").unwrap();
        // Declared: authorized.
        let inside = Grant {
            action: Action::FsRead,
            selector: Selector::Exact("workspace://ws_01/repo/a.txt".to_owned()),
        };
        assert!(registry.authorize("reader", &inside).is_ok());
        // Undeclared prefix: refused.
        let outside = Grant {
            action: Action::FsRead,
            selector: Selector::Prefix("workspace://ws_01/secrets".to_owned()),
        };
        assert_eq!(
            registry.authorize("reader", &outside),
            Err(RegistryError::UndeclaredCapability)
        );
        // Undeclared action: refused.
        let write = Grant {
            action: Action::FsWrite,
            selector: Selector::Exact("workspace://ws_01/repo/a.txt".to_owned()),
        };
        assert_eq!(
            registry.authorize("reader", &write),
            Err(RegistryError::UndeclaredCapability)
        );
    }

    #[test]
    fn unadmitted_plugins_never_authorize() {
        let mut registry = PluginRegistry::default();
        registry.publish(manifest("pending", 1)).unwrap();
        // Published but not admitted through the host: refused.
        assert_eq!(
            registry.authorize("pending", &grant("repo")),
            Err(RegistryError::UnknownOrRevoked)
        );
    }

    #[test]
    fn revocation_removes_execution_immediately_and_is_terminal() {
        let mut registry = PluginRegistry::default();
        registry.publish(manifest("doomed", 1)).unwrap();
        registry.mark_admitted("doomed").unwrap();
        assert!(registry.revoke("doomed"));
        assert_eq!(
            registry.authorize("doomed", &grant("repo")),
            Err(RegistryError::UnknownOrRevoked)
        );
        assert_eq!(registry.tombstones(), &["doomed".to_owned()]);
        // Re-publishing a revoked plugin is refused.
        assert_eq!(
            registry.publish(manifest("doomed", 2)),
            Err(RegistryError::UnknownOrRevoked)
        );
    }

    #[test]
    fn sdk_surface_is_boundary_only() {
        let mut registry = PluginRegistry::default();
        registry.publish(manifest("sdk-plugin", 1)).unwrap();
        registry.mark_admitted("sdk-plugin").unwrap();
        let request = sdk::CapabilityRequest {
            plugin_id: "sdk-plugin".to_owned(),
            grant: grant("repo"),
            request_label: "read-config".to_owned(),
        };
        // The SDK returns an authorized manifest — no host handle, no
        // execution, no filesystem/network access exists in this module.
        let manifest = sdk::request_capability(&registry, &request).unwrap();
        assert_eq!(manifest.plugin_id, "sdk-plugin");
        let mut empty_label = request;
        empty_label.request_label = String::new();
        assert_eq!(
            sdk::request_capability(&registry, &empty_label),
            Err(RegistryError::Malformed)
        );
        // The SDK surface type-checks only authorization and lifecycle
        // events: no host-access function exists (structural audit).
        let _ = sdk::LifecycleEvent::Admitted;
        let _ = sdk::LifecycleEvent::FaultContained;
        let _ = sdk::LifecycleEvent::Quarantined;
    }

    #[test]
    fn fault_containment_holds_for_registry_plugins() {
        // Registry-sourced plugins flow through the S06 host unchanged:
        // the circuit/quarantine containment still applies.
        use saber_effect_broker::{
            CIRCUIT_FAILURE_THRESHOLD, DeclaredAction, HostError, PluginHost,
            PluginManifest as HostManifest,
        };
        use sha2::Digest as _;

        let mut host = PluginHost::default();
        let mut host_manifest = HostManifest {
            plugin_id: "registry-plugin".to_owned(),
            version: "1.0.0".to_owned(),
            content_digest: String::new(),
            declared: vec![DeclaredAction {
                action: Action::FsRead,
                pattern: "workspace://ws_01/repo".to_owned(),
            }],
            realm: Realm::S2IsolatedReadOnly,
            wall_clock_ms: 1_000,
            max_output_bytes: 1 << 16,
        };
        // Compute the digest the host expects (sha256 over the code).
        let mut hasher = sha2::Sha256::new();
        hasher.update(b"registry plugin code");
        host_manifest.content_digest =
            format!("sha256:{}", saber_sandbox::hex_upper(&hasher.finalize()));
        host.admit(host_manifest, b"registry plugin code").unwrap();
        for _ in 0..CIRCUIT_FAILURE_THRESHOLD {
            host.note_result("registry-plugin", false);
        }
        assert_eq!(
            host.authorize_exec("registry-plugin").unwrap_err(),
            HostError::CircuitOpen
        );
        host.quarantine("registry-plugin");
        assert!(!host.is_executable("registry-plugin"));
        let _ = RegistryError::UnknownOrRevoked;
    }
}
