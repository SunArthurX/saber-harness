#!/usr/bin/env node
/**
 * S35 focused verifier — enterprise desktop contracts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const extensionRoot = "apps/desktop-codeoss/extensions/saber-agent";
const requiredFiles = [
  `${extensionRoot}/src/enterpriseIdentity.js`,
  `${extensionRoot}/src/policyDistribution.js`,
  `${extensionRoot}/src/kmsDlp.js`,
  `${extensionRoot}/src/tenantIsolation.js`,
  "scripts/tests/s35-enterprise-identity.test.mjs",
  "scripts/tests/s35-policy-distribution.test.mjs",
  "scripts/tests/s35-kms-dlp.test.mjs",
  "scripts/tests/s35-tenant-isolation.test.mjs",
  "scripts/verify-s35.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s35-required-file", file);
}

for (const contract of [
  "exchangeAssertion",
  "password_handling_prohibited",
  "forged_claim",
  "assertion_expired",
  "resolveGroups",
  "recursive_group",
  "cross_tenant_group",
  "scimMap",
  "deterministic",
  "enrollDevice",
  "device_identity_incomplete",
  "authorizeHighRisk",
  "device_revoked",
  "device_lost",
  "offline_grace_exceeded",
]) {
  check(text(`${extensionRoot}/src/enterpriseIdentity.js`).includes(contract), "s35-identity-contract", contract);
}
for (const contract of [
  "untrusted_policy_signer",
  "acceptBundle",
  "policy_rollback_or_replay",
  "effectivePolicy",
  "weakeningAttempt",
  "denyWeakened",
  "offlinePolicy",
  "stalenessSurfaced",
  "silentDefaultFallback",
]) {
  check(text(`${extensionRoot}/src/policyDistribution.js`).includes(contract), "s35-policy-contract", contract);
}
for (const contract of [
  "envelopeWrap",
  "plaintextKeyInEnvelope",
  "approved-process-memory",
  "rotateKey",
  "rollbackSafe",
  "oldWrappingsValidUntil",
  "revokeDeviceKey",
  "secretReference",
  "secret_value_in_policy_prohibited",
  "invalid_secret_reference",
  "APPROVED_PLAINTEXT_SINKS",
  "crash-dumps",
  "dlpEvaluate",
  "blockEvidence",
  "transformation",
]) {
  check(text(`${extensionRoot}/src/kmsDlp.js`).includes(contract), "s35-kms-contract", contract);
}
for (const contract of [
  "REGISTRY_KINDS",
  "registryEntry",
  "registry_entry_unsigned",
  "executableBeforeApproval",
  "fetchableBeforeApproval",
  "registryAccess",
  "core-denial-overrides-org-allowlist",
  "orgAllowlistOverride",
  "ROLE_GRANTS",
  "roleCheck",
  "auditPartition",
  "crossTenantLeak",
  "retentionJob",
  "idempotencyKey",
  "breakGlass",
  "dual_control_required",
  "afterActionReview",
  "auditDisabled",
  "adversarial",
  "registry-digest-swap",
  "retention-race",
  "audit-inference",
  "break-glass-abuse",
]) {
  check(text(`${extensionRoot}/src/tenantIsolation.js`).includes(contract), "s35-tenant-contract", contract);
}

const packageJson = text("package.json");
for (const script of [
  "desktop:test:enterprise-identity",
  "desktop:test:policy-distribution",
  "desktop:test:kms-dlp",
  "desktop:test:tenant-isolation",
]) {
  check(packageJson.includes(`"${script}"`), "s35-wiring-scripts", script);
}
check(packageJson.includes("verify-s35.mjs"), "s35-wiring-verify", "verify-s35 chained into the repository gate");
check(
  text(".github/workflows/repository-verification.yml").includes("Verify S35 enterprise desktop"),
  "s35-wiring-hosted",
  "hosted verification runs verify-s35",
);

console.log(`S35 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S35 verification passed.");
