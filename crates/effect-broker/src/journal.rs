//! Durable effect journal glue.
//!
//! [`EffectJournal`] is the broker-side view of the S04 durable
//! intent/result ordering. The in-crate adapter implements it for the
//! encrypted `saber_event_store::EventStore` so the broker records the
//! intent before any policy audit or effect and the verified result after
//! the effect, transactionally and idempotently.

use saber_event_store::{
    DatabaseKeyProvider, EffectDisposition, EffectIntent, EffectResult, EventStore, StoreError,
};

/// Metadata-only intent description. Secret material, raw stdout/stderr and
/// credentials never enter the journal.
#[derive(Clone, Debug)]
pub struct JournalIntent<'a> {
    /// Unique event identifier.
    pub event_id: &'a str,
    /// Owning workspace identifier.
    pub workspace_id: &'a str,
    /// Stable intent identifier.
    pub intent_id: &'a str,
    /// Effect kind label, for example `sandbox.exec`.
    pub effect_kind: &'a str,
    /// Canonical capability action.
    pub action: &'a str,
    /// Canonical resource selector.
    pub resource: &'a str,
    /// Sandbox plan digest.
    pub plan_digest: &'a str,
    /// Egress purpose when the effect touches the network.
    pub egress_purpose: Option<&'a str>,
    /// Wall-clock time in Unix milliseconds.
    pub occurred_at_ms: u64,
    /// Idempotency key.
    pub idempotency_key: &'a str,
}

/// Metadata-only verified result description.
#[derive(Clone, Debug)]
pub struct JournalResult<'a> {
    /// Unique result event identifier.
    pub event_id: &'a str,
    /// Owning workspace identifier.
    pub workspace_id: &'a str,
    /// Intent being resolved.
    pub intent_id: &'a str,
    /// Whether the effect completed.
    pub completed: bool,
    /// Stable detail label (for example a verification verdict).
    pub detail: Option<&'a str>,
    /// Wall-clock time in Unix milliseconds.
    pub occurred_at_ms: u64,
    /// Idempotency key.
    pub idempotency_key: &'a str,
}

/// Broker-facing durable journal contract.
pub trait EffectJournal {
    /// Journal failure type.
    type Error;

    /// Durably record an intent before any effect runs.
    ///
    /// # Errors
    ///
    /// Implementation-defined; the broker fails closed on error.
    fn record_intent(&mut self, intent: &JournalIntent<'_>) -> Result<(), Self::Error>;

    /// Durably record the verified result.
    ///
    /// # Errors
    /// Implementation-defined; the broker surfaces it for reconciliation.
    fn record_result(&mut self, result: &JournalResult<'_>) -> Result<(), Self::Error>;
}

impl EffectJournal for EventStore {
    type Error = StoreError;

    fn record_intent(&mut self, intent: &JournalIntent<'_>) -> Result<(), Self::Error> {
        let payload = serde_json::json!({
            "action": intent.action,
            "resource": intent.resource,
            "plan_digest": intent.plan_digest,
            "egress_purpose": intent.egress_purpose,
        });
        let command = EffectIntent {
            event_id: intent.event_id,
            workspace_id: intent.workspace_id,
            intent_id: intent.intent_id,
            effect_kind: intent.effect_kind,
            payload: &payload,
            occurred_at_ms: intent.occurred_at_ms,
            idempotency_key: intent.idempotency_key,
        };
        self.record_effect_intent(&command).map(|_| ())
    }

    fn record_result(&mut self, result: &JournalResult<'_>) -> Result<(), Self::Error> {
        let payload = serde_json::json!({
            "completed": result.completed,
            "detail": result.detail,
        });
        let command = EffectResult {
            event_id: result.event_id,
            workspace_id: result.workspace_id,
            intent_id: result.intent_id,
            result: &payload,
            disposition: if result.completed {
                EffectDisposition::Completed
            } else {
                EffectDisposition::Abandoned
            },
            occurred_at_ms: result.occurred_at_ms,
            idempotency_key: result.idempotency_key,
        };
        self.record_effect_result(&command).map(|_| ())
    }
}

/// Open a file-backed encrypted store for tests and local composition checks.
///
/// # Errors
///
/// Mirrors [`EventStore::open`].
pub fn test_store<P: DatabaseKeyProvider>(
    provider: &P,
    workspace_id: &str,
    directory: &std::path::Path,
) -> Result<EventStore, StoreError> {
    EventStore::open(
        &directory.join("saber-effect-broker-test.db"),
        workspace_id,
        provider,
    )
}
