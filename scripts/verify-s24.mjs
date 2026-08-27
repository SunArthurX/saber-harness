#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-026-production-gate.md",
  "crates/production-gate/Cargo.toml",
  "crates/production-gate/src/lib.rs",
  "scripts/verify-remote-s24.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const lib = text("crates/production-gate/src/lib.rs");
for (const contract of [
  "pub enum GateError",
  "InvariantFailed",
  "pub enum InvariantFamily",
  "ContractsPresent",
  "VerifiersChained",
  "TagsResolve",
  "HostedGatesGreen",
  "WorkspaceHygiene",
  "AdrCoverage",
  "EvolutionBoundary",
  "ThreatCoverage",
  "ReportHygiene",
  "pub struct GateInput",
  "pub struct ReadinessReport",
  "pub enum ReadinessVerdict",
  "pub struct FamilyResult",
  "pub struct InvariantFinding",
  "pub struct ContractDescriptor",
  "pub struct VerifierDescriptor",
  "pub struct TagDescriptor",
  "pub struct HostedGateDescriptor",
  "pub struct WorkspaceMemberDescriptor",
  "pub struct AdrDescriptor",
  "pub struct EvolutionSurfaceDescriptor",
  "pub struct ThreatCoverageDescriptor",
  "pub fn evaluate_gate",
  "pub fn assert_ready",
  "pub fn assert_no_autonomous_e6_e7",
  "pub fn threat_register_baseline",
  "pub fn assert_threat_coverage",
  "pub fn readiness_report_canary",
  "FORBIDDEN_AUTONOMY_MARKERS",
  "determinism_digest",
  "TM-01",
  "TM-16",
  "metadata-only",
  "proposal-only",
])
  check(lib.includes(contract), "gate-contract", contract);

for (const test of [
  "healthy_checklist_is_ready_and_metadata_only",
  "missing_contract_fails_the_gate",
  "missing_verifier_or_tag_fails_the_gate",
  "stale_member_or_missing_adr_fails",
  "gate_is_deterministic_across_runs",
  "gate_over_nothing_is_malformed",
  "every_threat_entry_maps_to_control_and_test",
  "no_autonomous_e6_e7_path_exists",
  "readiness_report_is_metadata_only",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/production-gate"'), "workspace-member", "crates/production-gate");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s24.mjs"),
  "baseline-s24-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s24.mjs"), "local-s24-gate", "pnpm verify");
check(text("docs/adr/ADR-026-production-gate.md").includes("Status: accepted"), "adr-026-status", "accepted");
check(text("package.json").includes("acceptance:new-machine"), "onboarding-command", "single-command bootstrap");

const threatModel = text("docs/security/THREAT-MODEL-v0.md");
for (let index = 1; index <= 16; index += 1) {
  const id = `TM-${String(index).padStart(2, "0")}`;
  check(threatModel.includes(`| ${id} |`), "threat-register-entry", id);
  check(lib.includes(`id: "${id}"`), "threat-baseline-mapping", id);
}

// E6/E7 structural boundary scan: no forbidden autonomy marker may occur
// anywhere in the tracked source surface. The vocabulary definitions in
// the gate crate and this scanner are the control itself and are excluded.
const FORBIDDEN_MARKERS = [
  "auto_merge",
  "self_approve",
  "autonomous_promote",
  "merge_without_review",
  "unreviewed_merge",
  "e7_autonomous_allow",
];
const EXEMPT = new Set(["crates/production-gate/src/lib.rs", "scripts/verify-s24.mjs"]);
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((path) => /\.(rs|ts|mjs|js|mts|cts)$/.test(path) && !EXEMPT.has(path));
check(tracked.length > 0, "surface-scan-populated", `${tracked.length} tracked source files`);
for (const path of tracked) {
  let source;
  try {
    source = readFileSync(join(root, path), "utf8");
  } catch {
    continue;
  }
  const lowered = source.toLowerCase();
  for (const marker of FORBIDDEN_MARKERS) {
    check(!lowered.includes(marker), "no-autonomous-e6-e7", `${path}:${marker}`);
  }
}

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S24 verification passed with ${passes.length} checks.`);
