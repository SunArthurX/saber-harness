#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-022-remote-execution-realm.md",
  "crates/remote-realm/Cargo.toml",
  "crates/remote-realm/src/lib.rs",
  "scripts/verify-remote-s20.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const lib = text("crates/remote-realm/src/lib.rs");
for (const contract of [
  "pub enum RealmError",
  "EnvelopeTampered",
  "ResultDigestMismatch",
  "StaleSuccess",
  "pub struct PolicyEnvelope",
  "pub fn envelope_digest_of",
  "pub fn validate",
  "pub fn new",
  "pub enum RemoteTaskState",
  "Submitted",
  "Running",
  "Succeeded",
  "Failed",
  "Cancelled",
  "pub struct RemoteTask",
  "pub struct RemoteResult",
  "pub const LEASE_WINDOW_MS",
  "pub struct RealmCoordinator",
  "pub fn submit",
  "pub fn lease",
  "pub fn heartbeat",
  "pub fn reap_expired",
  "pub fn admit_result",
  "pub fn cancel",
  "pub fn artifact_digest_of",
  "pub struct AdmittedResult",
  "TaintKind::UntrustedSource",
  "never re-decide",
])
  check(lib.includes(contract), "realm-contract", contract);

for (const test of [
  "policy_envelopes_travel_and_tampering_is_detected",
  "state_machine_is_deterministic_and_refuses_skips",
  "crashed_realms_never_report_success_and_stale_success_refused",
  "results_without_matching_digests_are_refused",
  "returned_data_is_taint_labeled_for_admission",
  "remote_faults_stay_in_their_cell",
  "cancellation_propagates_deterministically",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/remote-realm"'), "workspace-member", "crates/remote-realm");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s20.mjs"),
  "baseline-s20-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s20.mjs"), "local-s20-gate", "pnpm verify");
check(text("docs/adr/ADR-022-remote-execution-realm.md").includes("Status: accepted"), "adr-022-status", "accepted");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S20 verification passed with ${passes.length} checks.`);
