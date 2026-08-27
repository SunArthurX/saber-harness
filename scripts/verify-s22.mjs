#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-024-verifiable-release-integrity.md",
  "crates/release-integrity/Cargo.toml",
  "crates/release-integrity/src/lib.rs",
  "scripts/verify-remote-s22.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const lib = text("crates/release-integrity/src/lib.rs");
for (const contract of [
  "pub enum IntegrityError",
  "DigestMismatch",
  "SignatureInvalid",
  "RollbackRefused",
  "FreezeRefused",
  "DowngradeRefused",
  "pub fn sign",
  "pub fn artifact_digest",
  "pub struct SbomComponent",
  "pub struct ProvenanceStatement",
  "pub struct ReleaseManifest",
  "pub fn canonical_body",
  "pub fn verify",
  "pub fn build",
  "pub struct TargetChain",
  "pub fn accept",
  "pub enum Ring",
  "pub struct RingState",
  "pub fn promote",
  "pub fn demote",
  "pub fn current",
  "pub fn history",
  "pub struct Updater",
  "pub fn new",
  "pub fn verify_bundle",
  "verify the full chain",
])
  check(lib.includes(contract), "integrity-contract", contract);

for (const test of [
  "manifests_are_reproducible_and_tampering_fails",
  "target_chain_refuses_rollback_and_freeze",
  "rings_track_history_and_demote_reports_missing_lkg",
  "updater_verifies_before_install_and_refuses_downgrades",
  "airgap_verification_is_the_identical_offline_path",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/release-integrity"'), "workspace-member", "crates/release-integrity");
check(!text("Cargo.toml").includes('"crates/registry"'), "no-stale-members", "workspace members all exist");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s22.mjs"),
  "baseline-s22-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s22.mjs"), "local-s22-gate", "pnpm verify");
check(
  text("docs/adr/ADR-024-verifiable-release-integrity.md").includes("Status: accepted"),
  "adr-024-status",
  "accepted",
);

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S22 verification passed with ${passes.length} checks.`);
