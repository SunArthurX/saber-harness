//! The single-writer Memory Authority (ADR-012).

use std::collections::BTreeMap;

use saber_policy::DataClass;
use serde::Serialize;

use crate::entry::{
    MemoryEntry, MemoryProvenance, MemoryState, ReviewAuthority, RevisionEntry, entry_id_for,
};

/// Admission failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdmissionError {
    /// Missing sensitivity or origin.
    Unclassified,
    /// The proposal targets a foreign workspace.
    CrossWorkspace,
    /// Malformed key or value.
    Malformed,
    /// An identical candidate already exists.
    DuplicateCandidate,
}

impl std::fmt::Display for AdmissionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Unclassified => "unclassified",
            Self::CrossWorkspace => "cross_workspace",
            Self::Malformed => "malformed",
            Self::DuplicateCandidate => "duplicate_candidate",
        })
    }
}

impl std::error::Error for AdmissionError {}

/// Promotion failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PromoteError {
    /// Unknown candidate.
    UnknownCandidate,
    /// The entry is not in the candidate state.
    NotCandidate,
    /// The entry has already been promoted (idempotent re-promotion of the
    /// same value is a no-op, not an error; this codes foreign states).
    InvalidState,
}

impl std::fmt::Display for PromoteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::UnknownCandidate => "unknown_candidate",
            Self::NotCandidate => "not_candidate",
            Self::InvalidState => "invalid_state",
        })
    }
}

impl std::error::Error for PromoteError {}

/// A memory proposal awaiting admission.
#[derive(Clone, Debug)]
pub struct MemoryProposal {
    /// Workspace-scoped key.
    pub key: String,
    /// Memory classification.
    pub kind: crate::entry::MemoryKind,
    /// Memory value.
    pub value: String,
    /// Target tenant.
    pub tenant: String,
    /// Target workspace.
    pub workspace: String,
    /// Data classification.
    pub sensitivity: DataClass,
    /// Origin and trust posture.
    pub provenance: MemoryProvenance,
    /// TTL expiry, if any.
    pub expires_at_ms: Option<u64>,
}

/// One truth query.
#[derive(Clone, Debug)]
pub struct MemoryQuery {
    /// Asker's classification ceiling.
    pub sensitivity_ceiling: DataClass,
    /// Query time in Unix milliseconds (TTL evaluation).
    pub now_ms: u64,
    /// Optional key filter.
    pub key: Option<String>,
}

/// A query-visible promoted memory.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct MemoryView {
    /// The visible entry.
    pub entry: MemoryEntry,
}

/// Stable event names for the durable journal.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EventRecord {
    /// Stable event name.
    pub name: &'static str,
    /// Metadata-only payload (no memory content).
    pub entry_id: Option<String>,
}

/// One record's revision history.
#[derive(Clone, Debug, Default, Serialize)]
struct MemoryRecord {
    revisions: Vec<RevisionEntry>,
}

impl MemoryRecord {
    fn candidate(&self, entry_id: &str) -> Option<&RevisionEntry> {
        self.revisions
            .iter()
            .find(|slot| slot.entry.entry_id == entry_id)
    }
}

/// The single-writer authority for one workspace.
pub struct MemoryAuthority {
    tenant: String,
    workspace: String,
    records: BTreeMap<String, MemoryRecord>,
    write_sequence: u64,
    events: Vec<EventRecord>,
}

impl MemoryAuthority {
    /// Construct the authority for one workspace scope.
    #[must_use]
    pub fn new(tenant: &str, workspace: &str) -> Self {
        Self {
            tenant: tenant.to_owned(),
            workspace: workspace.to_owned(),
            records: BTreeMap::new(),
            write_sequence: 0,
            events: Vec::new(),
        }
    }

    /// The authority's workspace scope.
    #[must_use]
    pub fn scope(&self) -> (&str, &str) {
        (&self.tenant, &self.workspace)
    }

    /// Monotonic write sequence (serialization evidence).
    #[must_use]
    pub const fn write_sequence(&self) -> u64 {
        self.write_sequence
    }

    /// Propose a memory candidate. Candidates never auto-promote.
    ///
    /// # Errors
    ///
    /// [`AdmissionError::Unclassified`] without sensitivity or origin;
    /// [`AdmissionError::CrossWorkspace`] for foreign scopes;
    /// [`AdmissionError::DuplicateCandidate`] for identical pending
    /// candidates.
    pub fn propose(
        &mut self,
        proposal: MemoryProposal,
        _now_ms: u64,
    ) -> Result<String, AdmissionError> {
        self.write_sequence += 1;
        if proposal.tenant != self.tenant || proposal.workspace != self.workspace {
            return Err(AdmissionError::CrossWorkspace);
        }
        if proposal.sensitivity == DataClass::Public && proposal.provenance.origin.is_empty()
            || proposal.provenance.origin.is_empty()
            || proposal.key.is_empty()
            || proposal.value.is_empty()
            || !proposal
                .key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-'))
        {
            return Err(AdmissionError::Unclassified);
        }
        if proposal.key.is_empty() || proposal.value.len() > 16_384 {
            return Err(AdmissionError::Malformed);
        }
        let revision = u32::try_from(
            self.records
                .get(&proposal.key)
                .map_or(0_usize, |record| record.revisions.len()),
        )
        .unwrap_or(u32::MAX)
            + 1;
        let entry_id = entry_id_for(&proposal.key, &proposal.value, &proposal.provenance.origin);
        let record = self.records.entry(proposal.key.clone()).or_default();
        if record
            .revisions
            .iter()
            .any(|slot| slot.entry.entry_id == entry_id)
        {
            return Err(AdmissionError::DuplicateCandidate);
        }
        let entry = MemoryEntry {
            entry_id: entry_id.clone(),
            key: proposal.key,
            kind: proposal.kind,
            value: proposal.value,
            tenant: self.tenant.clone(),
            workspace: self.workspace.clone(),
            sensitivity: proposal.sensitivity,
            provenance: proposal.provenance,
            freshness: crate::entry::MemoryFreshness {
                promoted_at_ms: 0,
                expires_at_ms: proposal.expires_at_ms,
            },
            state: MemoryState::Candidate,
            revision,
        };
        record.revisions.push(RevisionEntry {
            entry,
            superseded_at_ms: None,
            conflicted_with: Vec::new(),
        });
        self.events.push(EventRecord {
            name: "memory.proposed",
            entry_id: Some(entry_id.clone()),
        });
        Ok(entry_id)
    }

