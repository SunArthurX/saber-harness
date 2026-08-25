#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "crates/event-store/Cargo.toml",
  "crates/event-store/src/lib.rs",
  "crates/event-store/src/encrypted_blob.rs",
  "crates/event-store/src/key_custody.rs",
  "scripts/verify-remote-s04.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const manifest = text("crates/event-store/Cargo.toml");
for (const dependency of [
  'chacha20poly1305 = { version = "=0.11.0"',
  'getrandom = "=0.4.3"',
  'keyring = "=4.1.6"',
  'rusqlite = { version = "=0.40.2"',
  'tempfile = "=3.27.0"',
  'zeroize = "=1.8.2"',
])
  check(manifest.includes(dependency), "pinned-security-dependency", dependency);
check(manifest.includes("bundled-sqlcipher-vendored-openssl"), "sqlcipher-codec", "vendored codec");

const store = text("crates/event-store/src/lib.rs");
for (const contract of [
  "DatabaseKeyProvider",
  "DatabaseKeyCustodian",
  "journal_mode=WAL",
  "cipher_integrity_check",
  "rotate_database_key",
  "commit_artifact",
  "read_artifact",
  "record_effect_intent",
  "record_effect_result",
  "pending_effects",
  "verify_run_projection",
  "rebuild_run_projection",
  "recover",
  "verify_hash_chain",
])
  check(store.includes(contract), "event-store-contract", contract);
for (const table of [
  "events",
  "runs",
  "projections",
  "outbox",
  "idempotency_keys",
  "artifacts",
  "blobs",
  "store_metadata",
])
  check(
    store.includes(`TABLE${table === "store_metadata" ? "" : " IF NOT EXISTS"} ${table}`),
    "encrypted-schema",
    table,
  );
for (const test of [
  "file_store_is_encrypted_wal_and_rejects_wrong_key",
  "interrupted_key_rotation_reopens_with_staged_fallback",
  "artifact_blob_is_authenticated_encrypted_and_idempotent",
  "outbox_intent_result_and_reconciliation_are_transactional",
  "recovery_rebuilds_projection_and_surfaces_pending_effects",
  "version_one_database_migrates_without_losing_facts",
  "database_busy_rolls_back_without_partial_event",
  "disk_full_rolls_back_without_partial_event",
  "process_termination_discards_uncommitted_tail",
])
  check(store.includes(`fn ${test}`), "fault-or-recovery-test", test);

const custody = text("crates/event-store/src/key_custody.rs");
for (const contract of ["OsKeyringProvider", "get_secret", "set_secret", "stage_rotation", "commit_rotation"])
  check(custody.includes(contract), "native-key-custody", contract);
for (const forbidden of ["std::env", "args_os", "args()", "println!", "dbg!"])
  check(!custody.includes(forbidden), "key-custody-no-ambient-secret-path", forbidden);

const blob = text("crates/event-store/src/encrypted_blob.rs");
for (const contract of [
  "XChaCha20Poly1305",
  "XNonce::generate",
  "Payload",
  "persist_noclobber",
  "sync_all",
  "ciphertext_hash",
])
  check(blob.includes(contract), "encrypted-blob-contract", contract);

check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s04.mjs"),
  "baseline-s04-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s04.mjs"), "local-s04-gate", "pnpm verify");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S04 verification passed with ${passes.length} checks.`);
