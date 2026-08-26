//! Deterministic capability policy, scoped approval and enforcement.
//!
//! Models, prompts, skills and plugins can request effects but cannot authorize them.
//! This crate is the trusted Rust PDP/PEP boundary: closed vocabulary, deny by default,
//! monotonic policy restrictions, exact approval binding and audit-before-effect.

use std::collections::BTreeSet;
use std::error::Error;
use std::fmt::{Display, Formatter};

use serde::{Deserialize, Serialize};

pub mod approval;
pub mod audit;
pub mod vocabulary;

pub use approval::{ApprovalGrant, ApprovalLedger, ApprovalRequest, ApprovalScope};
pub use audit::{
    DecisionAuditSink, EnforcementResult, MemoryAuditSink, PolicyDecisionAudit, sha256_label,
};
pub use vocabulary::{
    ALL_ACTIONS, Action, ActionDescriptor, ApprovalMode, Resource, ResourcePattern, RiskClass,
};

/// Stable policy construction, request and approval failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PolicyError {
    /// The action is outside the closed vocabulary.
    UnknownAction,
    /// A resource contains ambiguous or unsafe syntax.
    InvalidResource,
    /// The resource URI scheme does not match the requested action.
    ResourceSchemeMismatch,
    /// A capability request omitted or malformed a binding.
    InvalidRequest,
    /// A policy bundle or rule is malformed or ambiguous.
    InvalidPolicy,
    /// Canonical policy serialization failed.
    Serialization,
    /// An approval request or grant is malformed.
    InvalidApproval,
    /// The requested or approved authority is broader than allowed.
    ApprovalScopeTooBroad,
    /// The approval card offered a vague or blanket choice.
    VagueApproval,
    /// The grant expired before use.
    ApprovalExpired,
    /// The grant was revoked.
    ApprovalRevoked,
    /// A one-shot grant was replayed.
    ApprovalReplayed,
    /// Action, resource or operation content changed after approval.
    ApprovalBindingMismatch,
}

impl Display for PolicyError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::UnknownAction => "unknown_action",
            Self::InvalidResource => "invalid_resource",
            Self::ResourceSchemeMismatch => "resource_scheme_mismatch",
            Self::InvalidRequest => "invalid_request",
            Self::InvalidPolicy => "invalid_policy",
            Self::Serialization => "serialization_error",
            Self::InvalidApproval => "invalid_approval",
            Self::ApprovalScopeTooBroad => "approval_scope_too_broad",
            Self::VagueApproval => "vague_approval",
            Self::ApprovalExpired => "approval_expired",
            Self::ApprovalRevoked => "approval_revoked",
            Self::ApprovalReplayed => "approval_replayed",
            Self::ApprovalBindingMismatch => "approval_binding_mismatch",
        })
    }
}

impl Error for PolicyError {}

/// Actor class used by policy conditions and audit identity hashing.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PrincipalKind {
    /// Interactive human user.
    Human,
    /// Registered endpoint identity.
    Device,
    /// Main trusted agent runtime.
    AgentRuntime,
    /// Delegated task-scoped agent.
    Subagent,
    /// Isolated plugin host.
    Plugin,
    /// Sandboxed process or job.
    Workload,
    /// External service identity.
    Service,
    /// Organization policy administrator.
    OrganizationAdmin,
    /// Security operations identity.
    SecurityOperator,
}

impl PrincipalKind {
    /// Stable schema value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Human => "human",
            Self::Device => "device",
            Self::AgentRuntime => "agent_runtime",
            Self::Subagent => "subagent",
            Self::Plugin => "plugin",
            Self::Workload => "workload",
            Self::Service => "service",
            Self::OrganizationAdmin => "organization_admin",
            Self::SecurityOperator => "security_operator",
        }
    }
}

/// Identity and delegation chain presented to the PDP.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Principal {
    /// Runtime identity executing the request.
    pub id: String,
    /// Closed principal class.
    pub kind: PrincipalKind,
    /// Human or service represented by this runtime, when delegated.
    pub on_behalf_of: Option<String>,
}

/// Data sensitivity used by deterministic policy conditions.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DataClass {
    /// Intended for unrestricted disclosure.
    Public,
    /// Ordinary private workspace data.
    Internal,
    /// Confidential user or organization data.
    Confidential,
    /// Most sensitive regulated or secret-adjacent content.
    Restricted,
}

/// Exact request entering the trusted policy boundary.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CapabilityRequest {
    /// Caller-generated stable request identifier.
    pub request_id: String,
    /// Authenticated actor and delegation identity.
    pub principal: Principal,
    /// Tenant/workspace partition.
    pub workspace_id: String,
    /// Task scope for temporary grants.
    pub task_id: String,
    /// Closed capability action.
    pub action: Action,
    /// Canonical typed resource.
    pub resource: Resource,
    /// Hash of exact arguments, content version and relevant execution context.
    pub operation_hash: String,
    /// Optional broker reference; never raw credential material.
    pub credential_ref: Option<String>,
    /// Whether a required isolated execution realm has already been allocated.
    pub sandboxed: bool,
    /// Highest data classification affected by the request.
    pub data_class: DataClass,
    /// Request time in Unix milliseconds.
    pub occurred_at_ms: u64,
}

