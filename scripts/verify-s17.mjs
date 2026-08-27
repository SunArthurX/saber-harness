#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-019-client-key-e2ee-sync.md",
  "crates/sync-e2ee/Cargo.toml",
  "crates/sync-e2ee/src/lib.rs",
  "scripts/verify-remote-s17.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const lib = text("crates/sync-e2ee/src/lib.rs");
for (const contract of [
  "pub enum SyncError",
  "WrongKey",
  "AuthenticationFailed",
  "Rollback",
  "Revoked",
  "pub struct ObjectMetadata",
  "classification",
  "plaintext_digest",
  "pub struct SealedObject",
  "wrapped_key",
  "pub fn object_id_of",
  "pub fn seal",
  "pub struct OpenedObject",
  "pub fn open",
  "pub struct EpochLedger",
  "pub fn advance",
  "pub fn revoke_device",
  "pub fn last_seen",
  "pub fn assert_server_stream_clean",
])
  check(lib.includes(contract), "sync-contract", contract);

for (const test of [
  "seal_open_roundtrip_with_auth_metadata",
  "wrong_key_fails_closed",
  "tampered_ciphertext_fails_authentication",
  "classification_downgrade_requires_new_authentic_object",
  "anti_rollback_ledger_refuses_replay_and_old_epochs",
  "revoked_devices_cannot_return_to_pre_revocation_epochs",
  "server_visible_stream_is_zero_plaintext_and_zero_keys",
  "per_object_data_keys_differ_across_objects",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/sync-e2ee"'), "workspace-member", "crates/sync-e2ee");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s17.mjs"),
  "baseline-s17-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s17.mjs"), "local-s17-gate", "pnpm verify");
check(text("docs/adr/ADR-019-client-key-e2ee-sync.md").includes("Status: accepted"), "adr-019-status", "accepted");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S17 verification passed with ${passes.length} checks.`);
