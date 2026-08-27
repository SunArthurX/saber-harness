//! The permission-aware Knowledge Fabric (ADR-011).
//!
//! Scope-qualified admission, hybrid retrieval over rebuildable derived
//! indexes, query-time redaction, deterministic explanation, user exclusion,
//! immediate revocation and taint-carrying context export. The fabric is
//! pure: it records stable event names for the durable journal and performs
//! no I/O itself.

use std::collections::{BTreeMap, BTreeSet};

use saber_egress::{EgressRequest, TaintKind};
use saber_policy::DataClass;
use serde::Serialize;

pub use crate::label::ExclusionReason;
use crate::label::{
    AdmissionError, ChunkContent, KnowledgeChunk, NutritionLabel, SelectionReason, TrustLevel,
    content_digest_of,
};

/// Stable redaction marker for restricted fields.
pub const REDACTED_MARKER: &str = "[saber:redacted]";

/// One hybrid query.
#[derive(Clone, Debug)]
pub struct QueryRequest {
    /// The asking scope; foreign chunks are structurally invisible.
    pub scope: crate::label::ScopeKey,
    /// Maximum classification the asker may see.
    pub sensitivity_ceiling: DataClass,
    /// Free-text terms (tokenized matching).
    pub terms: Vec<String>,
    /// Identifier lookups (symbol channel).
    pub symbols: Vec<String>,
    /// Structured key-path filters (structured channel).
    pub key_paths: Vec<String>,
    /// Whether untrusted-provenance chunks may be included.
    pub include_untrusted: bool,
    /// Query time in Unix milliseconds (freshness evaluation).
    pub now_ms: u64,
    /// Maximum number of selections.
    pub limit: usize,
}

/// One selected chunk with its channel reason.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SelectedChunk {
    /// The selected chunk.
    pub chunk: KnowledgeChunk,
    /// Why it was selected.
    pub reason: SelectionReason,
    /// Fields redacted at query time.
    pub redacted_fields: Vec<String>,
}

/// One excluded candidate with its reason (explanation input).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExcludedCandidate {
    /// The excluded chunk id.
    pub chunk_id: String,
    /// Why it was excluded.
    pub reason: ExclusionReason,
}

/// A query result.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct QueryResult {
    /// Selected chunks in deterministic order.
    pub selections: Vec<SelectedChunk>,
    /// Excluded candidates in deterministic order.
    pub exclusions: Vec<ExcludedCandidate>,
    /// Query identifier echo for the audit trail.
    pub query_id: String,
}

/// Deterministic explanation of one result.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct Explanation {
    /// Per-selection items.
    pub selections: Vec<ExplanationItem>,
    /// Per-exclusion items.
    pub exclusions: Vec<ExcludedCandidate>,
}

/// One explanation item.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExplanationItem {
    /// Chunk id.
    pub chunk_id: String,
    /// Selection reason.
    pub reason: SelectionReason,
    /// Provenance origin.
    pub origin: String,
    /// Trust posture.
    pub trust: TrustLevel,
    /// Sensitivity.
    pub sensitivity: DataClass,
    /// Redacted field paths.
    pub redacted_fields: Vec<String>,
}

/// A taint-carrying export bundle.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ContextBundle {
    /// The selected chunks (already redacted).
    pub selections: Vec<SelectedChunk>,
    /// Taints derived from the members.
    pub taints: BTreeSet<TaintKind>,
    /// Maximum member classification.
    pub max_sensitivity: DataClass,
}

impl ContextBundle {
    /// Compose the bundle into an egress request the S06 PEP evaluates.
    #[must_use]
    pub fn egress_request(&self, host: &str, port: u16) -> EgressRequest {
        EgressRequest {
            purpose: "context-export".to_owned(),
            scheme: "https".to_owned(),
            host: host.to_owned(),
            port,
            data_class: self.max_sensitivity,
            taints: self.taints.iter().copied().collect(),
            credential_ref: None,
            payload_len: self
                .selections
                .iter()
                .map(|selected| selected.chunk.content.text_for_index().len())
                .sum::<usize>() as u64,
        }
    }
}

/// Stable event names recorded for the durable journal.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EventRecord {
    /// Stable event name.
    pub name: &'static str,
    /// Metadata-only payload (no chunk content).
    pub chunk_id: Option<String>,
}

/// The fabric itself.
#[derive(Default)]
pub struct KnowledgeFabric {
    chunks: BTreeMap<String, KnowledgeChunk>,
    revoked: BTreeSet<String>,
    user_excluded: BTreeSet<String>,
    keyword: BTreeMap<String, BTreeSet<String>>,
    symbol: BTreeMap<String, BTreeSet<String>>,
    structured: BTreeMap<String, BTreeSet<String>>,
    events: Vec<EventRecord>,
}

