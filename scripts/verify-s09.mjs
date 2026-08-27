#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-011-context-engine-knowledge-mesh.md",
  "crates/context-engine/Cargo.toml",
  "crates/context-engine/src/lib.rs",
  "crates/context-engine/src/label.rs",
  "crates/context-engine/src/fabric.rs",
  "scripts/verify-remote-s09.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const label = text("crates/context-engine/src/label.rs");
for (const contract of [
  "pub enum TrustLevel",
  "Untrusted",
  "pub enum ScopeKind",
  "pub struct ScopeKey",
  "pub struct Provenance",
  "pub struct FreshnessPolicy",
  "pub enum SelectionReason",
  "KeywordMatch",
  "SymbolMatch",
  "StructuredMatch",
  "Pinned",
  "pub enum ExclusionReason",
  "Scope",
  "Sensitivity",
  "Freshness",
  "Revoked",
  "UserExclusion",
  "LabelForgery",
  "pub struct NutritionLabel",
  "content_digest",
  "pub struct FieldSensitivity",
  "pub enum ChunkContent",
  "pub struct KnowledgeChunk",
  "pub fn content_digest_of",
  "pub fn admit",
  "AdmissionError::Unclassified",
  "AdmissionError::DigestMismatch",
])
  check(label.includes(contract), "label-contract", contract);

const fabric = text("crates/context-engine/src/fabric.rs");
for (const contract of [
  "pub const REDACTED_MARKER",
  "pub struct QueryRequest",
  "sensitivity_ceiling",
  "include_untrusted",
  "pub struct SelectedChunk",
  "pub struct ExcludedCandidate",
  "pub struct QueryResult",
  "pub struct Explanation",
  "pub struct ContextBundle",
  "pub fn egress_request",
  "TaintKind::UntrustedSource",
  "pub struct EventRecord",
  "pub struct KnowledgeFabric",
  "pub fn admit",
  "pub fn revoke",
  "pub fn exclude",
  "pub fn inspect",
  "pub fn rebuild_indexes",
  "pub fn index_digest",
  "pub fn query",
  "pub fn explain",
  "pub fn export_bundle",
  "pub fn take_events",
  '"context.chunk_selected"',
  '"knowledge.queried"',
  '"knowledge.redacted"',
  '"context.explained"',
  '"context.source_excluded"',
  '"index.rebuilt"',
  '"retrieval.completed"',
  "foreign chunks are invisible",
  "channel queries with zero hits",
])
  check(fabric.includes(contract), "fabric-contract", contract);

const lib = text("crates/context-engine/src/lib.rs");
for (const test of [
  "nutrition_labels_are_structural_on_every_chunk",
  "unclassified_admission_fails_closed",
  "forged_labels_are_detected_at_query_time",
  "cross_scope_leakage_is_structurally_zero",
  "sensitivity_ceiling_and_query_time_redaction",
  "hybrid_channels_report_their_reasons",
  "deterministic_selection_and_explanation",
  "corrupted_indexes_rebuild_from_authoritative_chunks",
  "revocation_and_user_exclusion_apply_immediately",
  "freshness_expiry_excludes_with_reason",
  "untrusted_content_requires_explicit_admission",
  "exported_bundles_carry_taint_and_classification",
  "event_trail_uses_stable_names",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/context-engine"'), "workspace-member", "crates/context-engine");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s09.mjs"),
  "baseline-s09-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s09.mjs"), "local-s09-gate", "pnpm verify");
check(
  text("docs/adr/ADR-011-context-engine-knowledge-mesh.md").includes("Status: accepted"),
  "adr-011-status",
  "accepted",
);

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S09 verification passed with ${passes.length} checks.`);