impl CapabilityRequest {
    /// Construct and validate an exact request.
    ///
    /// # Errors
    ///
    /// Rejects missing identity/scope, non-canonical hashes and raw credential-like input.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        request_id: impl Into<String>,
        principal: Principal,
        workspace_id: impl Into<String>,
        task_id: impl Into<String>,
        action: Action,
        resource: Resource,
        operation_hash: impl Into<String>,
        credential_ref: Option<String>,
        sandboxed: bool,
        data_class: DataClass,
        occurred_at_ms: u64,
    ) -> Result<Self, PolicyError> {
        let request = Self {
            request_id: request_id.into(),
            principal,
            workspace_id: workspace_id.into(),
            task_id: task_id.into(),
            action,
            resource,
            operation_hash: operation_hash.into(),
            credential_ref,
            sandboxed,
            data_class,
            occurred_at_ms,
        };
        request.validate()?;
        Ok(request)
    }

    /// Stable digest binding identity, action, exact resource and operation content.
    #[must_use]
    pub fn digest(&self) -> String {
        sha256_label(&[
            self.request_id.as_bytes(),
            self.principal.id.as_bytes(),
            self.principal.kind.as_str().as_bytes(),
            self.principal
                .on_behalf_of
                .as_deref()
                .unwrap_or("")
                .as_bytes(),
            self.workspace_id.as_bytes(),
            self.task_id.as_bytes(),
            self.action.as_str().as_bytes(),
            self.resource.as_str().as_bytes(),
            self.operation_hash.as_bytes(),
            self.credential_ref.as_deref().unwrap_or("").as_bytes(),
            &[u8::from(self.sandboxed)],
            &[self.data_class as u8],
        ])
    }

    fn validate(&self) -> Result<(), PolicyError> {
        if self.request_id.is_empty()
            || self.principal.id.is_empty()
            || self.workspace_id.is_empty()
            || self.task_id.is_empty()
            || !valid_identifier(&self.workspace_id)
            || !valid_hash(&self.operation_hash)
            || self.credential_ref.as_ref().is_some_and(|reference| {
                !reference.starts_with("credential://")
                    || reference.len() <= "credential://".len()
                    || reference.chars().any(char::is_whitespace)
            })
        {
            return Err(PolicyError::InvalidRequest);
        }
        self.resource.validate_for(self.action)?;
        let scheme = self.action.descriptor().resource_scheme;
        if matches!(scheme, "workspace" | "git") {
            let expected = format!("{scheme}://{}/", self.workspace_id);
            if !self.resource.as_str().starts_with(&expected) {
                return Err(PolicyError::InvalidRequest);
            }
        }
        Ok(())
    }
}

/// Ordered authority tier. Project content is intentionally not a policy tier.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyTier {
    /// Immutable product safety rules.
    PlatformHard,
    /// Regulatory or tenant hard policy.
    Regulatory,
    /// Organization baseline and restrictions.
    Organization,
    /// Team/workspace restrictions.
    Workspace,
    /// User restrictions or bounded preferences.
    User,
    /// Exact, short-lived task grant.
    TaskGrant,
}

/// Rule effect; any matching deny wins over every permit at every lower tier.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleEffect {
    /// Grant bounded authority if no restriction matches.
    Permit,
    /// Restrict authority monotonically.
    Deny,
}

/// Optional deterministic constraints on a policy rule.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PolicyCondition {
    /// Empty means all authenticated principal kinds.
    pub principal_kinds: BTreeSet<PrincipalKind>,
    /// Require a previously allocated sandbox realm.
    pub require_sandbox: bool,
    /// Maximum data class this rule can permit.
    pub maximum_data_class: Option<DataClass>,
    /// Optional exact task binding.
    pub task_id: Option<String>,
}

impl PolicyCondition {
    fn matches(&self, request: &CapabilityRequest) -> bool {
        (self.principal_kinds.is_empty() || self.principal_kinds.contains(&request.principal.kind))
            && (!self.require_sandbox || request.sandboxed)
            && self
                .maximum_data_class
                .is_none_or(|maximum| request.data_class <= maximum)
            && self
                .task_id
                .as_deref()
                .is_none_or(|task_id| request.task_id == task_id)
    }
}

/// One typed policy rule.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PolicyRule {
    /// Stable non-secret identifier surfaced in audit.
    pub rule_id: String,
    /// Permit or deny.
    pub effect: RuleEffect,
    /// Exact canonical action.
    pub action: Action,
    /// Exact or segment-bounded resource selector.
    pub resource: ResourcePattern,
    /// Additional deterministic conditions.
    pub condition: PolicyCondition,
    /// Require scoped human approval even when policy permits.
    pub requires_approval: bool,
}

/// Versioned rules from one authority tier.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PolicyBundle {
    /// Authority tier.
    pub tier: PolicyTier,
    /// Stable version or signed digest reference.
    pub version: String,
    /// Monotonic sequence that prevents rollback at this tier.
    pub sequence: u64,
    /// Typed rules; free-text permissions are impossible.
    pub rules: Vec<PolicyRule>,
}