impl KnowledgeFabric {
    /// Admit one chunk and update the derived indexes.
    ///
    /// # Errors
    ///
    /// Mirrors [`KnowledgeChunk::admit`].
    pub fn admit(
        &mut self,
        label: NutritionLabel,
        content: ChunkContent,
    ) -> Result<String, AdmissionError> {
        let chunk = KnowledgeChunk::admit(label, content)?;
        let chunk_id = chunk.label.chunk_id.clone();
        for term in tokenize(&chunk.content.text_for_index()) {
            self.keyword
                .entry(term)
                .or_default()
                .insert(chunk_id.clone());
        }
        for symbol in chunk.content.symbols_for_index() {
            self.symbol
                .entry(symbol)
                .or_default()
                .insert(chunk_id.clone());
        }
        for path in chunk.content.key_paths() {
            self.structured
                .entry(path)
                .or_default()
                .insert(chunk_id.clone());
        }
        self.chunks.insert(chunk_id.clone(), chunk);
        Ok(chunk_id)
    }

    /// Revoke one chunk: removed from the fabric and every index at once.
    pub fn revoke(&mut self, chunk_id: &str) {
        let Some(chunk) = self.chunks.remove(chunk_id) else {
            return;
        };
        self.revoked.insert(chunk_id.to_owned());
        for term in tokenize(&chunk.content.text_for_index()) {
            remove_index_entry(&mut self.keyword, &term, chunk_id);
        }
        for symbol in chunk.content.symbols_for_index() {
            remove_index_entry(&mut self.symbol, &symbol, chunk_id);
        }
        for path in chunk.content.key_paths() {
            remove_index_entry(&mut self.structured, &path, chunk_id);
        }
        self.events.push(EventRecord {
            name: "context.source_excluded",
            chunk_id: Some(chunk_id.to_owned()),
        });
    }

    /// Exclude one source from future context by user decision.
    pub fn exclude(&mut self, chunk_id: &str) {
        self.user_excluded.insert(chunk_id.to_owned());
        self.events.push(EventRecord {
            name: "context.source_excluded",
            chunk_id: Some(chunk_id.to_owned()),
        });
    }

    /// Inspect one label.
    #[must_use]
    pub fn inspect(&self, chunk_id: &str) -> Option<&NutritionLabel> {
        self.chunks.get(chunk_id).map(|chunk| &chunk.label)
    }

    /// Rebuild every derived index from the authoritative chunks.
    pub fn rebuild_indexes(&mut self) {
        self.keyword.clear();
        self.symbol.clear();
        self.structured.clear();
        let chunks: Vec<KnowledgeChunk> = self.chunks.values().cloned().collect();
        for chunk in chunks {
            let chunk_id = chunk.label.chunk_id.clone();
            for term in tokenize(&chunk.content.text_for_index()) {
                self.keyword
                    .entry(term)
                    .or_default()
                    .insert(chunk_id.clone());
            }
            for symbol in chunk.content.symbols_for_index() {
                self.symbol
                    .entry(symbol)
                    .or_default()
                    .insert(chunk_id.clone());
            }
            for path in chunk.content.key_paths() {
                self.structured
                    .entry(path)
                    .or_default()
                    .insert(chunk_id.clone());
            }
        }
        self.events.push(EventRecord {
            name: "index.rebuilt",
            chunk_id: None,
        });
    }

    /// Test-only: swap stored content while keeping the stale label, to
    /// prove the query-time digest re-verification detects forgery.
    #[cfg(test)]
    pub fn tamper_content_for_tests(&mut self, chunk_id: &str, content: ChunkContent) {
        if let Some(chunk) = self.chunks.get_mut(chunk_id) {
            chunk.content = content;
        }
    }

    /// Test-only: corrupt the keyword channel to prove rebuild recovery.
    #[cfg(test)]
    pub fn corrupt_keyword_index_for_tests(&mut self, term: &str, chunk_id: &str) {
        self.keyword
            .entry(term.to_owned())
            .or_default()
            .insert(chunk_id.to_owned());
    }

    /// Digest of the derived indexes (corruption detection).
    #[must_use]
    pub fn index_digest(&self) -> String {
        let mut input = String::new();
        for (term, ids) in &self.keyword {
            input.push_str(term);
            input.push('\0');
            input.push_str(&ids.iter().cloned().collect::<Vec<_>>().join(","));
            input.push('\0');
        }
        for (symbol, ids) in &self.symbol {
            input.push_str(symbol);
            input.push('\0');
            input.push_str(&ids.iter().cloned().collect::<Vec<_>>().join(","));
            input.push('\0');
        }
        for (path, ids) in &self.structured {
            input.push_str(path);
            input.push('\0');
            input.push_str(&ids.iter().cloned().collect::<Vec<_>>().join(","));
            input.push('\0');
        }
        saber_policy::sha256_label(&[input.as_bytes()])
    }

