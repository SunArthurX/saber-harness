//! Typed memory entries and labels (ADR-012).

use saber_policy::DataClass;
use serde::{Deserialize, Serialize};

/// Memory classification.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind {
    /// A stated fact.
    Fact,
    /// A user preference.
    Preference,
    /// A governing rule.
    Rule,
    /// A reusable procedure.
    Procedure,
}

/// Trust posture of the proposing source (INV-02).
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    /// First-party verified source.
    Trusted,
    /// Imported with intact provenance.
    Imported,
    /// Untrusted evidence: never promotable without explicit review.
    Untrusted,
}

/// Memory lifecycle states (INV-03: no state implies a later one).
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryState {
    /// Proposed, awaiting explicit review.
    Candidate,
    /// Promoted by an explicit review authority.
    Promoted,
    /// Past its TTL; never surfaced as truth.
    Stale,
    /// Revoked; excluded from every query, retained for audit.
    Revoked,
}

/// Provenance of one memory.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MemoryProvenance {
    /// Origin identifier (uri, run id, importer).
    pub origin: String,
    /// Trust posture at proposal time.
    pub trust: TrustLevel,
    /// Proposal time in Unix milliseconds.
    pub proposed_at_ms: u64,
}

/// Freshness contract.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MemoryFreshness {
    /// Promotion time in Unix milliseconds.
    pub promoted_at_ms: u64,
    /// Absolute expiry; `None` means no TTL bound.
    pub expires_at_ms: Option<u64>,
}

/// The explicit authority that may promote a candidate. There is no
/// runtime-evidence variant: a run cannot construct authority over its own
/// output (ADR-012, TM-06).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "authority", rename_all = "snake_case")]
pub enum ReviewAuthority {
    /// A human reviewer identity.
    HumanReview {
        /// Reviewer identifier.
        reviewer_id: String,
    },
    /// A named, reviewed policy rule.
    ExplicitPolicy {
        /// Stable rule identifier.
        rule_id: String,
    },
}

/// One typed memory entry.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct MemoryEntry {
    /// Stable content-derived identifier.
    pub entry_id: String,
    /// Workspace-scoped memory key (for example `fact:deploy-env`).
    pub key: String,
    /// Memory classification.
    pub kind: MemoryKind,
    /// The memory value as text.
    pub value: String,
    /// Owning tenant.
    pub tenant: String,
    /// Owning workspace.
    pub workspace: String,
    /// Data classification.
    pub sensitivity: DataClass,
    /// Origin and trust posture.
    pub provenance: MemoryProvenance,
    /// Freshness contract.
    pub freshness: MemoryFreshness,
    /// Lifecycle state.
    pub state: MemoryState,
    /// Revision number within the key, starting at 1.
    pub revision: u32,
}

/// One revision slot inside a key's history.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RevisionEntry {
    /// The entry at this revision.
    pub entry: MemoryEntry,
    /// When this revision was superseded, if it was.
    pub superseded_at_ms: Option<u64>,
    /// Entry ids this revision conflicted with when superseded.
    pub conflicted_with: Vec<String>,
}

/// Stable content-derived entry id: key, value and origin. The revision
/// number is the entry's positional index inside the key's history, not
/// part of its identity, so identical re-proposals stay duplicates.
#[must_use]
pub fn entry_id_for(key: &str, value: &str, origin: &str) -> String {
    saber_policy::sha256_label(&[
        b"saber-memory-v1\0",
        key.as_bytes(),
        value.as_bytes(),
        origin.as_bytes(),
    ])
}