impl PolicyBundle {
    /// Validate and construct one bundle.
    ///
    /// # Errors
    ///
    /// Rejects missing versions, zero sequence, duplicate IDs and rules whose
    /// resource scheme does not agree with the action vocabulary.
    pub fn new(
        tier: PolicyTier,
        version: impl Into<String>,
        sequence: u64,
        rules: Vec<PolicyRule>,
    ) -> Result<Self, PolicyError> {
        let version = version.into();
        let mut identifiers = BTreeSet::new();
        if version.is_empty()
            || sequence == 0
            || rules.iter().any(|rule| {
                !valid_identifier(&rule.rule_id)
                    || !identifiers.insert(rule.rule_id.clone())
                    || !pattern_matches_action(rule.action, &rule.resource)
            })
        {
            return Err(PolicyError::InvalidPolicy);
        }
        Ok(Self {
            tier,
            version,
            sequence,
            rules,
        })
    }
}

/// Allow, deny or require a scoped approval.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionOutcome {
    /// PEP may proceed after durable audit.
    Allow,
    /// PEP must not execute.
    Deny,
    /// A matching permit exists but requires a valid grant.
    RequireApproval,
}

impl DecisionOutcome {
    /// Stable persisted value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Deny => "deny",
            Self::RequireApproval => "require_approval",
        }
    }
}

/// Stable explanation code safe for model/UI feedback and audit.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionReason {
    /// One or more explicit deny rules matched.
    ExplicitDeny,
    /// A permit matched and no deny applied.
    ExplicitPermit,
    /// No permit matched.
    DefaultDeny,
    /// Request bindings were invalid.
    InvalidRequest,
    /// PDP or its policy snapshot was unavailable.
    PolicyUnavailable,
    /// Required execution isolation was absent.
    SandboxRequired,
    /// Required credential reference was absent.
    CredentialReferenceRequired,
    /// A matching permit requires a grant.
    ApprovalRequired,
    /// A supplied grant failed validation.
    ApprovalInvalid,
}

impl DecisionReason {
    /// Stable persisted reason code.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ExplicitDeny => "explicit_deny",
            Self::ExplicitPermit => "explicit_permit",
            Self::DefaultDeny => "default_deny",
            Self::InvalidRequest => "invalid_request",
            Self::PolicyUnavailable => "policy_unavailable",
            Self::SandboxRequired => "sandbox_required",
            Self::CredentialReferenceRequired => "credential_reference_required",
            Self::ApprovalRequired => "approval_required",
            Self::ApprovalInvalid => "approval_invalid",
        }
    }
}

/// Deterministic policy result. It is not executable authority until durably audited.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PolicyDecision {
    /// Stable content-derived identifier.
    pub decision_id: String,
    /// Exact request digest.
    pub request_digest: String,
    /// Policy snapshot hash or a fixed unavailable label.
    pub policy_snapshot_id: String,
    /// Decision result.
    pub outcome: DecisionOutcome,
    /// Stable reason code.
    pub reason: DecisionReason,
    /// Matching stable rule identifiers in authority order.
    pub matched_rule_ids: Vec<String>,
}

/// Deterministic, model-independent policy decision point.
pub struct PolicyEngine {
    bundles: Option<Vec<PolicyBundle>>,
    snapshot_id: String,
}

impl PolicyEngine {
    /// Construct an ordered, validated policy snapshot.
    ///
    /// # Errors
    ///
    /// Requires exactly one platform-hard bundle and globally unique rule IDs.
    pub fn new(mut bundles: Vec<PolicyBundle>) -> Result<Self, PolicyError> {
        bundles.sort_by_key(|bundle| bundle.tier);
        let mut tiers = BTreeSet::new();
        let mut rule_ids = BTreeSet::new();
        if bundles.is_empty()
            || bundles.first().map(|bundle| bundle.tier) != Some(PolicyTier::PlatformHard)
            || bundles.iter().any(|bundle| {
                !tiers.insert(bundle.tier)
                    || bundle
                        .rules
                        .iter()
                        .any(|rule| !rule_ids.insert(rule.rule_id.clone()))
            })
        {
            return Err(PolicyError::InvalidPolicy);
        }
        let encoded = serde_json::to_vec(&bundles).map_err(|_| PolicyError::Serialization)?;
        let snapshot_id = sha256_label(&[&encoded]);
        Ok(Self {
            bundles: Some(bundles),
            snapshot_id,
        })
    }

    /// Create a deliberately unavailable PDP used by health/fail-closed paths.
    #[must_use]
    pub fn unavailable() -> Self {
        Self {
            bundles: None,
            snapshot_id: "unavailable".to_owned(),
        }
    }

    /// Replace the current policy snapshot without accepting sequence rollback or
    /// silently removing an existing authority tier.
    ///
    /// # Errors
    ///
    /// Rejects unavailable current state, missing tiers, lower sequences and a
    /// different bundle reusing the same sequence number.
    pub fn update(&mut self, bundles: Vec<PolicyBundle>) -> Result<(), PolicyError> {
        let next = Self::new(bundles)?;
        let (Some(current_bundles), Some(next_bundles)) = (&self.bundles, &next.bundles) else {
            return Err(PolicyError::InvalidPolicy);
        };
        for current in current_bundles {
            let Some(candidate) = next_bundles
                .iter()
                .find(|bundle| bundle.tier == current.tier)
            else {
                return Err(PolicyError::InvalidPolicy);
            };
            if candidate.sequence < current.sequence
                || (candidate.sequence == current.sequence && candidate != current)
            {
                return Err(PolicyError::InvalidPolicy);
            }
        }
        *self = next;
        Ok(())
    }

