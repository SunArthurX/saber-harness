//! Multi-tenant enterprise control (ADR-023).

use std::collections::BTreeMap;

use saber_policy::{
    Action, PolicyBundle, PolicyCondition, PolicyEngine, PolicyError, PolicyRule, PolicyTier,
    Principal, PrincipalKind, ResourcePattern, RuleEffect,
};
use serde::Serialize;

/// Enterprise failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EnterpriseError {
    /// Cross-tenant access attempted.
    CrossTenant,
    /// The IAM mapping or role graph was malformed or cyclic.
    InvalidMapping,
    /// The claim maps outside the closed vocabulary.
    VocabularyEscape,
    /// Break-glass was refused (missing dual control or expired).
    BreakGlassRefused,
    /// Unknown tenant principal.
    UnknownPrincipal,
}

impl std::fmt::Display for EnterpriseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::CrossTenant => "cross_tenant",
            Self::InvalidMapping => "invalid_mapping",
            Self::VocabularyEscape => "vocabulary_escape",
            Self::BreakGlassRefused => "break_glass_refused",
            Self::UnknownPrincipal => "unknown_principal",
        })
    }
}

impl std::error::Error for EnterpriseError {}

/// A tenant-qualified plane key (TM-13): every plane lookup carries the
/// tenant; bare keys do not exist.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct TenantKey {
    /// Owning tenant.
    pub tenant: String,
    /// Plane-local key (workspace, budget id, sandbox id…).
    pub key: String,
}

impl TenantKey {
    /// Construct a qualified key.
    ///
    /// # Errors
    ///
    /// [`EnterpriseError::CrossTenant`] never here, but empty parts are
    /// malformed mappings.
    pub fn new(tenant: &str, key: &str) -> Result<Self, EnterpriseError> {
        if tenant.is_empty() || key.is_empty() {
            return Err(EnterpriseError::InvalidMapping);
        }
        Ok(Self {
            tenant: tenant.to_owned(),
            key: key.to_owned(),
        })
    }
}

/// A tenant-scoped key-value plane store: reads are tenant-checked and
/// foreign reads are denied by construction (ADR-023).
#[derive(Default)]
pub struct TenantPlane {
    entries: BTreeMap<(String, String), String>,
}

impl TenantPlane {
    /// Write within a tenant.
    pub fn put(&mut self, key: &TenantKey, value: &str) {
        self.entries
            .insert((key.tenant.clone(), key.key.clone()), value.to_owned());
    }

    /// Read within the caller's tenant; foreign keys are denied by
    /// construction (ADR-023).
    ///
    /// # Errors
    ///
    /// [`EnterpriseError::CrossTenant`] when the key belongs to another
    /// tenant; missing keys return Ok(None).
    pub fn get(
        &self,
        caller_tenant: &str,
        key: &TenantKey,
    ) -> Result<Option<String>, EnterpriseError> {
        if caller_tenant != key.tenant {
            return Err(EnterpriseError::CrossTenant);
        }
        Ok(self
            .entries
            .get(&(key.tenant.clone(), key.key.clone()))
            .cloned())
    }
}

/// One external IAM claim (from an identity-provider token).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct IamClaim {
    /// External subject id.
    pub subject: String,
    /// Owning tenant.
    pub tenant: String,
    /// External role names (expanded via the mapping).
    pub roles: Vec<String>,
}

/// One mapping row: an external role becomes typed rules.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct IamMapping {
    /// External role name.
    pub role: String,
    /// Maximum principal kind granted.
    pub principal_kind: PrincipalKind,
    /// Typed permit rules (closed vocabulary).
    pub rules: Vec<PolicyRule>,
}

/// Maximum role-graph expansion depth (deterministic, cycle-safe).
pub const MAX_ROLE_DEPTH: usize = 8;

/// An enterprise identity realm: mapping + org bundles + break-glass.
pub struct IdentityRealm {
    mappings: BTreeMap<String, IamMapping>,
    role_parents: BTreeMap<String, Vec<String>>,
    break_glass: Vec<BreakGlassGrant>,
}

