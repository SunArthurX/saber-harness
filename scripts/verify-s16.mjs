#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-018-isolated-code-capsules.md",
  "crates/code-capsule/Cargo.toml",
  "crates/code-capsule/src/lib.rs",
  "crates/code-capsule/src/capsule.rs",
  "crates/code-capsule/src/registry.rs",
  "scripts/verify-remote-s16.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const capsule = text("crates/code-capsule/src/capsule.rs");
for (const contract of [
  'pub const CAPSULE_SCHEMA_VERSION: &str = "1.0.0"',
  "pub struct DependencyLock",
  "pub struct CodeCapsule",
  "source_digest",
  "dependencies",
  "grants",
  "realm",
  "budget",
  "capsule_digest",
  "pub enum CapsuleError",
  "DigestMismatch",
  "Escalation",
  "NotPromoted",
  "UndeclaredGrant",
  "UndeclaredDependency",
  "BudgetExhausted",
  "pub fn source_digest_of",
  "pub fn capsule_digest_of",
  "pub fn capsule_id_of",
  "pub fn validate",
  "pub fn grants_within",
])
  check(capsule.includes(contract), "capsule-contract", contract);

const registry = text("crates/code-capsule/src/registry.rs");
for (const contract of [
  "pub struct CapsuleRegistry",
  "pub fn admit",
  "pub fn evaluate",
  "pub fn promote",
  "pub fn authorize_execution",
  "pub fn consume_budget",
  "pub fn rollback",
  "pub fn active_version",
  "pub fn history",
  "pub struct ExecutionAuthorization",
  "pub fn plan_for_authorization",
  "EvolutionKind::Code",
  "grants_within",
  "CandidateState::Promoted",
  "nothing executes on any",
])
  check(registry.includes(contract), "registry-contract", contract);

const lib = text("crates/code-capsule/src/lib.rs");
for (const test of [
  "admission_requires_the_exact_source_digest",
  "unpromoted_capsules_never_execute",
  "undeclared_grants_and_dependencies_fail_closed",
  "budget_exhaustion_terminates_eligibility",
  "grants_never_widen_across_versions_and_history_rolls_back",
  "malformed_locks_and_versions_fail_admission",
  "authorization_builds_a_realm_bound_plan",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

const evolution = text("crates/evolution/src/candidate.rs");
check(evolution.includes("Code,"), "evolution-code-kind", "EvolutionKind::Code exists");

check(text("Cargo.toml").includes('"crates/code-capsule"'), "workspace-member", "crates/code-capsule");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s16.mjs"),
  "baseline-s16-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s16.mjs"), "local-s16-gate", "pnpm verify");
check(text("docs/adr/ADR-018-isolated-code-capsules.md").includes("Status: accepted"), "adr-018-status", "accepted");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S16 verification passed with ${passes.length} checks.`);
