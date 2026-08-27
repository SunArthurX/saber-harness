//! Nutrition labels: provenance, scope, sensitivity, freshness and selection
//! reason on every chunk entering model context (ADR-011, PC-04).

use std::collections::BTreeMap;

use saber_policy::DataClass;
use serde::{Deserialize, Serialize};

/// Trust posture of a source (INV-02: untrusted by default for imports).
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    /// Verified first-party content.
    Trusted,
    /// Imported from an external system with intact provenance.
    Imported,
    /// Untrusted evidence: never an instruction, never promotable silently.
    Untrusted,
}

/// Knowledge scope inside one workspace.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeKind {
    /// Source-code files.
    Code,
    /// Conversation transcripts.
    Conversation,
    /// Documents and notes.
    Document,
    /// Governed memory entries.
    Memory,
    /// Decisions and rules.
    Decision,
}

/// Tenant/workspace-qualified scope key. Every chunk and every query carry
/// one; the fabric never mixes them.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct ScopeKey {
    /// Owning tenant.
    pub tenant: String,
    /// Owning workspace.
    pub workspace: String,
    /// Scope kind inside the workspace.
    pub kind: ScopeKind,
}

/// Where a chunk came from.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Provenance {
    /// Stable origin URI or identifier.
    pub origin: String,
    /// Trust posture at admission.
    pub trust: TrustLevel,
    /// Import/admission time in Unix milliseconds.
    pub imported_at_ms: u64,
}

/// Freshness contract of a chunk.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct FreshnessPolicy {
    /// Content creation time in Unix milliseconds.
    pub created_at_ms: u64,
    /// Absolute expiry; `None` means no staleness bound.
    pub expires_at_ms: Option<u64>,
}

/// Why a chunk was selected into context.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionReason {
    /// Tokenized text matched a query term.
    KeywordMatch {
        /// The matching term.
        term: String,
    },
    /// An extracted identifier matched a query symbol.
    SymbolMatch {
        /// The matching symbol.
        symbol: String,
    },
    /// A structured key path matched a filter.
    StructuredMatch {
        /// The matching key path.
        path: String,
    },
    /// Selected despite no channel match (for example pinned context).
    Pinned,
}

/// Why a candidate was excluded from a result.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExclusionReason {
    /// Different scope.
    Scope,
    /// Above the asker's classification ceiling.
    Sensitivity,
    /// Past the freshness expiry.
    Freshness,
    /// Revoked outright.
    Revoked,
    /// Excluded by user decision.
    UserExclusion,
    /// Label digest mismatch: possible forgery.
    LabelForgery,
    /// Untrusted content not admitted by this query.
    UntrustedNotAdmitted,
}

/// The nutrition label every chunk must carry.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NutritionLabel {
    /// Stable chunk identifier.
    pub chunk_id: String,
    /// Owning scope.
    pub scope: ScopeKey,
    /// Data classification of the content.
    pub sensitivity: DataClass,
    /// Origin and trust posture.
    pub provenance: Provenance,
    /// Freshness contract.
    pub freshness: FreshnessPolicy,
    /// Digest of the canonical chunk content, verified at query time.
    pub content_digest: String,
}

/// Field-level sensitivity inside a structured chunk.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct FieldSensitivity {
    /// Key path (dot separated) to classification above the chunk baseline.
    pub restricted_fields: BTreeMap<String, DataClass>,
}

/// Typed chunk content.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "content", rename_all = "snake_case")]
pub enum ChunkContent {
    /// Plain text.
    Text {
        /// The text.
        text: String,
    },
    /// Source code with extracted symbols.
    Code {
        /// Workspace-relative path.
        path: String,
        /// Language tag.
        language: String,
        /// The code text.
        text: String,
    },
    /// Structured JSON with field-level sensitivity markers.
    Structured {
        /// The JSON value.
        value: serde_json::Value,
        /// Field sensitivity overrides.
        fields: FieldSensitivity,
    },
}

impl ChunkContent {
    /// The text this content contributes to keyword matching.
    #[must_use]
    pub fn text_for_index(&self) -> String {
        match self {
            Self::Text { text } => text.clone(),
            Self::Code { text, path, .. } => format!("{path}\n{text}"),
            Self::Structured { value, .. } => value.to_string(),
        }
    }

    /// Identifiers this content contributes to the symbol index.
    #[must_use]
    pub fn symbols_for_index(&self) -> Vec<String> {
        let source = match self {
            Self::Code { text, .. } | Self::Text { text } => text.clone(),
            Self::Structured { .. } => String::new(),
        };
        let mut symbols: Vec<String> = source
            .split(|character: char| !(character.is_alphanumeric() || character == '_'))
            .filter(|token| {
                token.len() >= 3 && token.chars().next().is_some_and(char::is_alphabetic)
            })
            .map(ToString::to_string)
            .collect();
        symbols.sort();
        symbols.dedup();
        symbols
    }

    /// Dot-separated key paths of a structured chunk.
    #[must_use]
    pub fn key_paths(&self) -> Vec<String> {
        let mut paths = Vec::new();
        if let Self::Structured { value, .. } = self {
            walk_paths(value, "", &mut paths);
        }
        paths.sort();
        paths.dedup();
        paths
    }
}

fn walk_paths(value: &serde_json::Value, prefix: &str, paths: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, inner) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                paths.push(path.clone());
                walk_paths(inner, &path, paths);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                walk_paths(item, prefix, paths);
            }
        }
        _ => {}
    }
}

/// One admitted knowledge chunk.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct KnowledgeChunk {
    /// The mandatory label.
    pub label: NutritionLabel,
    /// The typed content.
    pub content: ChunkContent,
}

/// Stable `sha256:<64 hex>` of canonical chunk content.
#[must_use]
pub fn content_digest_of(content: &ChunkContent) -> String {
    let encoded = serde_json::to_vec(content).unwrap_or_default();
    saber_policy::sha256_label(&[b"saber-chunk-v1\0", &encoded])
}

/// Admission failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdmissionError {
    /// The label omitted classification or origin.
    Unclassified,
    /// The label digest does not match the content.
    DigestMismatch,
    /// The chunk id or scope was malformed.
    Malformed,
}

impl std::fmt::Display for AdmissionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Unclassified => "unclassified",
            Self::DigestMismatch => "digest_mismatch",
            Self::Malformed => "malformed",
        })
    }
}

impl std::error::Error for AdmissionError {}

impl KnowledgeChunk {
    /// Admit a chunk under a complete, digest-verified label. Imported or
    /// unknown sources must be labeled `Untrusted`/`Imported` by the caller;
    /// admission itself fails closed on missing classification or origin.
    ///
    /// # Errors
    ///
    /// [`AdmissionError::Unclassified`] without explicit sensitivity or
    /// origin; [`AdmissionError::DigestMismatch`] when the label was
    /// manufactured for different content.
    pub fn admit(label: NutritionLabel, content: ChunkContent) -> Result<Self, AdmissionError> {
        if label.chunk_id.is_empty()
            || label.provenance.origin.is_empty()
            || label.scope.tenant.is_empty()
            || label.scope.workspace.is_empty()
        {
            return Err(AdmissionError::Unclassified);
        }
        if !label.content_digest.starts_with("sha256:") || label.content_digest.len() != 71 {
            return Err(AdmissionError::Malformed);
        }
        if content_digest_of(&content) != label.content_digest {
            return Err(AdmissionError::DigestMismatch);
        }
        Ok(Self { label, content })
    }
}