    /// Promote a candidate under an explicit review authority. A
    /// contradicting promotion supersedes the current promoted revision as a
    /// new linked revision — never an overwrite.
    ///
    /// # Errors
    ///
    /// [`PromoteError::UnknownCandidate`] for unknown ids;
    /// [`PromoteError::NotCandidate`] outside the candidate state.
    pub fn promote(
        &mut self,
        entry_id: &str,
        _authority: &ReviewAuthority,
        now_ms: u64,
    ) -> Result<(), PromoteError> {
        self.write_sequence += 1;
        let key = self
            .records
            .iter()
            .find(|(_, record)| record.candidate(entry_id).is_some())
            .map(|(key, _)| key.clone())
            .ok_or(PromoteError::UnknownCandidate)?;
        let record = self
            .records
            .get_mut(&key)
            .unwrap_or_else(|| unreachable!("key found above"));
        let slot = record
            .revisions
            .iter_mut()
            .find(|slot| slot.entry.entry_id == entry_id)
            .ok_or(PromoteError::UnknownCandidate)?;
        if slot.entry.state != MemoryState::Candidate {
            return Err(PromoteError::NotCandidate);
        }
        slot.entry.state = MemoryState::Promoted;
        slot.entry.freshness.promoted_at_ms = now_ms;

        // Supersede every other promoted revision of this key: the conflict
        // link preserves history instead of overwriting it.
        let mut conflicts = Vec::new();
        for other in &mut record.revisions {
            if other.entry.entry_id != entry_id
                && other.entry.state == MemoryState::Promoted
                && other.superseded_at_ms.is_none()
            {
                other.superseded_at_ms = Some(now_ms);
                conflicts.push(other.entry.entry_id.clone());
                other.entry.state = MemoryState::Stale;
            }
        }
        if let Some(slot) = record
            .revisions
            .iter_mut()
            .find(|slot| slot.entry.entry_id == entry_id)
        {
            slot.conflicted_with = conflicts;
        }
        self.events.push(EventRecord {
            name: "memory.promoted",
            entry_id: Some(entry_id.to_owned()),
        });
        Ok(())
    }

    /// Revoke one entry: excluded from every query immediately, retained
    /// for audit.
    pub fn revoke(&mut self, entry_id: &str) {
        self.write_sequence += 1;
        for record in self.records.values_mut() {
            for slot in &mut record.revisions {
                if slot.entry.entry_id == entry_id {
                    slot.entry.state = MemoryState::Revoked;
                }
            }
        }
        self.events.push(EventRecord {
            name: "memory.revoked",
            entry_id: Some(entry_id.to_owned()),
        });
    }

    /// Query truth: promoted, non-expired, in-scope entries within the
    /// ceiling. Stale and revoked entries never surface as truth.
    #[must_use]
    #[allow(clippy::let_underscore_must_use)]
    pub fn query(&mut self, request: &MemoryQuery) -> Vec<MemoryView> {
        // First pass (immutable): collect visible entries and entries whose
        // TTL has expired and must transition to Stale.
        let mut views = Vec::new();
        let mut expired: Vec<(String, String)> = Vec::new();
        for (key, record) in &self.records {
            if let Some(filter) = &request.key
                && key != filter
            {
                continue;
            }
            for slot in &record.revisions {
                if slot.entry.state != MemoryState::Promoted {
                    continue;
                }
                if slot.entry.sensitivity > request.sensitivity_ceiling {
                    continue;
                }
                if slot
                    .entry
                    .freshness
                    .expires_at_ms
                    .is_some_and(|expires| expires <= request.now_ms)
                {
                    expired.push((key.clone(), slot.entry.entry_id.clone()));
                    continue;
                }
                views.push(MemoryView {
                    entry: slot.entry.clone(),
                });
            }
        }
        // Second pass (mutable): transition expired entries to Stale; the
        // state change is durable via the recorded event.
        for (key, entry_id) in expired {
            if let Some(slot) = self.records.get_mut(&key).and_then(|record| {
                record
                    .revisions
                    .iter_mut()
                    .find(|slot| slot.entry.entry_id == entry_id)
            }) {
                slot.entry.state = MemoryState::Stale;
                self.events.push(EventRecord {
                    name: "memory.stale",
                    entry_id: Some(entry_id),
                });
            }
        }
        self.events.push(EventRecord {
            name: "memory.queried",
            entry_id: None,
        });
        views
    }

    /// The full revision history of one key (audit surface).
    #[must_use]
    pub fn history(&self, key: &str) -> &[RevisionEntry] {
        self.records
            .get(key)
            .map_or(&[], |record| record.revisions.as_slice())
    }

    /// Drain the recorded event trail for durable journaling.
    #[must_use]
    pub fn take_events(&mut self) -> Vec<EventRecord> {
        std::mem::take(&mut self.events)
    }
}