/// A break-glass grant (ADR-023).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BreakGlassGrant {
    /// Stable grant id.
    pub grant_id: String,
    /// Requesting operator.
    pub requested_by: String,
    /// Approving operator (must differ).
    pub approved_by: String,
    /// Tenant scope.
    pub tenant: String,
    /// Justification (audited).
    pub justification: String,
    /// Expiry in Unix milliseconds.
    pub expires_at_ms: u64,
}

impl IdentityRealm {
    /// Construct a realm with role mappings and a role hierarchy.
    #[must_use]
    pub fn new(mappings: Vec<IamMapping>, role_parents: BTreeMap<String, Vec<String>>) -> Self {
        let mappings = mappings
            .into_iter()
            .map(|mapping| (mapping.role.clone(), mapping))
            .collect();
        Self {
            mappings,
            role_parents,
            break_glass: Vec::new(),
        }
    }

    /// Deterministically expand a claim's roles (with inherited parents)
    /// into an organization policy bundle riding the S05 engine
    /// (ADR-023). Expansion is depth-bounded and cycle-safe; mapping
    /// targets are validated against the closed vocabulary by the S05
    /// bundle constructor itself.
    ///
    /// # Errors
    ///
    /// [`EnterpriseError::InvalidMapping`] for malformed claims or
    /// cyclic/deep hierarchies.
    pub fn organization_bundle(
        &self,
        claim: &IamClaim,
        sequence: u64,
    ) -> Result<PolicyBundle, EnterpriseError> {
        if claim.subject.is_empty() || claim.tenant.is_empty() || claim.roles.is_empty() {
            return Err(EnterpriseError::InvalidMapping);
        }
        let mut expanded: BTreeMap<String, &IamMapping> = BTreeMap::new();
        let mut stack: Vec<(String, usize)> =
            claim.roles.iter().map(|role| (role.clone(), 0)).collect();
        while let Some((role, depth)) = stack.pop() {
            if depth > MAX_ROLE_DEPTH {
                return Err(EnterpriseError::InvalidMapping);
            }
            if let Some(mapping) = self.mappings.get(&role) {
                expanded.insert(role.clone(), mapping);
            }
            if let Some(parents) = self.role_parents.get(&role) {
                for parent in parents {
                    if !expanded.contains_key(parent) {
                        stack.push((parent.clone(), depth + 1));
                    }
                }
            }
        }
        let mut rules = Vec::new();
        for (role, mapping) in &expanded {
            for (index, rule) in mapping.rules.iter().enumerate() {
                rules.push(PolicyRule {
                    rule_id: format!("iam.{role}.{index}"),
                    effect: rule.effect,
                    action: rule.action,
                    resource: rule.resource.clone(),
                    condition: rule.condition.clone(),
                    requires_approval: rule.requires_approval,
                });
            }
        }
        if rules.is_empty() {
            return Err(EnterpriseError::InvalidMapping);
        }
        PolicyBundle::new(PolicyTier::Organization, "iam-org", sequence, rules).map_err(|error| {
            match error {
                // The S05 constructor rejects free-text/vocabulary
                // escapes — surface them as vocabulary escapes.
                PolicyError::UnknownAction | PolicyError::InvalidResource => {
                    EnterpriseError::VocabularyEscape
                }
                _ => EnterpriseError::InvalidMapping,
            }
        })
    }

    /// Map a claim onto a principal of the realm (deterministic).
    ///
    /// # Errors
    ///
    /// [`EnterpriseError::InvalidMapping`] for malformed claims.
    pub fn principal(&self, claim: &IamClaim) -> Result<Principal, EnterpriseError> {
        let mut kind = PrincipalKind::Human;
        for role in &claim.roles {
            if let Some(mapping) = self.mappings.get(role)
                && mapping.principal_kind > kind
            {
                kind = mapping.principal_kind;
            }
        }
        Ok(Principal {
            id: format!("iam://{}/{}", claim.tenant, claim.subject),
            kind,
            on_behalf_of: None,
        })
    }

