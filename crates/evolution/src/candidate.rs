//! Evolution candidates: typed lifecycle, provenance and digest binding
//! (ADR-017).

use saber_memory_authority::{ReviewAuthority, TrustLevel};
use serde::{Deserialize, Serialize};

/// What kind of capability a candidate proposes.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EvolutionKind {
    /// A reusable skill.
    Skill,
    /// A governed memory entry.
    Memory,
    /// A governing rule.
    Rule,
    /// A multi-step workflow.
    Workflow,
    /// An isolated code capsule (E4 generated code, ADR-018).
    Code,
}

/// Lifecycle states; transitions never skip (INV-03, ADR-017).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum CandidateState {
    /// Proposed from runtime evidence, awaiting quarantine.
    Proposed,
    /// Isolated for evaluation.
    Quarantined,
    /// Evaluated; `passed` records the harness verdict (evidence, never
    /// promotion).
    Evaluated {
        /// Whether the deterministic evaluation passed.
        passed: bool,
    },
    /// Promoted by an explicit review authority.
    Promoted,
    /// Rejected with a stable reason code.
    Rejected {
        /// Stable rejection reason.
        reason: &'static str,
    },
    /// Terminally revoked; removed from active queries immediately.
    Revoked,
}

/// Provenance back to the runtime evidence that proposed the candidate.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CandidateProvenance {
    /// Source event id in the durable store.
    pub source_event_id: String,
    /// Origin identifier (run, importer, session).
    pub origin: String,
    /// Trust posture of the proposing evidence.
    pub trust: TrustLevel,
}

/// One digest-bound evolution candidate.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EvolutionCandidate {
    /// Stable content-derived candidate id.
    pub candidate_id: String,
    /// Capability kind.
    pub kind: EvolutionKind,
    /// Canonical payload content.
    pub payload: String,
    /// `sha256:<64 hex>` of the payload at proposal.
    pub payload_digest: String,
    /// Provenance to the source event.
    pub provenance: CandidateProvenance,
    /// Current lifecycle state.
    pub state: CandidateState,
}

/// Workshop failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkshopError {
    /// The transition would skip a lifecycle state (INV-03).
    IllegalTransition,
    /// The payload no longer matches its digest: tampering.
    TamperedPayload,
    /// The evaluation failed; promotion is blocked.
    EvaluationFailed,
    /// Unknown or terminal candidate.
    UnknownOrTerminal,
    /// Malformed proposal input.
    Malformed,
}

impl std::fmt::Display for WorkshopError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::IllegalTransition => "illegal_transition",
            Self::TamperedPayload => "tampered_payload",
            Self::EvaluationFailed => "evaluation_failed",
            Self::UnknownOrTerminal => "unknown_or_terminal",
            Self::Malformed => "malformed",
        })
    }
}

impl std::error::Error for WorkshopError {}

/// One deterministic evaluation record (evidence, never promotion).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EvaluationRecord {
    /// Candidate that was evaluated.
    pub candidate_id: String,
    /// Digest of the harness inputs.
    pub inputs_digest: String,
    /// Digest of the harness outputs.
    pub outputs_digest: String,
    /// Whether the evaluation passed.
    pub passed: bool,
    /// Evaluation time in Unix milliseconds.
    pub evaluated_at_ms: u64,
}

/// One promotion record with its digest chain.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PromotionRecord {
    /// Promoted candidate.
    pub candidate_id: String,
    /// Digest of the promoted payload.
    pub payload_digest: String,
    /// The explicit review authority (human or named policy).
    pub authority: ReviewAuthority,
    /// Provenance retained for audit (poisoning traceability).
    pub provenance: CandidateProvenance,
    /// Promotion time in Unix milliseconds.
    pub promoted_at_ms: u64,
    /// Digest binding everything above.
    pub promotion_digest: String,
}

/// Digest of a candidate payload.
#[must_use]
pub fn payload_digest_of(payload: &str) -> String {
    saber_policy::sha256_label(&[b"saber-evolution-payload-v1\0", payload.as_bytes()])
}

/// Stable candidate id.
#[must_use]
pub fn candidate_id_of(kind: EvolutionKind, payload_digest: &str) -> String {
    saber_policy::sha256_label(&[
        b"saber-evolution-id-v1\0",
        kind_label(kind).as_bytes(),
        payload_digest.as_bytes(),
    ])
}

/// Digest of the promotion record body.
#[must_use]
pub fn promotion_digest_of(record: &PromotionRecord) -> String {
    let authority = match &record.authority {
        ReviewAuthority::HumanReview { reviewer_id } => format!("human:{reviewer_id}"),
        ReviewAuthority::ExplicitPolicy { rule_id } => format!("policy:{rule_id}"),
    };
    saber_policy::sha256_label(&[
        b"saber-evolution-promotion-v1\0",
        record.candidate_id.as_bytes(),
        record.payload_digest.as_bytes(),
        authority.as_bytes(),
        record.provenance.source_event_id.as_bytes(),
        record.provenance.origin.as_bytes(),
        format!("{:?}", record.provenance.trust).as_bytes(),
        &record.promoted_at_ms.to_le_bytes(),
    ])
}

/// Stable label for an evolution kind.
#[must_use]
pub fn kind_label(kind: EvolutionKind) -> &'static str {
    match kind {
        EvolutionKind::Skill => "skill",
        EvolutionKind::Memory => "memory",
        EvolutionKind::Rule => "rule",
        EvolutionKind::Workflow => "workflow",
        EvolutionKind::Code => "code",
    }
}
