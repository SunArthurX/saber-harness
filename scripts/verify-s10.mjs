#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-012-memory-authority.md",
  "crates/memory-authority/Cargo.toml",
  "crates/memory-authority/src/lib.rs",
  "crates/memory-authority/src/entry.rs",
  "crates/memory-authority/src/authority.rs",
  "scripts/verify-remote-s10.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const entry = text("crates/memory-authority/src/entry.rs");
for (const contract of [
  "pub enum MemoryKind",
  "Fact",
  "Preference",
  "Rule",
  "Procedure",
  "pub enum TrustLevel",
  "Untrusted",
  "pub enum MemoryState",
  "Candidate",
  "Promoted",
  "Stale",
  "Revoked",
  "pub struct MemoryProvenance",
  "pub struct MemoryFreshness",
  "pub enum ReviewAuthority",
  "HumanReview",
  "ExplicitPolicy",
  "pub struct MemoryEntry",
  "pub struct RevisionEntry",
  "conflicted_with",
  "pub fn entry_id_for",
])
  check(entry.includes(contract), "entry-contract", contract);
check(!entry.includes("RuntimeEvidence"), "no-runtime-evidence-authority", "runs cannot construct promotion authority");

const authority = text("crates/memory-authority/src/authority.rs");
for (const contract of [
  "pub enum AdmissionError",
  "CrossWorkspace",
  "DuplicateCandidate",
  "Unclassified",
  "pub enum PromoteError",
  "NotCandidate",
  "pub struct MemoryProposal",
  "pub struct MemoryQuery",
  "sensitivity_ceiling",
  "pub struct MemoryView",
  "pub struct EventRecord",
  "pub struct MemoryAuthority",
  "pub fn new",
  "pub const fn write_sequence",
  "pub fn propose",
  "pub fn promote",
  "pub fn revoke",
  "pub fn query",
  "pub fn history",
  "pub fn take_events",
  "MemoryState::Candidate",
  "MemoryState::Promoted",
  "MemoryState::Stale",
  "MemoryState::Revoked",
  "superseded_at_ms",
  '"memory.proposed"',
  '"memory.promoted"',
  '"memory.revoked"',
  '"memory.stale"',
])
  check(authority.includes(contract), "authority-contract", contract);

const lib = text("crates/memory-authority/src/lib.rs");
for (const test of [
  "candidates_never_auto_promote",
  "poisoned_candidate_requires_explicit_review",
  "contradicting_promotions_create_linked_revisions",
  "ttl_expiry_surfaces_stale_not_truth",
  "revocation_is_immediate_and_auditable",
  "cross_workspace_injection_fails_closed",
  "unclassified_and_malformed_proposals_fail",
  "sensitivity_ceiling_governs_queries",
  "concurrent_writers_serialize_without_lost_updates",
  "identical_inputs_produce_identical_outcomes",
  "duplicate_pending_candidates_are_rejected",
  "event_trail_uses_stable_names",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/memory-authority"'), "workspace-member", "crates/memory-authority");
check(
  text("crates/memory-authority/src/lib.rs").includes("revisions accumulate, nothing overwritten"),
  "revision-invariant-test",
  "history preserved",
);
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s10.mjs"),
  "baseline-s10-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s10.mjs"), "local-s10-gate", "pnpm verify");
check(text("docs/adr/ADR-012-memory-authority.md").includes("Status: accepted"), "adr-012-status", "accepted");
check(text("docs/execution/DECISIONS.md").includes("DEC-0013"), "dec-0013-recorded", "module alignment");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S10 verification passed with ${passes.length} checks.`);