    /// Evaluate a request, optionally after trusted approval validation.
    #[must_use]
    pub fn decide(&self, request: &CapabilityRequest, approval_valid: bool) -> PolicyDecision {
        if request.validate().is_err() {
            return self.make_decision(
                request,
                DecisionOutcome::Deny,
                DecisionReason::InvalidRequest,
                Vec::new(),
            );
        }
        let Some(bundles) = &self.bundles else {
            return self.make_decision(
                request,
                DecisionOutcome::Deny,
                DecisionReason::PolicyUnavailable,
                Vec::new(),
            );
        };
        if request.action.descriptor().requires_sandbox() && !request.sandboxed {
            return self.make_decision(
                request,
                DecisionOutcome::Deny,
                DecisionReason::SandboxRequired,
                Vec::new(),
            );
        }
        if request.action.descriptor().requires_secret() && request.credential_ref.is_none() {
            return self.make_decision(
                request,
                DecisionOutcome::Deny,
                DecisionReason::CredentialReferenceRequired,
                Vec::new(),
            );
        }

        let mut denies = Vec::new();
        let mut permits = Vec::new();
        let mut approval_required = request.action.descriptor().approval == ApprovalMode::Always;
        for rule in bundles.iter().flat_map(|bundle| &bundle.rules) {
            if rule.action == request.action
                && rule.resource.covers(&request.resource)
                && rule.condition.matches(request)
            {
                match rule.effect {
                    RuleEffect::Deny => denies.push(rule.rule_id.clone()),
                    RuleEffect::Permit => {
                        permits.push(rule.rule_id.clone());
                        approval_required |= rule.requires_approval;
                    }
                }
            }
        }
        if !denies.is_empty() {
            return self.make_decision(
                request,
                DecisionOutcome::Deny,
                DecisionReason::ExplicitDeny,
                denies,
            );
        }
        if permits.is_empty() {
            return self.make_decision(
                request,
                DecisionOutcome::Deny,
                DecisionReason::DefaultDeny,
                Vec::new(),
            );
        }
        if approval_required && !approval_valid {
            return self.make_decision(
                request,
                DecisionOutcome::RequireApproval,
                DecisionReason::ApprovalRequired,
                permits,
            );
        }
        self.make_decision(
            request,
            DecisionOutcome::Allow,
            DecisionReason::ExplicitPermit,
            permits,
        )
    }

    fn make_decision(
        &self,
        request: &CapabilityRequest,
        outcome: DecisionOutcome,
        reason: DecisionReason,
        matched_rule_ids: Vec<String>,
    ) -> PolicyDecision {
        let request_digest = request.digest();
        let outcome_bytes = [outcome as u8];
        let reason_bytes = [reason as u8];
        let rule_text = matched_rule_ids.join("\0");
        let decision_id = sha256_label(&[
            self.snapshot_id.as_bytes(),
            request_digest.as_bytes(),
            &outcome_bytes,
            &reason_bytes,
            rule_text.as_bytes(),
        ]);
        PolicyDecision {
            decision_id,
            request_digest,
            policy_snapshot_id: self.snapshot_id.clone(),
            outcome,
            reason,
            matched_rule_ids,
        }
    }
}

/// Failure surfaced by the enforcement point.
#[derive(Debug)]
pub enum EnforcementError<AuditError, EffectError> {
    /// Policy denied the effect or still requires approval.
    Decision(PolicyDecision),
    /// A supplied approval was invalid.
    Approval(PolicyError),
    /// The decision could not be durably recorded, so the effect did not run.
    AuditBefore(AuditError),
    /// The authorized effect returned an error.
    Effect(EffectError),
    /// The effect returned, but enforcement-result audit needs reconciliation.
    AuditAfter(AuditError),
}

/// Policy Enforcement Point that makes audit-before-effect structurally mandatory.
pub struct PolicyEnforcer<Sink> {
    engine: PolicyEngine,
    approvals: ApprovalLedger,
    sink: Sink,
}

