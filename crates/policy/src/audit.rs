//! Redacted, hash-addressed policy decision audit records.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{CapabilityRequest, DecisionOutcome, DecisionReason, PolicyDecision};

/// Stable SHA-256 label for non-secret policy metadata.
#[must_use]
pub fn sha256_label(parts: &[&[u8]]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part);
    }
    format!("sha256:{:x}", digest.finalize())
}

/// Metadata-only persisted form of a policy decision.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PolicyDecisionAudit {
    /// Stable decision identifier.
    pub decision_id: String,
    /// Workspace scope used for partition enforcement.
    pub workspace_id: String,
    /// Canonical capability action.
    pub action: String,
    /// Allow, deny or approval-required result.
    pub outcome: DecisionOutcome,
    /// Stable machine-readable reason without prompt or secret content.
    pub reason: DecisionReason,
    /// Hash of principal identity and delegation metadata.
    pub principal_hash: String,
    /// Hash of the canonical resource rather than its potentially sensitive text.
    pub resource_hash: String,
    /// Hash of exact operation/context inputs.
    pub context_hash: String,
    /// Hash of the complete capability request.
    pub request_digest: String,
    /// Hash of the ordered policy bundle set.
    pub policy_snapshot_id: String,
    /// Stable rule identifiers; rule bodies and user-provided text are excluded.
    pub matched_rule_ids: Vec<String>,
    /// Decision time in Unix milliseconds.
    pub occurred_at_ms: u64,
}

impl PolicyDecisionAudit {
    /// Produce the persistable record while excluding raw principal, resource, reason,
    /// credential reference and operation content.
    #[must_use]
    pub fn from_decision(decision: &PolicyDecision, request: &CapabilityRequest) -> Self {
        Self {
            decision_id: decision.decision_id.clone(),
            workspace_id: request.workspace_id.clone(),
            action: request.action.to_string(),
            outcome: decision.outcome,
            reason: decision.reason,
            principal_hash: sha256_label(&[
                request.principal.id.as_bytes(),
                request.principal.kind.as_str().as_bytes(),
                request
                    .principal
                    .on_behalf_of
                    .as_deref()
                    .unwrap_or("")
                    .as_bytes(),
            ]),
            resource_hash: sha256_label(&[request.resource.as_str().as_bytes()]),
            context_hash: request.operation_hash.clone(),
            request_digest: decision.request_digest.clone(),
            policy_snapshot_id: decision.policy_snapshot_id.clone(),
            matched_rule_ids: decision.matched_rule_ids.clone(),
            occurred_at_ms: request.occurred_at_ms,
        }
    }
}

/// Result recorded after an authorized effect returns to its PEP.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EnforcementResult {
    /// The authorized effect returned success.
    Succeeded,
    /// The authorized effect returned an error.
    Failed,
}

impl EnforcementResult {
    /// Stable persisted value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }
}

/// Persistence boundary required before and after a side effect.
pub trait DecisionAuditSink {
    /// Storage-specific failure returned by the trusted audit implementation.
    type Error;

    /// Persist a redacted decision before execution is possible.
    ///
    /// # Errors
    ///
    /// Failure must prevent the effect from running.
    fn record_decision(&mut self, record: &PolicyDecisionAudit) -> Result<(), Self::Error>;

    /// Persist the enforcement result after the effect returns.
    ///
    /// # Errors
    ///
    /// Failure is surfaced for durable reconciliation by the caller.
    fn record_enforcement(
        &mut self,
        decision_id: &str,
        occurred_at_ms: u64,
        result: EnforcementResult,
    ) -> Result<(), Self::Error>;
}

/// Test and bootstrap sink that keeps only already-redacted records.
#[derive(Default)]
pub struct MemoryAuditSink {
    /// Persisted decision records.
    pub decisions: Vec<PolicyDecisionAudit>,
    /// Persisted enforcement results.
    pub enforcement: Vec<(String, u64, EnforcementResult)>,
    /// Simulate an unavailable audit boundary.
    pub unavailable: bool,
}

impl DecisionAuditSink for MemoryAuditSink {
    type Error = &'static str;

    fn record_decision(&mut self, record: &PolicyDecisionAudit) -> Result<(), Self::Error> {
        if self.unavailable {
            return Err("audit_unavailable");
        }
        self.decisions.push(record.clone());
        Ok(())
    }

    fn record_enforcement(
        &mut self,
        decision_id: &str,
        occurred_at_ms: u64,
        result: EnforcementResult,
    ) -> Result<(), Self::Error> {
        if self.unavailable {
            return Err("audit_unavailable");
        }
        self.enforcement
            .push((decision_id.to_owned(), occurred_at_ms, result));
        Ok(())
    }
}
