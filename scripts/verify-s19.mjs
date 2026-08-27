#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-021-governed-plugin-marketplace.md",
  "crates/plugin-registry/Cargo.toml",
  "crates/plugin-registry/src/lib.rs",
  "scripts/verify-remote-s19.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const lib = text("crates/plugin-registry/src/lib.rs");
for (const contract of [
  "pub enum RegistryError",
  "DigestMismatch",
  "Rollback",
  "UndeclaredCapability",
  "UnknownOrRevoked",
  "pub struct PluginManifest",
  "content_digest",
  "grants",
  "realm",
  "budget",
  "manifest_digest",
  "pub fn manifest_digest_of",
  "pub fn content_digest_of",
  "pub fn validate",
  "pub fn declares",
  "pub struct RegistryRecord",
  "pub struct PluginRegistry",
  "pub fn publish",
  "pub fn mark_admitted",
  "pub fn revoke",
  "pub fn authorize",
  "pub fn manifest_for",
  "pub mod sdk",
  "pub struct CapabilityRequest",
  "pub fn request_capability",
  "pub enum LifecycleEvent",
  "host-access path in this module",
])
  check(lib.includes(contract), "registry-contract", contract);
check(!lib.includes("std::fs::write"), "sdk-no-host-writes", "SDK performs no host writes");

for (const test of [
  "manifests_are_digest_bound_and_tampering_fails",
  "registry_is_monotonic_and_rollback_refused",
  "undeclared_capabilities_fail_closed",
  "unadmitted_plugins_never_authorize",
  "revocation_removes_execution_immediately_and_is_terminal",
  "sdk_surface_is_boundary_only",
  "fault_containment_holds_for_registry_plugins",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/plugin-registry"'), "workspace-member", "crates/plugin-registry");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s19.mjs"),
  "baseline-s19-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s19.mjs"), "local-s19-gate", "pnpm verify");
check(
  text("docs/adr/ADR-021-governed-plugin-marketplace.md").includes("Status: accepted"),
  "adr-021-status",
  "accepted",
);

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S19 verification passed with ${passes.length} checks.`);
