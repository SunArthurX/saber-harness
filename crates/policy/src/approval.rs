//! Exact, expiring and revocable approval grants.

use std::collections::BTreeSet;

use crate::vocabulary::ResourcePattern;
use crate::{CapabilityRequest, PolicyError};

const MAX_APPROVAL_TTL_MS: u64 = 86_400_000;

/// Lifetime and replay semantics for an approval.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApprovalScope {
    /// Consume the grant after its first successful authorization.
    Once,
    /// Permit exact replay within the same task until expiry or revocation.
    Task,
}

/// User-visible request; free text is deliberately excluded from persisted audit.
pub struct ApprovalRequest {
    /// Stable request identifier.
    pub approval_request_id: String,
    /// Exact capability request that caused the prompt.
    pub capability: CapabilityRequest,
    /// Maximum resource selector being requested.
    pub requested_scope: ResourcePattern,
    /// User-facing reason, never included in [`crate::PolicyDecisionAudit`].
    pub reason: String,
    /// Concrete least-authority alternatives shown by the UI.
    pub alternatives: Vec<String>,
    /// Once or exact-task replay.
    pub scope: ApprovalScope,
    /// Absolute expiration in Unix milliseconds.
    pub expires_at_ms: u64,
}

impl ApprovalRequest {
    /// Construct a bounded request suitable for an approval card.
    ///
    /// # Errors
    ///
    /// Rejects empty/vague alternatives, excessive TTL, non-covering scope and
    /// task persistence for actions whose vocabulary forbids persistence.
    pub fn new(
        approval_request_id: impl Into<String>,
        capability: CapabilityRequest,
        requested_scope: ResourcePattern,
        reason: impl Into<String>,
        alternatives: Vec<String>,
        scope: ApprovalScope,
        expires_at_ms: u64,
    ) -> Result<Self, PolicyError> {
        let approval_request_id = approval_request_id.into();
        let reason = reason.into();
        if approval_request_id.is_empty() || reason.is_empty() {
            return Err(PolicyError::InvalidApproval);
        }
        if expires_at_ms <= capability.occurred_at_ms
            || expires_at_ms.saturating_sub(capability.occurred_at_ms) > MAX_APPROVAL_TTL_MS
            || !requested_scope.covers(&capability.resource)
        {
            return Err(PolicyError::InvalidApproval);
        }
        if scope == ApprovalScope::Task && !capability.action.descriptor().persistable() {
            return Err(PolicyError::ApprovalScopeTooBroad);
        }
        if alternatives.is_empty()
            || alternatives.iter().any(|alternative| {
                let normalized = alternative.to_ascii_lowercase();
                alternative.trim().is_empty()
                    || normalized.contains("allow everything")
                    || normalized.contains("允许全部")
            })
        {
            return Err(PolicyError::VagueApproval);
        }
        Ok(Self {
            approval_request_id,
            capability,
            requested_scope,
            reason,
            alternatives,
            scope,
            expires_at_ms,
        })
    }
}

/// Human approval bound to exact request inputs and a no-broader resource selector.
#[derive(Clone, Debug)]
pub struct ApprovalGrant {
    /// Stable grant identifier.
    pub grant_id: String,
    /// Approval request this grant resolves.
    pub approval_request_id: String,
    /// Human or administrative approver identifier.
    pub approver_id: String,
    /// Exact capability request digest, including operation hash.
    pub request_digest: String,
    /// No-broader approved resource selector.
    pub approved_scope: ResourcePattern,
    /// Once or task replay semantics.
    pub scope: ApprovalScope,
    /// Grant expiration no later than the request expiration.
    pub expires_at_ms: u64,
}

impl ApprovalGrant {
    /// Approve a request with an equal or narrower scope and TTL.
    ///
    /// # Errors
    ///
    /// Rejects scope widening, missing identities and extended TTL.
    pub fn approve(
        request: &ApprovalRequest,
        grant_id: impl Into<String>,
        approver_id: impl Into<String>,
        approved_scope: ResourcePattern,
        expires_at_ms: u64,
    ) -> Result<Self, PolicyError> {
        let grant_id = grant_id.into();
        let approver_id = approver_id.into();
        if grant_id.is_empty()
            || approver_id.is_empty()
            || expires_at_ms > request.expires_at_ms
            || expires_at_ms <= request.capability.occurred_at_ms
            || !pattern_covers_pattern(&request.requested_scope, &approved_scope)
            || !approved_scope.covers(&request.capability.resource)
        {
            return Err(PolicyError::ApprovalScopeTooBroad);
        }
        Ok(Self {
            grant_id,
            approval_request_id: request.approval_request_id.clone(),
            approver_id,
            request_digest: request.capability.digest(),
            approved_scope,
            scope: request.scope,
            expires_at_ms,
        })
    }
}

/// Stateful revocation and one-shot replay boundary.
#[derive(Default)]
pub struct ApprovalLedger {
    revoked: BTreeSet<String>,
    consumed: BTreeSet<String>,
}

impl ApprovalLedger {
    /// Revoke a grant immediately.
    pub fn revoke(&mut self, grant_id: impl Into<String>) {
        self.revoked.insert(grant_id.into());
    }

    /// Validate all bindings and consume a one-shot grant.
    ///
    /// # Errors
    ///
    /// Rejects expired, revoked, replayed, widened or TOCTOU-changed requests.
    pub fn validate_and_consume(
        &mut self,
        grant: &ApprovalGrant,
        request: &CapabilityRequest,
        now_ms: u64,
    ) -> Result<(), PolicyError> {
        self.validate(grant, request, now_ms)?;
        self.consume(grant);
        Ok(())
    }

    pub(crate) fn validate(
        &self,
        grant: &ApprovalGrant,
        request: &CapabilityRequest,
        now_ms: u64,
    ) -> Result<(), PolicyError> {
        if self.revoked.contains(&grant.grant_id) {
            return Err(PolicyError::ApprovalRevoked);
        }
        if now_ms >= grant.expires_at_ms {
            return Err(PolicyError::ApprovalExpired);
        }
        if grant.request_digest != request.digest()
            || !grant.approved_scope.covers(&request.resource)
        {
            return Err(PolicyError::ApprovalBindingMismatch);
        }
        if grant.scope == ApprovalScope::Once && self.consumed.contains(&grant.grant_id) {
            return Err(PolicyError::ApprovalReplayed);
        }
        Ok(())
    }

    pub(crate) fn consume(&mut self, grant: &ApprovalGrant) {
        if grant.scope == ApprovalScope::Once {
            self.consumed.insert(grant.grant_id.clone());
        }
    }
}

fn pattern_covers_pattern(parent: &ResourcePattern, child: &ResourcePattern) -> bool {
    match child {
        ResourcePattern::Exact(resource) => parent.covers(resource),
        ResourcePattern::Prefix(resource) => match parent {
            ResourcePattern::Exact(_) => false,
            ResourcePattern::Prefix(_) => parent.covers(resource),
        },
    }
}