impl<Sink> PolicyEnforcer<Sink>
where
    Sink: DecisionAuditSink,
{
    /// Bind a PDP to its approval replay ledger and durable audit sink.
    #[must_use]
    pub fn new(engine: PolicyEngine, sink: Sink) -> Self {
        Self {
            engine,
            approvals: ApprovalLedger::default(),
            sink,
        }
    }

    /// Access the approval ledger for explicit revocation.
    #[must_use]
    pub fn approvals_mut(&mut self) -> &mut ApprovalLedger {
        &mut self.approvals
    }

    /// Access the sink for verification or recovery integration.
    #[must_use]
    pub fn sink(&self) -> &Sink {
        &self.sink
    }

    /// Mutably access the sink for recovery and test fault injection.
    #[must_use]
    pub fn sink_mut(&mut self) -> &mut Sink {
        &mut self.sink
    }

    /// Evaluate, persist the redacted decision, and only then invoke an effect.
    ///
    /// # Errors
    ///
    /// Deny/approval/audit failures happen before the closure. Effect and trailing
    /// audit failures are explicit so an outbox can reconcile them.
    pub fn execute<Value, AuditError, EffectError, Effect>(
        &mut self,
        request: &CapabilityRequest,
        approval: Option<&ApprovalGrant>,
        completed_at_ms: u64,
        effect: Effect,
    ) -> Result<Value, EnforcementError<AuditError, EffectError>>
    where
        Sink: DecisionAuditSink<Error = AuditError>,
        Effect: FnOnce() -> Result<Value, EffectError>,
    {
        let preliminary = self.engine.decide(request, false);
        let approval_valid = if preliminary.outcome == DecisionOutcome::RequireApproval {
            let Some(grant) = approval else {
                self.persist(&preliminary, request)
                    .map_err(EnforcementError::AuditBefore)?;
                return Err(EnforcementError::Decision(preliminary));
            };
            if let Err(error) = self.approvals.validate(grant, request, completed_at_ms) {
                let denied = self.engine.make_decision(
                    request,
                    DecisionOutcome::Deny,
                    DecisionReason::ApprovalInvalid,
                    preliminary.matched_rule_ids,
                );
                self.persist(&denied, request)
                    .map_err(EnforcementError::AuditBefore)?;
                return Err(EnforcementError::Approval(error));
            }
            true
        } else {
            false
        };
        let decision = if approval_valid {
            self.engine.decide(request, true)
        } else {
            preliminary
        };
        self.persist(&decision, request)
            .map_err(EnforcementError::AuditBefore)?;
        if decision.outcome != DecisionOutcome::Allow {
            return Err(EnforcementError::Decision(decision));
        }
        if approval_valid && let Some(grant) = approval {
            self.approvals.consume(grant);
        }
        match effect() {
            Ok(value) => {
                self.sink
                    .record_enforcement(
                        &decision.decision_id,
                        completed_at_ms,
                        EnforcementResult::Succeeded,
                    )
                    .map_err(EnforcementError::AuditAfter)?;
                Ok(value)
            }
            Err(error) => {
                self.sink
                    .record_enforcement(
                        &decision.decision_id,
                        completed_at_ms,
                        EnforcementResult::Failed,
                    )
                    .map_err(EnforcementError::AuditAfter)?;
                Err(EnforcementError::Effect(error))
            }
        }
    }

    fn persist(
        &mut self,
        decision: &PolicyDecision,
        request: &CapabilityRequest,
    ) -> Result<(), Sink::Error> {
        self.sink
            .record_decision(&PolicyDecisionAudit::from_decision(decision, request))
    }
}

