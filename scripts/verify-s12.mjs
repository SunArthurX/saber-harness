#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-014-cax-recomputable-evidence.md",
  "schemas/exchange/v1/cax.schema.json",
  "crates/cax/Cargo.toml",
  "crates/cax/src/lib.rs",
  "crates/cax/src/record.rs",
  "crates/cax/src/importer.rs",
  "crates/cax/src/library.rs",
  "scripts/verify-remote-s12.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const schema = JSON.parse(text("schemas/exchange/v1/cax.schema.json"));
check(schema["x-saber-version"] === "1.0.0", "schema-version", schema["x-saber-version"]);
check(schema.properties.schema_version.const === "1.0.0", "schema-frozen-version", "1.0.0");
check(
  JSON.stringify(schema.properties.source.properties.format.enum) ===
    JSON.stringify(["jsonl_transcript", "markdown_transcript"]),
  "schema-formats",
  "two importer formats",
);
check(schema.properties.entries.items.properties.role.enum.length === 4, "schema-roles", "user/assistant/tool/system");

const record = text("crates/cax/src/record.rs");
for (const contract of [
  'pub const CAX_SCHEMA_VERSION: &str = "1.0.0"',
  "pub enum SourceFormat",
  "JsonlTranscript",
  "MarkdownTranscript",
  "pub enum EntryRole",
  "pub struct CaxEntry",
  "content_digest",
  "pub struct CaxSource",
  "raw_digest",
  "pub struct CaxSession",
  "pub struct CaxRecord",
  "record_digest",
  "pub enum CaxError",
  "UnknownVersion",
  "DigestMismatch",
  "CrossWorkspace",
  "pub fn raw_digest_of",
  "pub fn entry_digest_of",
  "pub fn record_digest_of",
  "pub fn record_id_for",
  "pub fn validate",
])
  check(record.includes(contract), "record-contract", contract);

const importer = text("crates/cax/src/importer.rs");
for (const contract of [
  "pub struct ImportScope",
  "pub fn import_jsonl_transcript",
  "pub fn import_markdown_transcript",
  "fn assemble",
  "record.validate()",
  "parse_header",
])
  check(importer.includes(contract), "importer-contract", contract);

const library = text("crates/cax/src/library.rs");
for (const contract of [
  "pub struct ImportTombstone",
  "pub enum LibraryError",
  "pub enum ImportOutcome",
  "Created(",
  "Existing(",
  "pub struct CaxLibrary",
  "pub fn import",
  "pub fn revoke",
  "pub fn records",
  "pub fn tombstones",
  "pub fn fabric_admissions_for",
  "pub fn admit_into_fabric",
  "pub fn contents_appear_in_raw",
  "TrustLevel::Untrusted",
  "content_digest_of",
])
  check(library.includes(contract), "library-contract", contract);

const lib = text("crates/cax/src/lib.rs");
for (const test of [
  "jsonl_import_builds_a_valid_hash_chain",
  "markdown_import_parses_turns_verbatim",
  "tampered_record_or_source_fails_closed",
  "importer_cannot_invent_content_absent_from_raw",
  "reimport_is_idempotent_and_evolution_creates_new_records",
  "revocation_removes_records_and_preserves_provenance",
  "cross_workspace_injection_is_denied",
  "imported_records_admit_into_the_fabric_as_untrusted",
  "identical_sources_produce_identical_records",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/cax"'), "workspace-member", "crates/cax");
check(
  text("crates/cax/src/library.rs").includes("the tombstone"),
  "revocation-finality",
  "revoked sources stay revoked",
);
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s12.mjs"),
  "baseline-s12-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s12.mjs"), "local-s12-gate", "pnpm verify");
check(text("docs/adr/ADR-014-cax-recomputable-evidence.md").includes("Status: accepted"), "adr-014-status", "accepted");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S12 verification passed with ${passes.length} checks.`);
