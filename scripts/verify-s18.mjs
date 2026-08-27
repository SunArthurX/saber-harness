#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-020-contain-first-immune-core.md",
  "crates/health-supervisor/Cargo.toml",
  "crates/health-supervisor/src/lib.rs",
  "crates/health-supervisor/src/detect.rs",
  "scripts/verify-remote-s18.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const detect = text("crates/health-supervisor/src/detect.rs");
for (const contract of [
  "pub enum Severity",
  "H0LocalReflex",
  "H1CellContainment",
  "H2CrossCellDegradation",
  "H3SafeMode",
  "H4ExternalAuthority",
  "pub enum HealthDimension",
  "Integrity",
  "Budget",
  "Latency",
  "Crash",
  "Policy",
  "Contamination",
  "pub struct HealthObservation",
  "critical_boundary",
  "trust_root_involved",
  "pub struct HealthSignal",
  "pub fn classify",
  "pub fn dominant_signal",
  "no LLM participates",
])
  check(detect.includes(contract), "detect-contract", contract);

const lib = text("crates/health-supervisor/src/lib.rs");
for (const contract of [
  "pub enum Reflex",
  "RateLimit",
  "CircuitBreak",
  "BudgetSuspend",
  "Quarantine",
  "pub const REFLEX_COOLDOWN_MS",
  "pub const MAX_QUARANTINED_CELLS",
  "pub struct ReflexPlan",
  "pub enum SafeModeState",
  "Normal",
  "Active",
  "pub struct Escalation",
  "pub struct DiagnosticBundle",
  "pub struct HealthSupervisor",
  "pub fn process",
  "pub fn operator_exit_safe_mode",
  "pub fn autonomy_halted",
  "pub fn safe_mode",
  "pub fn quarantined_cells",
  "pub fn take_events",
  "pub enum SupervisorAction",
  '"safe_mode.entered"',
  '"safe_mode.exited"',
  '"incident.contained"',
  '"incident.escalated"',
  '"incident.external_help_requested"',
  '"health.signal_raised"',
  '"cell.degraded"',
  "structurally excludes",
  "ONLY an explicit operator action",
])
  check(lib.includes(contract), "supervisor-contract", contract);
check(!lib.includes("disable_policy"), "no-policy-disable-reflex", "reflexes cannot touch authority");

for (const test of [
  "detection_is_deterministic_and_llm_free",
  "critical_boundaries_fail_closed_into_safe_mode",
  "trust_root_breaks_escalate_immediately",
  "reflexes_are_bounded_and_never_touch_authority",
  "safe_mode_is_idempotent_and_operator_exit_only",
  "escalation_stops_autonomy_with_a_minimal_bundle",
  "blast_radius_bounds_escalate_instead_of_reflexing",
  "game_day_cascade_ends_bounded_and_evidence_preserved",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/health-supervisor"'), "workspace-member", "crates/health-supervisor");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s18.mjs"),
  "baseline-s18-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s18.mjs"), "local-s18-gate", "pnpm verify");
check(text("docs/adr/ADR-020-contain-first-immune-core.md").includes("Status: accepted"), "adr-020-status", "accepted");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S18 verification passed with ${passes.length} checks.`);
