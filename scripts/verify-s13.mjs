#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-015-resumption-capsule.md",
  "crates/resumption/Cargo.toml",
  "crates/resumption/src/lib.rs",
  "crates/resumption/src/capsule.rs",
  "crates/resumption/src/verify.rs",
  "scripts/verify-remote-s13.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const capsule = text("crates/resumption/src/capsule.rs");
for (const contract of [
  'pub const CAPSULE_SCHEMA_VERSION: &str = "1.0.0"',
  "pub struct TaskLink",
  "pub struct ArtifactRef",
  "pub struct ResumptionCapsule",
  "workspace_fingerprint",
  "capsule_digest",
  "pub enum CapsuleError",
  "UnknownVersion",
  "DigestMismatch",
  "CrossWorkspace",
  "pub fn digest_of",
  "pub fn fingerprint_of_inventory",
  "pub fn capsule_id_for",
  "pub fn capsule_digest_of",
  "pub fn validate",
])
  check(capsule.includes(contract), "capsule-contract", contract);

const verify = text("crates/resumption/src/verify.rs");
for (const contract of [
  "pub struct CapsuleFacts",
  "refuses missing facts",
  "pub fn capsule_from_facts",
  "pub enum DriftItem",
  "ArtifactMissing",
  "ArtifactMutated",
  "FingerprintChanged",
  "pub enum VerificationState",
  "Ready",
  "NeedsReconcile",
  "pub struct CapsuleVerification",
  "pub struct PresentEnvironment",
  "pub fn verify_capsule",
  "pub struct Continuation",
  "pub fn continue_from",
  "pub fn artifact_digest_of",
])
  check(verify.includes(contract), "verify-contract", contract);

const lib = text("crates/resumption/src/lib.rs");
for (const test of [
  "capsule_creation_binds_facts_into_a_digest_chain",
  "creation_refuses_missing_facts",
  "tampered_capsules_fail_closed_anywhere",
  "unknown_versions_fail_closed",
  "mutated_or_missing_artifacts_surface_reconcile",
  "environment_drift_surfaces_reconcile_not_silent_continue",
  "ready_environment_continues_with_verbatim_lineage",
  "cross_workspace_injection_is_denied",
  "consumers_reverify_without_producer_trust",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/resumption"'), "workspace-member", "crates/resumption");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s13.mjs"),
  "baseline-s13-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s13.mjs"), "local-s13-gate", "pnpm verify");
check(text("docs/adr/ADR-015-resumption-capsule.md").includes("Status: accepted"), "adr-015-status", "accepted");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S13 verification passed with ${passes.length} checks.`);