fn valid_hash(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

fn pattern_matches_action(action: Action, pattern: &ResourcePattern) -> bool {
    match pattern {
        ResourcePattern::Exact(resource) | ResourcePattern::Prefix(resource) => {
            resource.validate_for(action).is_ok()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use serde_json::Value;

    use super::*;

    fn hash(value: &str) -> String {
        sha256_label(&[value.as_bytes()])
    }

    fn principal(id: &str) -> Principal {
        Principal {
            id: id.to_owned(),
            kind: PrincipalKind::AgentRuntime,
            on_behalf_of: Some("human_01".to_owned()),
        }
    }

    fn request(action: Action, resource: &str, operation: &str, at: u64) -> CapabilityRequest {
        CapabilityRequest::new(
            "req_01",
            principal("runtime_01"),
            "ws_01",
            "task_01",
            action,
            Resource::new(action, resource).unwrap_or_else(|error| unreachable!("{error}")),
            hash(operation),
            action
                .descriptor()
                .requires_secret()
                .then(|| "credential://broker/ref_01".to_owned()),
            true,
            DataClass::Internal,
            at,
        )
        .unwrap_or_else(|error| unreachable!("{error}"))
    }

    fn rule(
        id: &str,
        effect: RuleEffect,
        action: Action,
        pattern: ResourcePattern,
        approval: bool,
    ) -> PolicyRule {
        PolicyRule {
            rule_id: id.to_owned(),
            effect,
            action,
            resource: pattern,
            condition: PolicyCondition::default(),
            requires_approval: approval,
        }
    }

    fn engine(rules: Vec<PolicyRule>) -> PolicyEngine {
        PolicyEngine::new(vec![
            PolicyBundle::new(PolicyTier::PlatformHard, "platform-v1", 1, Vec::new())
                .unwrap_or_else(|error| unreachable!("{error}")),
            PolicyBundle::new(PolicyTier::Organization, "org-v1", 1, rules)
                .unwrap_or_else(|error| unreachable!("{error}")),
        ])
        .unwrap_or_else(|error| unreachable!("{error}"))
    }

    #[test]
    fn frozen_vocabulary_matches_canonical_registry() -> Result<(), Box<dyn Error>> {
        let registry: Value = serde_json::from_str(include_str!(
            "../../../schemas/capabilities/v1/vocabulary.json"
        ))?;
        let entries = registry["actions"]
            .as_array()
            .ok_or(PolicyError::Serialization)?;
        assert_eq!(entries.len(), ALL_ACTIONS.len());
        for action in ALL_ACTIONS {
            let entry = entries
                .iter()
                .find(|entry| entry["name"] == action.as_str())
                .ok_or(PolicyError::UnknownAction)?;
            let descriptor = action.descriptor();
            assert_eq!(entry["resource_scheme"], descriptor.resource_scheme);
            assert_eq!(entry["persistable"], descriptor.persistable());
            assert_eq!(entry["requires_sandbox"], descriptor.requires_sandbox());
            assert_eq!(entry["requires_secret"], descriptor.requires_secret());
            assert_eq!(entry["requires_network"], descriptor.requires_network());
            assert_eq!(entry["risk"], descriptor.risk.as_str());
            assert_eq!(entry["approval"], descriptor.approval.as_str());
        }
        assert!(
            ALL_ACTIONS
                .iter()
                .all(|action| action.as_str() != "system.all")
        );
        assert_eq!(
            "unknown.action".parse::<Action>(),
            Err(PolicyError::UnknownAction)
        );
        Ok(())
    }

    #[test]
    fn resource_grammar_rejects_traversal_wrong_scheme_and_prefix_confusion() {
        assert_eq!(
            Resource::new(Action::FsRead, "workspace://ws_01/../secret"),
            Err(PolicyError::InvalidResource)
        );
        assert_eq!(
            Resource::new(Action::FsRead, "secret://ws_01/key"),
            Err(PolicyError::ResourceSchemeMismatch)
        );
        let prefix = ResourcePattern::prefix(Action::FsRead, "workspace://ws_01/repo")
            .unwrap_or_else(|error| unreachable!("{error}"));
        let inside = Resource::new(Action::FsRead, "workspace://ws_01/repo/src/lib.rs")
            .unwrap_or_else(|error| unreachable!("{error}"));
        let sibling = Resource::new(Action::FsRead, "workspace://ws_01/repository/secret")
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert!(prefix.covers(&inside));
        assert!(!prefix.covers(&sibling));
    }

    #[test]
    fn deserialized_request_cannot_bypass_resource_validation() -> Result<(), Box<dyn Error>> {
        let valid = request(
            Action::FsRead,
            "workspace://ws_01/repo/README.md",
            "read-v1",
            100,
        );
        let mut encoded = serde_json::to_value(valid)?;
        encoded["resource"] = Value::String("workspace://ws_01/repo/../secret".to_owned());
        let bypass_attempt: CapabilityRequest = serde_json::from_value(encoded)?;
        let decision = engine(Vec::new()).decide(&bypass_attempt, false);
        assert_eq!(decision.outcome, DecisionOutcome::Deny);
        assert_eq!(decision.reason, DecisionReason::InvalidRequest);
        Ok(())
    }

    #[test]
    fn policy_is_default_deny_and_any_higher_restriction_wins() -> Result<(), PolicyError> {
        let capability = request(
            Action::FsRead,
            "workspace://ws_01/repo/src/lib.rs",
            "read-v1",
            100,
        );
        assert_eq!(
            engine(Vec::new()).decide(&capability, false).reason,
            DecisionReason::DefaultDeny
        );

        let permit = rule(
            "org.read",
            RuleEffect::Permit,
            Action::FsRead,
            ResourcePattern::prefix(Action::FsRead, "workspace://ws_01/repo")?,
            false,
        );
        let deny = rule(
            "platform.deny-src",
            RuleEffect::Deny,
            Action::FsRead,
            ResourcePattern::prefix(Action::FsRead, "workspace://ws_01/repo/src")?,
            false,
        );
        let policy = PolicyEngine::new(vec![
            PolicyBundle::new(PolicyTier::PlatformHard, "platform-v1", 1, vec![deny])?,
            PolicyBundle::new(PolicyTier::TaskGrant, "task-v1", 1, vec![permit])?,
        ])?;
        let decision = policy.decide(&capability, false);
        assert_eq!(decision.outcome, DecisionOutcome::Deny);
        assert_eq!(decision.reason, DecisionReason::ExplicitDeny);
        assert_eq!(decision.matched_rule_ids, vec!["platform.deny-src"]);
        Ok(())
    }

    #[test]
    fn policy_update_rejects_rollback_reuse_and_tier_removal() -> Result<(), PolicyError> {
        let platform = PolicyBundle::new(PolicyTier::PlatformHard, "platform-v2", 2, Vec::new())?;
        let organization = PolicyBundle::new(
            PolicyTier::Organization,
            "organization-v2",
            2,
            vec![rule(
                "org.read",
                RuleEffect::Permit,
                Action::FsRead,
                ResourcePattern::prefix(Action::FsRead, "workspace://ws_01/repo")?,
                false,
            )],
        )?;
        let mut policy = PolicyEngine::new(vec![platform.clone(), organization.clone()])?;
        assert_eq!(
            policy.update(vec![PolicyBundle::new(
                PolicyTier::PlatformHard,
                "platform-v1",
                1,
                Vec::new(),
            )?]),
            Err(PolicyError::InvalidPolicy)
        );
        assert_eq!(
            policy.update(vec![
                platform.clone(),
                PolicyBundle::new(
                    PolicyTier::Organization,
                    "different-at-sequence-2",
                    2,
                    Vec::new(),
                )?,
            ]),
            Err(PolicyError::InvalidPolicy)
        );
        assert_eq!(
            policy.update(vec![platform]),
            Err(PolicyError::InvalidPolicy)
        );
        assert!(
            policy
                .update(vec![
                    PolicyBundle::new(PolicyTier::PlatformHard, "platform-v3", 3, Vec::new())?,
                    PolicyBundle::new(
                        PolicyTier::Organization,
                        "organization-v3",
                        3,
                        organization.rules,
                    )?,
                ])
                .is_ok()
        );
        Ok(())
    }

    #[test]
    fn unavailable_policy_and_audit_fail_before_effect() -> Result<(), PolicyError> {
        let capability = request(
            Action::FsRead,
            "workspace://ws_01/repo/README.md",
            "read-v1",
            100,
        );
        let calls = Cell::new(0_u8);
        let mut unavailable =
            PolicyEnforcer::new(PolicyEngine::unavailable(), MemoryAuditSink::default());
        let result = unavailable.execute(&capability, None, 101, || {
            calls.set(calls.get() + 1);
            Ok::<_, ()>(())
        });
        assert!(matches!(result, Err(EnforcementError::Decision(_))));
        assert_eq!(calls.get(), 0);

        let permit = rule(
            "org.read",
            RuleEffect::Permit,
            Action::FsRead,
            ResourcePattern::prefix(Action::FsRead, "workspace://ws_01/repo")?,
            false,
        );
        let sink = MemoryAuditSink {
            unavailable: true,
            ..MemoryAuditSink::default()
        };
        let mut audit_down = PolicyEnforcer::new(engine(vec![permit]), sink);
        let result = audit_down.execute(&capability, None, 101, || {
            calls.set(calls.get() + 1);
            Ok::<_, ()>(())
        });
        assert!(matches!(result, Err(EnforcementError::AuditBefore(_))));
        assert_eq!(calls.get(), 0);
        Ok(())
    }

    #[test]
    fn approval_is_exact_expiring_revocable_and_one_shot() -> Result<(), PolicyError> {
        let capability = request(
            Action::FsDelete,
            "workspace://ws_01/repo/generated.bin",
            "delete-content-v1",
            1_000,
        );
        let permit = rule(
            "org.delete-generated",
            RuleEffect::Permit,
            Action::FsDelete,
            ResourcePattern::prefix(Action::FsDelete, "workspace://ws_01/repo")?,
            true,
        );
        let approval_request = ApprovalRequest::new(
            "approval_req_01",
            capability.clone(),
            ResourcePattern::exact(Action::FsDelete, capability.resource.as_str())?,
            "delete generated output",
            vec!["approve this exact file once".to_owned(), "deny".to_owned()],
            ApprovalScope::Once,
            2_000,
        )?;
        let grant = ApprovalGrant::approve(
            &approval_request,
            "grant_01",
            "human_01",
            ResourcePattern::exact(Action::FsDelete, capability.resource.as_str())?,
            1_500,
        )?;
        let calls = Cell::new(0_u8);
        let mut enforcer = PolicyEnforcer::new(engine(vec![permit]), MemoryAuditSink::default());
        enforcer
            .execute(&capability, Some(&grant), 1_100, || {
                calls.set(calls.get() + 1);
                Ok::<_, ()>(())
            })
            .map_err(|_| PolicyError::InvalidPolicy)?;
        assert_eq!(calls.get(), 1);
        assert!(matches!(
            enforcer.execute(&capability, Some(&grant), 1_200, || {
                calls.set(calls.get() + 1);
                Ok::<_, ()>(())
            }),
            Err(EnforcementError::Approval(PolicyError::ApprovalReplayed))
        ));
        assert_eq!(calls.get(), 1);
        Ok(())
    }

    #[test]
    fn failed_audit_does_not_consume_one_shot_approval() -> Result<(), PolicyError> {
        let capability = request(
            Action::FsDelete,
            "workspace://ws_01/repo/generated.bin",
            "delete-content-v1",
            1_000,
        );
        let permit = rule(
            "org.delete-generated",
            RuleEffect::Permit,
            Action::FsDelete,
            ResourcePattern::prefix(Action::FsDelete, "workspace://ws_01/repo")?,
            true,
        );
        let approval_request = ApprovalRequest::new(
            "approval_req_01",
            capability.clone(),
            ResourcePattern::exact(Action::FsDelete, capability.resource.as_str())?,
            "delete generated output",
            vec!["approve this exact file once".to_owned(), "deny".to_owned()],
            ApprovalScope::Once,
            2_000,
        )?;
        let grant = ApprovalGrant::approve(
            &approval_request,
            "grant_01",
            "human_01",
            ResourcePattern::exact(Action::FsDelete, capability.resource.as_str())?,
            1_500,
        )?;
        let sink = MemoryAuditSink {
            unavailable: true,
            ..MemoryAuditSink::default()
        };
        let calls = Cell::new(0_u8);
        let mut enforcer = PolicyEnforcer::new(engine(vec![permit]), sink);
        assert!(matches!(
            enforcer.execute(&capability, Some(&grant), 1_100, || {
                calls.set(calls.get() + 1);
                Ok::<_, ()>(())
            }),
            Err(EnforcementError::AuditBefore(_))
        ));
        enforcer.sink_mut().unavailable = false;
        assert!(
            enforcer
                .execute(&capability, Some(&grant), 1_101, || {
                    calls.set(calls.get() + 1);
                    Ok::<_, ()>(())
                })
                .is_ok()
        );
        assert_eq!(calls.get(), 1);
        Ok(())
    }

    #[test]
    fn permit_that_needs_no_approval_does_not_consume_supplied_grant() -> Result<(), PolicyError> {
        let capability = request(
            Action::FsRead,
            "workspace://ws_01/repo/README.md",
            "read-v1",
            1_000,
        );
        let permit = rule(
            "org.read",
            RuleEffect::Permit,
            Action::FsRead,
            ResourcePattern::prefix(Action::FsRead, "workspace://ws_01/repo")?,
            false,
        );
        let approval_request = ApprovalRequest::new(
            "approval_req_01",
            capability.clone(),
            ResourcePattern::exact(Action::FsRead, capability.resource.as_str())?,
            "read exact file",
            vec!["approve once".to_owned(), "deny".to_owned()],
            ApprovalScope::Once,
            2_000,
        )?;
        let grant = ApprovalGrant::approve(
            &approval_request,
            "grant_01",
            "human_01",
            ResourcePattern::exact(Action::FsRead, capability.resource.as_str())?,
            1_500,
        )?;
        let mut enforcer = PolicyEnforcer::new(engine(vec![permit]), MemoryAuditSink::default());
        assert!(
            enforcer
                .execute(&capability, Some(&grant), 1_100, || Ok::<_, ()>(()))
                .is_ok()
        );
        assert!(
            enforcer
                .approvals_mut()
                .validate_and_consume(&grant, &capability, 1_101)
                .is_ok()
        );
        Ok(())
    }

    #[test]
    fn approval_detects_toctou_expiry_revocation_and_vague_ui() -> Result<(), PolicyError> {
        let original = request(
            Action::FsDelete,
            "workspace://ws_01/repo/output.bin",
            "content-v1",
            1_000,
        );
        let approval_request = ApprovalRequest::new(
            "approval_req_01",
            original.clone(),
            ResourcePattern::exact(Action::FsDelete, original.resource.as_str())?,
            "remove exact output",
            vec!["approve once".to_owned(), "deny".to_owned()],
            ApprovalScope::Once,
            2_000,
        )?;
        let grant = ApprovalGrant::approve(
            &approval_request,
            "grant_01",
            "human_01",
            ResourcePattern::exact(Action::FsDelete, original.resource.as_str())?,
            1_500,
        )?;
        let changed = request(
            Action::FsDelete,
            "workspace://ws_01/repo/output.bin",
            "content-v2",
            1_000,
        );
        let mut ledger = ApprovalLedger::default();
        assert_eq!(
            ledger.validate_and_consume(&grant, &changed, 1_100),
            Err(PolicyError::ApprovalBindingMismatch)
        );
        assert_eq!(
            ledger.validate_and_consume(&grant, &original, 1_501),
            Err(PolicyError::ApprovalExpired)
        );
        ledger.revoke("grant_01");
        assert_eq!(
            ledger.validate_and_consume(&grant, &original, 1_100),
            Err(PolicyError::ApprovalRevoked)
        );
        assert!(matches!(
            ApprovalRequest::new(
                "approval_req_02",
                original.clone(),
                ResourcePattern::exact(Action::FsDelete, original.resource.as_str())?,
                "continue",
                vec!["Allow everything to continue".to_owned()],
                ApprovalScope::Once,
                2_000,
            ),
            Err(PolicyError::VagueApproval)
        ));
        assert!(matches!(
            ApprovalRequest::new(
                "approval_req_03",
                original,
                ResourcePattern::exact(Action::FsDelete, "workspace://ws_01/repo/output.bin")?,
                "persist",
                vec!["approve task".to_owned()],
                ApprovalScope::Task,
                2_000,
            ),
            Err(PolicyError::ApprovalScopeTooBroad)
        ));
        Ok(())
    }

    #[test]
    fn persisted_audit_excludes_secret_resource_and_free_text() -> Result<(), Box<dyn Error>> {
        let secret = "sk-test-abcdefghijklmnopqrstuvwxyz012345";
        let capability = CapabilityRequest::new(
            "req_01",
            principal(secret),
            "ws_01",
            "task_01",
            Action::SecretUse,
            Resource::new(Action::SecretUse, format!("secret://production/{secret}"))?,
            hash("use-secret-v1"),
            Some(format!("credential://broker/{secret}")),
            true,
            DataClass::Restricted,
            100,
        )?;
        let permit = rule(
            "org.secret-use",
            RuleEffect::Permit,
            Action::SecretUse,
            ResourcePattern::prefix(Action::SecretUse, "secret://production")?,
            false,
        );
        let decision = engine(vec![permit]).decide(&capability, false);
        let audit = PolicyDecisionAudit::from_decision(&decision, &capability);
        let encoded = serde_json::to_string(&audit)?;
        assert!(!encoded.contains(secret));
        assert!(!encoded.contains("credential://"));
        assert!(!encoded.contains("secret://"));
        assert!(encoded.contains("sha256:"));
        Ok(())
    }
}
