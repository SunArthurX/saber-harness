#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-023-multitenant-enterprise-control.md",
  "crates/enterprise/Cargo.toml",
  "crates/enterprise/src/lib.rs",
  "scripts/verify-remote-s21.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const lib = text("crates/enterprise/src/lib.rs");
for (const contract of [
  "pub enum EnterpriseError",
  "CrossTenant",
  "VocabularyEscape",
  "BreakGlassRefused",
  "pub struct TenantKey",
  "pub struct TenantPlane",
  "pub fn get",
  "pub struct IamClaim",
  "pub struct IamMapping",
  "pub const MAX_ROLE_DEPTH",
  "pub struct IdentityRealm",
  "pub fn organization_bundle",
  "pub fn principal",
  "pub fn break_glass",
  "pub fn break_glass_active",
  "pub fn active_break_glass",
  "pub fn engine",
  "pub fn permit_rule",
  "pub struct AuditPartition",
  "pub struct AuditLine",
  "pub fn read",
  "pub fn evidence_pack",
  "denied by construction (ADR-023)",
])
  check(lib.includes(contract), "enterprise-contract", contract);

for (const test of [
  "tenant_planes_deny_cross_tenant_by_construction",
  "iam_expands_deterministically_and_bounds_depth",
  "mappings_cannot_escape_the_closed_vocabulary",
  "org_bundles_ride_the_s05_engine_and_rollback_still_refused",
  "break_glass_is_dual_controlled_expiring_and_loud",
  "audit_streams_are_tenant_separated_with_metadata_only_packs",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/enterprise"'), "workspace-member", "crates/enterprise");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s21.mjs"),
  "baseline-s21-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s21.mjs"), "local-s21-gate", "pnpm verify");
check(
  text("docs/adr/ADR-023-multitenant-enterprise-control.md").includes("Status: accepted"),
  "adr-023-status",
  "accepted",
);

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S21 verification passed with ${passes.length} checks.`);