    /// Execute one permission-aware hybrid query.
    #[allow(clippy::too_many_lines)]
    #[must_use]
    pub fn query(&mut self, request: &QueryRequest, query_id: &str) -> QueryResult {
        let mut exclusions: BTreeMap<String, ExclusionReason> = BTreeMap::new();
        let mut candidates: BTreeMap<String, Vec<SelectionReason>> = BTreeMap::new();

        // Candidate collection happens over indexes, but every candidate is
        // re-verified against the authoritative chunk before selection.
        let mut index_hits: BTreeSet<String> = BTreeSet::new();
        for term in &request.terms {
            if let Some(ids) = self.keyword.get(&term.to_ascii_lowercase()) {
                index_hits.extend(ids.iter().cloned());
            }
        }
        for symbol in &request.symbols {
            if let Some(ids) = self.symbol.get(symbol) {
                index_hits.extend(ids.iter().cloned());
            }
        }
        for path in &request.key_paths {
            if let Some(ids) = self.structured.get(path) {
                index_hits.extend(ids.iter().cloned());
            }
        }
        let has_channels = !request.terms.is_empty()
            || !request.symbols.is_empty()
            || !request.key_paths.is_empty();
        if index_hits.is_empty() && !has_channels {
            // Channel-less queries scan the authoritative map so pinned
            // context remains reachable; channel queries with zero hits
            // return nothing rather than pinning unrelated content.
            index_hits.extend(self.chunks.keys().cloned());
        }

        for chunk_id in index_hits {
            let Some(chunk) = self.chunks.get(&chunk_id) else {
                continue;
            };
            // Structural scope gate first: foreign chunks are invisible.
            if chunk.label.scope.tenant != request.scope.tenant
                || chunk.label.scope.workspace != request.scope.workspace
            {
                exclusions.insert(chunk_id, ExclusionReason::Scope);
                continue;
            }
            if self.revoked.contains(&chunk_id) {
                exclusions.insert(chunk_id, ExclusionReason::Revoked);
                continue;
            }
            if self.user_excluded.contains(&chunk_id) {
                exclusions.insert(chunk_id, ExclusionReason::UserExclusion);
                continue;
            }
            if chunk.label.sensitivity > request.sensitivity_ceiling {
                exclusions.insert(chunk_id, ExclusionReason::Sensitivity);
                continue;
            }
            if chunk
                .label
                .freshness
                .expires_at_ms
                .is_some_and(|expires| expires <= request.now_ms)
            {
                exclusions.insert(chunk_id, ExclusionReason::Freshness);
                continue;
            }
            if !request.include_untrusted && chunk.label.provenance.trust == TrustLevel::Untrusted {
                exclusions.insert(chunk_id, ExclusionReason::UntrustedNotAdmitted);
                continue;
            }
            // Digest re-verification: a forged label cannot ride an index.
            if content_digest_of(&chunk.content) != chunk.label.content_digest {
                exclusions.insert(chunk_id, ExclusionReason::LabelForgery);
                continue;
            }

            let mut reasons = Vec::new();
            for term in &request.terms {
                if tokenize(&chunk.content.text_for_index()).contains(&term.to_ascii_lowercase()) {
                    reasons.push(SelectionReason::KeywordMatch {
                        term: term.to_ascii_lowercase(),
                    });
                }
            }
            for symbol in &request.symbols {
                if chunk
                    .content
                    .symbols_for_index()
                    .iter()
                    .any(|s| s == symbol)
                {
                    reasons.push(SelectionReason::SymbolMatch {
                        symbol: symbol.clone(),
                    });
                }
            }
            for path in &request.key_paths {
                if chunk.content.key_paths().iter().any(|p| p == path) {
                    reasons.push(SelectionReason::StructuredMatch { path: path.clone() });
                }
            }
            if reasons.is_empty() {
                reasons.push(SelectionReason::Pinned);
            }
            candidates.insert(chunk_id, reasons);
        }

        // Deterministic ordering: channel count descending, then chunk id.
        let mut ranked: Vec<(String, Vec<SelectionReason>)> = candidates.into_iter().collect();
        ranked.sort_by(|left, right| {
            right
                .1
                .len()
                .cmp(&left.1.len())
                .then_with(|| left.0.cmp(&right.0))
        });

        let mut selections = Vec::new();
        for (chunk_id, reasons) in ranked.into_iter().take(request.limit) {
            let chunk = self
                .chunks
                .get(&chunk_id)
                .cloned()
                .unwrap_or_else(|| unreachable!("ranked candidates come from the fabric"));
            let mut redacted_fields = Vec::new();
            let content = redact_chunk(
                &chunk.content,
                request.sensitivity_ceiling,
                &mut redacted_fields,
            );
            if !redacted_fields.is_empty() {
                self.events.push(EventRecord {
                    name: "knowledge.redacted",
                    chunk_id: Some(chunk_id.clone()),
                });
            }
            selections.push(SelectedChunk {
                chunk: KnowledgeChunk {
                    label: chunk.label.clone(),
                    content,
                },
                reason: reasons[0].clone(),
                redacted_fields,
            });
            self.events.push(EventRecord {
                name: "context.chunk_selected",
                chunk_id: Some(chunk_id),
            });
        }
        self.events.push(EventRecord {
            name: "retrieval.completed",
            chunk_id: None,
        });
        self.events.push(EventRecord {
            name: "knowledge.queried",
            chunk_id: None,
        });
        QueryResult {
            selections,
            exclusions: exclusions
                .into_iter()
                .map(|(chunk_id, reason)| ExcludedCandidate { chunk_id, reason })
                .collect(),
            query_id: query_id.to_owned(),
        }
    }

