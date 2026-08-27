//! Digest-verified monotonic Model Registry (ADR-010).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::provider::ModelEntry;

/// Registry construction failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistryError {
    /// A duplicate model id was registered.
    DuplicateModel,
    /// The recorded digest does not match the entry content.
    DigestMismatch,
    /// A monotonic update was rolled back or reused a sequence.
    Rollback,
    /// The entry was malformed.
    InvalidEntry,
}

impl std::fmt::Display for RegistryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::DuplicateModel => "duplicate_model",
            Self::DigestMismatch => "digest_mismatch",
            Self::Rollback => "rollback",
            Self::InvalidEntry => "invalid_entry",
        })
    }
}

impl std::error::Error for RegistryError {}

/// One registry record: an entry plus its canonical-content digest.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RegistryRecord {
    /// Registered model offering.
    pub entry: ModelEntry,
    /// `sha256:<64 hex>` of the canonical entry JSON.
    pub content_digest: String,
}

/// Digest-verified registry snapshot with a monotonic sequence.
#[derive(Clone, Debug)]
pub struct ModelRegistry {
    records: BTreeMap<String, RegistryRecord>,
    sequence: u64,
    snapshot_id: String,
}

impl ModelRegistry {
    /// Validate and construct a registry snapshot.
    ///
    /// # Errors
    ///
    /// Rejects malformed entries, duplicates and digest mismatches.
    pub fn new(sequence: u64, records: Vec<RegistryRecord>) -> Result<Self, RegistryError> {
        let mut map = BTreeMap::new();
        for record in records {
            if record.entry.model_id.is_empty()
                || record.entry.provider_id.is_empty()
                || record.entry.endpoint.host.is_empty()
                || record.entry.endpoint.port == 0
                || record.entry.context_tokens == 0
            {
                return Err(RegistryError::InvalidEntry);
            }
            if !record.content_digest.starts_with("sha256:") || record.content_digest.len() != 71 {
                return Err(RegistryError::InvalidEntry);
            }
            let actual = canonical_digest(&record.entry);
            if actual != record.content_digest {
                return Err(RegistryError::DigestMismatch);
            }
            if map.insert(record.entry.model_id.clone(), record).is_some() {
                return Err(RegistryError::DuplicateModel);
            }
        }
        let snapshot_id = Self::snapshot_of(sequence, &map);
        Ok(Self {
            records: map,
            sequence,
            snapshot_id,
        })
    }

    /// Monotonic replacement of the snapshot.
    ///
    /// # Errors
    ///
    /// Rejects sequence rollback.
    pub fn update(
        &mut self,
        sequence: u64,
        records: Vec<RegistryRecord>,
    ) -> Result<(), RegistryError> {
        if sequence < self.sequence {
            return Err(RegistryError::Rollback);
        }
        let next = Self::new(sequence, records)?;
        self.records = next.records;
        self.sequence = sequence;
        self.snapshot_id = next.snapshot_id;
        Ok(())
    }

    /// Snapshot digest bound into routing decisions.
    #[must_use]
    pub fn snapshot_id(&self) -> &str {
        &self.snapshot_id
    }

    /// Monotonic sequence of this snapshot.
    #[must_use]
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }

    /// All records, ordered by model id.
    pub fn records(&self) -> impl Iterator<Item = &RegistryRecord> {
        self.records.values()
    }

    /// Look up one record.
    #[must_use]
    pub fn get(&self, model_id: &str) -> Option<&RegistryRecord> {
        self.records.get(model_id)
    }

    fn snapshot_of(sequence: u64, records: &BTreeMap<String, RegistryRecord>) -> String {
        let mut hasher = Sha256::new();
        hasher.update(sequence.to_le_bytes());
        for (model_id, record) in records {
            hasher.update(model_id.as_bytes());
            hasher.update(record.content_digest.as_bytes());
        }
        format!("sha256:{}", saber_sandbox::hex_upper(&hasher.finalize()))
    }
}

/// Canonical `sha256:<64 hex>` digest of one entry.
#[must_use]
pub fn canonical_digest(entry: &ModelEntry) -> String {
    let encoded = serde_json::to_vec(entry).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(b"saber-model-entry-v1\0");
    hasher.update(&encoded);
    format!("sha256:{}", saber_sandbox::hex_upper(&hasher.finalize()))
}

/// Record helper preserving the digest invariant at construction sites.
#[must_use]
pub fn record_for(entry: ModelEntry) -> RegistryRecord {
    let content_digest = canonical_digest(&entry);
    RegistryRecord {
        entry,
        content_digest,
    }
}