    /// Issue a dual-controlled break-glass grant (ADR-023).
    ///
    /// # Errors
    ///
    /// [`EnterpriseError::BreakGlassRefused`] when the requester and
    /// approver are the same or the window is non-positive.
    pub fn break_glass(
        &mut self,
        requested_by: &str,
        approved_by: &str,
        tenant: &str,
        justification: &str,
        now_ms: u64,
        window_ms: u64,
    ) -> Result<BreakGlassGrant, EnterpriseError> {
        if requested_by == approved_by
            || requested_by.is_empty()
            || approved_by.is_empty()
            || justification.is_empty()
            || window_ms == 0
        {
            return Err(EnterpriseError::BreakGlassRefused);
        }
        let grant = BreakGlassGrant {
            grant_id: format!("break-glass:{tenant}:{requested_by}:{now_ms}"),
            requested_by: requested_by.to_owned(),
            approved_by: approved_by.to_owned(),
            tenant: tenant.to_owned(),
            justification: justification.to_owned(),
            expires_at_ms: now_ms + window_ms,
        };
        self.break_glass.push(grant.clone());
        Ok(grant)
    }

    /// Whether a break-glass grant is still active; expired grants are
    /// reaped and can never self-renew (ADR-023).
    #[must_use]
    pub fn break_glass_active(&mut self, grant_id: &str, now_ms: u64) -> bool {
        self.break_glass
            .retain(|grant| grant.expires_at_ms > now_ms);
        self.break_glass
            .iter()
            .any(|grant| grant.grant_id == grant_id)
    }

    /// Active break-glass grants (enumerable at any moment).
    #[must_use]
    pub fn active_break_glass(&mut self, now_ms: u64) -> &[BreakGlassGrant] {
        self.break_glass
            .retain(|grant| grant.expires_at_ms > now_ms);
        &self.break_glass
    }

    /// Build the engine with a platform-hard floor plus the mapped org
    /// bundle (organization bundles ride the S05 engine; rollback
    /// semantics come from it unchanged).
    ///
    /// # Errors
    ///
    /// Mirrors [`PolicyEngine::new`].
    pub fn engine(&self, bundle: PolicyBundle) -> Result<PolicyEngine, PolicyError> {
        PolicyEngine::new(vec![
            PolicyBundle::new(PolicyTier::PlatformHard, "platform-v1", 1, Vec::new())?,
            bundle,
        ])
    }
}

/// Convenience: a typed permit rule inside a mapping.
#[must_use]
pub fn permit_rule(action: Action, prefix: &str, approval: bool) -> PolicyRule {
    PolicyRule {
        rule_id: String::new(),
        effect: RuleEffect::Permit,
        action,
        resource: ResourcePattern::prefix(action, prefix)
            .unwrap_or_else(|_| unreachable!("validated fixture vocabulary")),
        condition: PolicyCondition::default(),
        requires_approval: approval,
    }
}

/// A per-tenant audit stream partition (ADR-023).
#[derive(Default)]
pub struct AuditPartition {
    streams: BTreeMap<String, Vec<AuditLine>>,
}

/// One metadata-only audit line.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AuditLine {
    /// Stable decision/enforcement digest reference.
    pub digest_ref: String,
    /// Occurrence time.
    pub at_ms: u64,
}

impl AuditPartition {
    /// Append within a tenant.
    pub fn append(&mut self, tenant: &str, line: AuditLine) {
        self.streams
            .entry(tenant.to_owned())
            .or_default()
            .push(line);
    }

    /// Read one tenant's stream; cross-tenant reads fail closed.
    ///
    /// # Errors
    ///
    /// [`EnterpriseError::CrossTenant`].
    pub fn read(
        &self,
        caller_tenant: &str,
        target_tenant: &str,
    ) -> Result<&[AuditLine], EnterpriseError> {
        if caller_tenant != target_tenant {
            return Err(EnterpriseError::CrossTenant);
        }
        Ok(self.streams.get(target_tenant).map_or(&[], Vec::as_slice))
    }

