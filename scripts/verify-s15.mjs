#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-017-evolution-workshop.md",
  "crates/evolution/Cargo.toml",
  "crates/evolution/src/lib.rs",
  "crates/evolution/src/candidate.rs",
  "crates/evolution/src/workshop.rs",
  "scripts/verify-remote-s15.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const candidate = text("crates/evolution/src/candidate.rs");
for (const contract of [
  "pub enum EvolutionKind",
  "Skill",
  "Memory",
  "Rule",
  "Workflow",
  "pub enum CandidateState",
  "Proposed",
  "Quarantined",
  "Evaluated",
  "Promoted",
  "Rejected",
  "Revoked",
  "pub struct CandidateProvenance",
  "source_event_id",
  "pub struct EvolutionCandidate",
  "payload_digest",
  "pub enum WorkshopError",
  "IllegalTransition",
  "TamperedPayload",
  "EvaluationFailed",
  "pub struct EvaluationRecord",
  "pub struct PromotionRecord",
  "promotion_digest",
  "pub fn payload_digest_of",
  "pub fn candidate_id_of",
  "pub fn promotion_digest_of",
])
  check(candidate.includes(contract), "candidate-contract", contract);

const workshop = text("crates/evolution/src/workshop.rs");
for (const contract of [
  "pub struct EvolutionWorkshop",
  "pub fn propose",
  "pub fn quarantine",
  "pub fn evaluate",
  "pub fn promote",
  "pub fn reject",
  "pub fn revoke",
  "pub fn active",
  "pub fn candidate",
  "pub fn evaluation",
  "pub fn revoked_ids",
  "Digest re-verification before every transition",
])
  check(workshop.includes(contract), "workshop-contract", contract);
check(
  !workshop.includes("RuntimeEvidence") && !candidate.includes("RuntimeEvidence"),
  "no-runtime-authority",
  "no runtime-evidence promotion authority exists",
);

const lib = text("crates/evolution/src/lib.rs");
for (const test of [
  "lifecycle_states_never_skip",
  "evaluation_failure_blocks_promotion",
  "no_runtime_auto_promotion_path_exists",
  "poisoned_evidence_promotes_only_through_explicit_review",
  "tampered_payload_fails_the_digest_chain",
  "revoked_promotions_disappear_immediately",
  "provenance_survives_and_deterministic_records",
  "malformed_proposals_are_refused",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/evolution"'), "workspace-member", "crates/evolution");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s15.mjs"),
  "baseline-s15-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s15.mjs"), "local-s15-gate", "pnpm verify");
check(text("docs/adr/ADR-017-evolution-workshop.md").includes("Status: accepted"), "adr-017-status", "accepted");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S15 verification passed with ${passes.length} checks.`);