    /// Deterministic explanation of one result.
    pub fn explain(&mut self, result: &QueryResult) -> Explanation {
        self.events.push(EventRecord {
            name: "context.explained",
            chunk_id: None,
        });
        Explanation {
            selections: result
                .selections
                .iter()
                .map(|selected| ExplanationItem {
                    chunk_id: selected.chunk.label.chunk_id.clone(),
                    reason: selected.reason.clone(),
                    origin: selected.chunk.label.provenance.origin.clone(),
                    trust: selected.chunk.label.provenance.trust,
                    sensitivity: selected.chunk.label.sensitivity,
                    redacted_fields: selected.redacted_fields.clone(),
                })
                .collect(),
            exclusions: result.exclusions.clone(),
        }
    }

    /// Export a result as a taint-carrying bundle.
    #[must_use]
    pub fn export_bundle(&self, result: &QueryResult) -> ContextBundle {
        let mut taints = BTreeSet::new();
        let mut max_sensitivity = DataClass::Public;
        for selected in &result.selections {
            if selected.chunk.label.provenance.trust == TrustLevel::Untrusted {
                taints.insert(TaintKind::UntrustedSource);
            }
            if selected.chunk.label.sensitivity >= DataClass::Confidential {
                max_sensitivity = max_sensitivity.max(DataClass::Confidential);
            } else {
                max_sensitivity = max_sensitivity.max(selected.chunk.label.sensitivity);
            }
        }
        ContextBundle {
            selections: result.selections.clone(),
            taints,
            max_sensitivity,
        }
    }

    /// Drain the recorded event trail for durable journaling.
    #[must_use]
    pub fn take_events(&mut self) -> Vec<EventRecord> {
        std::mem::take(&mut self.events)
    }

    /// Number of admitted chunks.
    #[must_use]
    pub fn len(&self) -> usize {
        self.chunks.len()
    }

    /// Whether the fabric is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }
}

fn redact_chunk(
    content: &ChunkContent,
    ceiling: DataClass,
    redacted_fields: &mut Vec<String>,
) -> ChunkContent {
    let ChunkContent::Structured { value, fields } = content else {
        return content.clone();
    };
    let mut value = value.clone();
    for (path, class) in &fields.restricted_fields {
        if *class > ceiling && redact_path(&mut value, path) {
            redacted_fields.push(path.clone());
        }
    }
    ChunkContent::Structured {
        value,
        fields: fields.clone(),
    }
}

fn redact_path(value: &mut serde_json::Value, path: &str) -> bool {
    let segments: Vec<&str> = path.split('.').collect();
    let mut current = value;
    for (index, segment) in segments.iter().enumerate() {
        if index == segments.len() - 1 {
            if current.get(segment).is_some() {
                current[segment] = serde_json::Value::String(REDACTED_MARKER.to_owned());
                return true;
            }
            return false;
        }
        let Some(child) = current.get_mut(*segment) else {
            return false;
        };
        current = child;
    }
    false
}

fn remove_index_entry(index: &mut BTreeMap<String, BTreeSet<String>>, key: &str, chunk_id: &str) {
    if let Some(ids) = index.get_mut(key) {
        ids.remove(chunk_id);
        if ids.is_empty() {
            index.remove(key);
        }
    }
}

fn tokenize(text: &str) -> Vec<String> {
    let mut terms: Vec<String> = text
        .to_ascii_lowercase()
        .split(|character: char| !(character.is_alphanumeric() || character == '_'))
        .filter(|term| term.len() >= 2)
        .map(ToString::to_string)
        .collect();
    terms.sort();
    terms.dedup();
    terms
}
