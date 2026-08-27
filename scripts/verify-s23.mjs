#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-025-beta-slo-and-feedback.md",
  "crates/beta-slo/Cargo.toml",
  "crates/beta-slo/src/lib.rs",
  "scripts/verify-remote-s23.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const lib = text("crates/beta-slo/src/lib.rs");
for (const contract of [
  "pub enum SloError",
  "BudgetExceeded",
  "pub enum SloDimension",
  "StartupMs",
  "MemoryKb",
  "TaskLatencyMs",
  "CiTimeMs",
  "pub struct SloBudget",
  "pub struct SloMeasurement",
  "pub fn assert_budgets",
  "pub fn deterministic_measurements",
  "pub struct TelemetryEvent",
  "pub struct Telemetry",
  "pub fn set_enabled",
  "pub fn record",
  "pub fn drain",
  "pub fn telemetry_canary",
  "pub struct FeedbackIntake",
  "pub struct EvolutionProposalDraft",
  "pub fn intake_feedback",
  "metadata-only",
  "never a promotion",
])
  check(lib.includes(contract), "beta-contract", contract);

for (const test of [
  "budgets_are_contracts_and_regressions_fail",
  "benchmarks_are_deterministic",
  "telemetry_is_opt_in_and_metadata_only",
  "feedback_becomes_candidates_only",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/beta-slo"'), "workspace-member", "crates/beta-slo");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s23.mjs"),
  "baseline-s23-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s23.mjs"), "local-s23-gate", "pnpm verify");
check(text("docs/adr/ADR-025-beta-slo-and-feedback.md").includes("Status: accepted"), "adr-025-status", "accepted");
check(text("package.json").includes("acceptance:new-machine"), "onboarding-command", "single-command bootstrap");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S23 verification passed with ${passes.length} checks.`);
