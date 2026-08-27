//! Idempotent, revocable import library and untrusted fabric admission
//! (ADR-014).

use std::collections::BTreeMap;

use saber_context_engine::{
    ChunkContent, KnowledgeFabric, NutritionLabel, Provenance, ScopeKey, ScopeKind, TrustLevel,
};
use saber_policy::DataClass;
use serde::Serialize;

use crate::record::{CaxError, CaxRecord, SourceFormat, entry_digest_of};

/// Minimal tombstone retained after revocation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ImportTombstone {
    /// Revoked record id.
    pub record_id: String,
    /// Origin URI of the revoked source.
    pub origin_uri: String,
    /// Raw digest of the revoked source.
    pub raw_digest: String,
}

/// Import library failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LibraryError {
    /// The record failed validation.
    Invalid(CaxError),
}

impl std::fmt::Display for LibraryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(error) => write!(formatter, "invalid:{error}"),
        }
    }
}

impl std::error::Error for LibraryError {}

/// Outcome of importing one source.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ImportOutcome {
    /// A new record was created.
    Created(CaxRecord),
    /// The exact source already existed; the stored record is returned.
    Existing(CaxRecord),
}

/// The import library for one workspace scope.
#[derive(Default)]
pub struct CaxLibrary {
    records: BTreeMap<String, CaxRecord>,
    by_raw_digest: BTreeMap<String, String>,
    revoked: BTreeMap<String, ImportTombstone>,
}

impl CaxLibrary {
    /// Import (or re-import) one already-parsed record.
    ///
    /// # Errors
    ///
    /// [`LibraryError::Invalid`] when validation fails. Cross-workscope
    /// injection is rejected with [`CaxError::CrossWorkspace`].
    pub fn import(
        &mut self,
        tenant: &str,
        workspace: &str,
        record: CaxRecord,
    ) -> Result<ImportOutcome, LibraryError> {
        record.validate().map_err(LibraryError::Invalid)?;
        if record.tenant != tenant || record.workspace != workspace {
            return Err(LibraryError::Invalid(CaxError::CrossWorkspace));
        }
        if let Some(tombstone) = self.revoked.get(&record.record_id) {
            // Re-importing a revoked source stays revoked: the tombstone
            // wins and the content does not return silently.
            let _ = tombstone;
            return Err(LibraryError::Invalid(CaxError::Malformed));
        }
        if let Some(existing_id) = self.by_raw_digest.get(&record.source.raw_digest) {
            let existing = self
                .records
                .get(existing_id)
                .cloned()
                .unwrap_or_else(|| unreachable!("raw-digest index is authoritative"));
            return Ok(ImportOutcome::Existing(existing));
        }
        self.by_raw_digest
            .insert(record.source.raw_digest.clone(), record.record_id.clone());
        self.records
            .insert(record.record_id.clone(), record.clone());
        Ok(ImportOutcome::Created(record))
    }

    /// Revoke one record: removed from every query, provenance tombstone
    /// retained (ADR-014).
    pub fn revoke(&mut self, record_id: &str) -> Option<ImportTombstone> {
        let record = self.records.remove(record_id)?;
        self.by_raw_digest.remove(&record.source.raw_digest);
        let tombstone = ImportTombstone {
            record_id: record.record_id.clone(),
            origin_uri: record.source.origin_uri.clone(),
            raw_digest: record.source.raw_digest,
        };
        self.revoked.insert(record.record_id, tombstone.clone());
        Some(tombstone)
    }

    /// All live records ordered by id.
    pub fn records(&self) -> impl Iterator<Item = &CaxRecord> {
        self.records.values()
    }

    /// Retained tombstones (minimal audit provenance).
    pub fn tombstones(&self) -> impl Iterator<Item = &ImportTombstone> {
        self.revoked.values()
    }

    /// Look up one live record.
    #[must_use]
    pub fn get(&self, record_id: &str) -> Option<&CaxRecord> {
        self.records.get(record_id)
    }
}

/// Mint the S09 nutrition-label parity for one imported record: entries
/// become `Untrusted`-trust chunks with provenance from the source.
#[must_use]
pub fn fabric_admissions_for(record: &CaxRecord) -> Vec<(NutritionLabel, ChunkContent)> {
    let mut admissions = Vec::new();
    for (index, entry) in record.entries.iter().enumerate() {
        let label = NutritionLabel {
            chunk_id: format!("{}#{}", record.record_id, index),
            scope: ScopeKey {
                tenant: record.tenant.clone(),
                workspace: record.workspace.clone(),
                kind: ScopeKind::Conversation,
            },
            sensitivity: DataClass::Internal,
            provenance: Provenance {
                origin: record.source.origin_uri.clone(),
                trust: TrustLevel::Untrusted,
                imported_at_ms: entry.occurred_at_ms.unwrap_or_default(),
            },
            freshness: saber_context_engine::FreshnessPolicy {
                created_at_ms: entry.occurred_at_ms.unwrap_or_default(),
                expires_at_ms: None,
            },
            content_digest: String::new(),
        };
        let content = ChunkContent::Text {
            text: entry.content.clone(),
        };
        // The fabric verifies its own canonical digest of the typed
        // content; the CAX entry digest stays the importer-side evidence.
        let label = NutritionLabel {
            content_digest: saber_context_engine::content_digest_of(&content),
            ..label
        };
        admissions.push((label, content));
    }
    admissions
}

/// Admit one imported record into a knowledge fabric as untrusted chunks.
///
/// # Errors
///
/// Mirrors [`KnowledgeFabric::admit`]; digest mismatches surface there.
pub fn admit_into_fabric(
    fabric: &mut KnowledgeFabric,
    record: &CaxRecord,
) -> Result<Vec<String>, saber_context_engine::AdmissionError> {
    let mut ids = Vec::new();
    for (label, content) in fabric_admissions_for(record) {
        ids.push(fabric.admit(label, content)?);
    }
    Ok(ids)
}

/// Recompute the entry digests of a record against its raw source to prove
/// the importer invented nothing: every entry content must appear verbatim
/// in the raw bytes.
#[must_use]
pub fn contents_appear_in_raw(record: &CaxRecord, raw: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(raw) else {
        return false;
    };
    record.entries.iter().all(|entry| {
        text.contains(entry.content.as_str())
            && entry_digest_of(&entry.content) == entry.content_digest
    })
}

/// Format of a record's source, for dispatch.
#[must_use]
pub const fn source_format(record: &CaxRecord) -> SourceFormat {
    record.source.format
}
