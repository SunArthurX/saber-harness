//! CAX record envelope and digest chain (ADR-014).

use serde::{Deserialize, Serialize};

/// Supported CAX schema versions.
pub const CAX_SCHEMA_VERSION: &str = "1.0.0";

/// Importer format identifiers.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceFormat {
    /// JSONL transcript: one JSON message object per line.
    JsonlTranscript,
    /// Markdown transcript: fenced or `Role:`-prefixed turns.
    MarkdownTranscript,
}

impl SourceFormat {
    /// Stable schema value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::JsonlTranscript => "jsonl_transcript",
            Self::MarkdownTranscript => "markdown_transcript",
        }
    }
}

/// Conversation role of one imported entry.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryRole {
    /// User turn.
    User,
    /// Assistant turn.
    Assistant,
    /// Tool output.
    Tool,
    /// System note.
    System,
}

/// One imported conversation entry.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CaxEntry {
    /// `sha256:<64 hex>` of the exact entry content as it appears in the
    /// raw source.
    pub content_digest: String,
    /// Turn role.
    pub role: EntryRole,
    /// Entry content, verbatim from the raw source.
    pub content: String,
    /// Occurrence time in Unix milliseconds when the source carries one.
    pub occurred_at_ms: Option<u64>,
}

/// Source reference of one record.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CaxSource {
    /// Origin URI of the raw source.
    pub origin_uri: String,
    /// Importer format.
    pub format: SourceFormat,
    /// `sha256:<64 hex>` of the exact raw source bytes.
    pub raw_digest: String,
}

/// Session/actor metadata carried from the source.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CaxSession {
    /// External agent identifier when known.
    pub agent: Option<String>,
    /// External session identifier when known.
    pub session: Option<String>,
}

/// The Canonical Agent Exchange record (ADR-014).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CaxRecord {
    /// Stable content-derived record identifier.
    pub record_id: String,
    /// Schema version; unknown versions fail closed.
    pub schema_version: String,
    /// Target tenant.
    pub tenant: String,
    /// Target workspace.
    pub workspace: String,
    /// Source reference with raw digest.
    pub source: CaxSource,
    /// Session/actor metadata.
    pub session: CaxSession,
    /// Ordered entries.
    pub entries: Vec<CaxEntry>,
    /// Digest over the canonical record body (everything above).
    pub record_digest: String,
}

/// Deterministic validation failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CaxError {
    /// Unknown schema version.
    UnknownVersion,
    /// A digest does not match its recomputation.
    DigestMismatch,
    /// Missing scope, origin or malformed shape.
    Malformed,
    /// The record targets a foreign scope.
    CrossWorkspace,
}

impl std::fmt::Display for CaxError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::UnknownVersion => "unknown_version",
            Self::DigestMismatch => "digest_mismatch",
            Self::Malformed => "malformed",
            Self::CrossWorkspace => "cross_workspace",
        })
    }
}

impl std::error::Error for CaxError {}

fn sha_label(parts: &[&[u8]]) -> String {
    saber_policy::sha256_label(parts)
}

/// Digest of the exact raw source bytes.
#[must_use]
pub fn raw_digest_of(bytes: &[u8]) -> String {
    sha_label(&[b"saber-cax-raw-v1\0", bytes])
}

/// Digest of one entry's verbatim content.
#[must_use]
pub fn entry_digest_of(content: &str) -> String {
    sha_label(&[b"saber-cax-entry-v1\0", content.as_bytes()])
}

/// Digest over the canonical record body (record id through entries).
#[must_use]
pub fn record_digest_of(record: &CaxRecord) -> String {
    let mut body: Vec<u8> = b"saber-cax-record-v1\0".to_vec();
    let push = |body: &mut Vec<u8>, bytes: &[u8]| body.extend_from_slice(bytes);
    push(&mut body, record.record_id.as_bytes());
    body.push(0);
    push(&mut body, record.schema_version.as_bytes());
    body.push(0);
    push(&mut body, record.tenant.as_bytes());
    body.push(0);
    push(&mut body, record.workspace.as_bytes());
    body.push(0);
    push(&mut body, record.source.origin_uri.as_bytes());
    body.push(0);
    push(&mut body, record.source.format.as_str().as_bytes());
    body.push(0);
    push(&mut body, record.source.raw_digest.as_bytes());
    for entry in &record.entries {
        body.push(0);
        push(&mut body, entry.content_digest.as_bytes());
        body.push(0);
        let role_text = format!("{:?}", entry.role);
        push(&mut body, role_text.as_bytes());
        body.push(0);
        let occurred = entry
            .occurred_at_ms
            .map_or_else(|| "none".to_owned(), |value| format!("{value}"));
        push(&mut body, occurred.as_bytes());
    }
    sha_label(&[&body])
}

/// Stable record id derived from scope, source and format.
#[must_use]
pub fn record_id_for(tenant: &str, workspace: &str, raw_digest: &str) -> String {
    sha_label(&[
        b"saber-cax-id-v1\0",
        tenant.as_bytes(),
        workspace.as_bytes(),
        raw_digest.as_bytes(),
    ])
}

impl CaxRecord {
    /// Validate the whole record: version, shape, entry digests and the
    /// record digest chain (ADR-014).
    ///
    /// # Errors
    ///
    /// [`CaxError::UnknownVersion`], [`CaxError::Malformed`] and
    /// [`CaxError::DigestMismatch`] with deterministic codes.
    pub fn validate(&self) -> Result<(), CaxError> {
        if self.schema_version != CAX_SCHEMA_VERSION {
            return Err(CaxError::UnknownVersion);
        }
        if self.record_id.is_empty()
            || self.tenant.is_empty()
            || self.workspace.is_empty()
            || self.source.origin_uri.is_empty()
            || self.entries.is_empty()
        {
            return Err(CaxError::Malformed);
        }
        if self.record_id != record_id_for(&self.tenant, &self.workspace, &self.source.raw_digest) {
            return Err(CaxError::DigestMismatch);
        }
        for entry in &self.entries {
            if entry_digest_of(&entry.content) != entry.content_digest {
                return Err(CaxError::DigestMismatch);
            }
        }
        if record_digest_of(self) != self.record_digest {
            return Err(CaxError::DigestMismatch);
        }
        Ok(())
    }
}