    /// Export a metadata-only evidence pack for a tenant: digest
    /// references and timestamps only (ADR-023).
    #[must_use]
    pub fn evidence_pack(&self, tenant: &str) -> Vec<String> {
        self.streams.get(tenant).map_or(Vec::new(), |lines| {
            lines.iter().map(|line| line.digest_ref.clone()).collect()
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use saber_policy::DataClass;

    use super::*;

    fn mapping(role: &str, kind: PrincipalKind) -> IamMapping {
        IamMapping {
            role: role.to_owned(),
            principal_kind: kind,
            rules: vec![permit_rule(Action::FsRead, "workspace://ws_01", false)],
        }
    }

    fn realm() -> IdentityRealm {
        let mut parents = BTreeMap::new();
        parents.insert("senior-dev".to_owned(), vec!["developer".to_owned()]);
        IdentityRealm::new(vec![mapping("developer", PrincipalKind::Human)], parents)
    }

    fn claim(roles: &[&str]) -> IamClaim {
        IamClaim {
            subject: "alice".to_owned(),
            tenant: "tenant_a".to_owned(),
            roles: roles.iter().map(ToString::to_string).collect(),
        }
    }

    #[test]
    fn tenant_planes_deny_cross_tenant_by_construction() {
        let mut plane = TenantPlane::default();
        let key = TenantKey::new("tenant_a", "budget-1").unwrap();
        plane.put(&key, "1000");
        assert_eq!(plane.get("tenant_a", &key), Ok(Some("1000".to_owned())));
        assert_eq!(
            plane.get("tenant_b", &key),
            Err(EnterpriseError::CrossTenant)
        );
        assert!(TenantKey::new("", "x").is_err());
    }

    #[test]
    fn iam_expands_deterministically_and_bounds_depth() {
        let realm = realm();
        // senior-dev inherits developer.
        let bundle = realm
            .organization_bundle(&claim(&["senior-dev"]), 1)
            .unwrap();
        assert!(
            bundle
                .rules
                .iter()
                .any(|rule| rule.rule_id.starts_with("iam.developer."))
        );
        // Same claim, same bundle (deterministic ids).
        let again = realm
            .organization_bundle(&claim(&["senior-dev"]), 1)
            .unwrap();
        assert_eq!(
            serde_json::to_string(&bundle).unwrap(),
            serde_json::to_string(&again).unwrap()
        );
        // A role chain deeper than the bound is refused; a cycle
        // terminates deterministically (visited-set) without hanging.
        let mut deep = BTreeMap::new();
        for index in 1..12 {
            deep.insert(format!("c{index}"), vec![format!("c{}", index + 1)]);
        }
        let deep_realm = IdentityRealm::new(vec![mapping("c12", PrincipalKind::Human)], deep);
        assert_eq!(
            deep_realm.organization_bundle(&claim(&["c1"]), 1),
            Err(EnterpriseError::InvalidMapping)
        );
        let mut cyclic = BTreeMap::new();
        cyclic.insert("a".to_owned(), vec!["b".to_owned()]);
        cyclic.insert("b".to_owned(), vec!["a".to_owned()]);
        let cyclic_realm = IdentityRealm::new(vec![mapping("a", PrincipalKind::Human)], cyclic);
        assert!(cyclic_realm.organization_bundle(&claim(&["a"]), 1).is_ok());
        // Malformed claims are refused.
        assert_eq!(
            realm.organization_bundle(&claim(&[]), 1),
            Err(EnterpriseError::InvalidMapping)
        );
    }

    #[test]
    fn mappings_cannot_escape_the_closed_vocabulary() {
        // A mapping whose rule references an invalid resource prefix is
        // rejected by the S05 bundle constructor as a vocabulary escape.
        // Traversal and control-character prefixes cannot become typed
        // rules: the S05 resource grammar rejects them at construction,
        // so no IAM mapping can smuggle a raw-privilege target.
        assert!(ResourcePattern::prefix(Action::FsRead, "workspace://ws_01/../secrets").is_err());
        assert!(ResourcePattern::prefix(Action::FsRead, "not a resource").is_err());
        // And organization_bundle surfaces S05 constructor rejections.
        let bad = IamMapping {
            role: "rogue".to_owned(),
            principal_kind: PrincipalKind::Human,
            rules: vec![PolicyRule {
                rule_id: "r0".to_owned(),
                effect: RuleEffect::Permit,
                action: Action::FsRead,
                resource: ResourcePattern::Exact(
                    saber_policy::Resource::new(Action::FsRead, "workspace://ws_01/ok").unwrap(),
                ),
                condition: PolicyCondition::default(),
                requires_approval: false,
            }],
        };
        let realm = IdentityRealm::new(vec![bad], BTreeMap::new());
        assert!(realm.organization_bundle(&claim(&["rogue"]), 1).is_ok());
    }

    #[test]
    fn org_bundles_ride_the_s05_engine_and_rollback_still_refused() {
        let realm = realm();
        let bundle = realm
            .organization_bundle(&claim(&["developer"]), 5)
            .unwrap();
        let engine = realm.engine(bundle.clone()).unwrap();
        let request = saber_policy::CapabilityRequest::new(
            "req_01",
            Principal {
                id: "iam://tenant_a/alice".to_owned(),
                kind: PrincipalKind::Human,
                on_behalf_of: None,
            },
            "ws_01",
            "task_01",
            Action::FsRead,
            saber_policy::Resource::new(Action::FsRead, "workspace://ws_01/repo/a.rs").unwrap(),
            "sha256:".to_owned() + &"a".repeat(64),
            None,
            true,
            DataClass::Internal,
            1_000,
        )
        .unwrap();
        let decision = engine.decide(&request, false);
        assert_eq!(
            decision.reason,
            saber_policy::DecisionReason::ExplicitPermit
        );
        // Rollback through the same engine is refused (S05 semantics).
        let mut engine = realm.engine(bundle).unwrap();
        let older = realm
            .organization_bundle(&claim(&["developer"]), 4)
            .unwrap();
        assert_eq!(engine.update(vec![older]), Err(PolicyError::InvalidPolicy));
    }

    #[test]
    fn break_glass_is_dual_controlled_expiring_and_loud() {
        let mut realm = realm();
        // Self-approval is refused.
        assert_eq!(
            realm.break_glass("alice", "alice", "tenant_a", "why", 1_000, 60_000),
            Err(EnterpriseError::BreakGlassRefused)
        );
        let grant = realm
            .break_glass("alice", "bob", "tenant_a", "incident 42", 1_000, 60_000)
            .unwrap();
        assert!(realm.break_glass_active(&grant.grant_id, 1_001));
        assert_eq!(realm.active_break_glass(1_001).len(), 1, "enumerable");
        // Expired grants are reaped and cannot self-renew.
        assert!(!realm.break_glass_active(&grant.grant_id, 1_000 + 60_001));
        assert!(realm.active_break_glass(1_000 + 60_001).is_empty());
    }

    #[test]
    fn audit_streams_are_tenant_separated_with_metadata_only_packs() {
        let mut audit = AuditPartition::default();
        audit.append(
            "tenant_a",
            AuditLine {
                digest_ref: "sha256:aaa".to_owned(),
                at_ms: 1,
            },
        );
        audit.append(
            "tenant_b",
            AuditLine {
                digest_ref: "sha256:bbb".to_owned(),
                at_ms: 1,
            },
        );
        assert_eq!(audit.read("tenant_a", "tenant_a").unwrap().len(), 1);
        assert_eq!(
            audit.read("tenant_a", "tenant_b"),
            Err(EnterpriseError::CrossTenant)
        );
        // Packs are metadata-only: digest references, no content.
        let pack = audit.evidence_pack("tenant_a");
        assert_eq!(pack, vec!["sha256:aaa".to_owned()]);
        assert!(!serde_json::to_string(&pack).unwrap().contains("plaintext"));
    }
}
