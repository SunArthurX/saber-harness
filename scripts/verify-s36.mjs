#!/usr/bin/env node
/**
 * S36 focused verifier — packaging and update contracts.
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
  `${extensionRoot}/src/packageDefinition.js`,
  `${extensionRoot}/src/updateChannels.js`,
  `${extensionRoot}/src/storeMigration.js`,
  `${extensionRoot}/src/updateRecovery.js`,
  "scripts/package-desktop.mjs",
  "scripts/verify-offline-bundle.mjs",
  "scripts/tests/s36-install-matrix.test.mjs",
  "scripts/tests/s36-update-rollback.test.mjs",
  "scripts/tests/s36-migrations.test.mjs",
  "scripts/verify-s36.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s36-required-file", file);
}

for (const contract of [
  "APP_ID",
  "PLATFORMS",
  "hardened-runtime+notarization",
  "authenticode",
  "per-user default",
  "never advertised silently",
  "signingKeyLocation",
  "signing_key_location_prohibited",
  "CHANNELS",
  "fixtureSignature",
  "provenance",
  "artifact_digest_missing",
  "verifyProvenance",
  "parityState",
  "explicit-unsupported",
]) {
  check(text(`${extensionRoot}/src/packageDefinition.js`).includes(contract), "s36-package-contract", contract);
}
for (const contract of [
  "CHANNEL_RING",
  "updateTarget",
  "sequence_required",
  "verifyTargetChain",
  "rollback_or_freeze",
  "wrong_channel",
  "wrong_platform",
  "expired_metadata",
  "rollbackRing",
  "silentDataDowngrade",
  "updatePresentation",
  "reconcileActiveRuns",
  "orphaned",
  "silentlyTerminated",
  "updaterTrustMutation",
  "E7-governed",
]) {
  check(text(`${extensionRoot}/src/updateChannels.js`).includes(contract), "s36-channels-contract", contract);
}
for (const contract of [
  "MIGRATION_PHASES",
  "preflight",
  "insufficient_free_space",
  "migrate",
  "migration_must_move_forward",
  "crashRecovery",
  "unknown_phase",
  "downgradeAttempt",
  "refused",
  "silentCorruption",
  "sharedMigrationRegistry",
  "policyTruths",
]) {
  check(text(`${extensionRoot}/src/storeMigration.js`).includes(contract), "s36-migration-contract", contract);
}
for (const contract of [
  "KILL_PHASES",
  "FAULT_CONDITIONS",
  "killRecovery",
  "unsignedExecution",
  "faultContainment",
  "recoveryMatrix",
  "matrix-passed",
  "OFFLINE_BUNDLE_CONTENTS",
  "offlineBundle",
  "verification-instructions",
  "silentInstallOption",
  "secret_options_prohibited",
  "networkDistributionPolicy",
  "unsigned_distribution_policy",
  "uninstallFlow",
  "secureEraseNote",
]) {
  check(text(`${extensionRoot}/src/updateRecovery.js`).includes(contract), "s36-recovery-contract", contract);
}

for (const contract of ["createHash", "sha256", "sbom", "provenance", "sourceCommit"]) {
  check(text("scripts/package-desktop.mjs").includes(contract), "s36-driver-contract", contract);
}
for (const contract of ["createHash", "sha256", "signature", "sbom", "notices", "trust-metadata"]) {
  check(text("scripts/verify-offline-bundle.mjs").includes(contract), "s36-offline-contract", contract);
}

const packageJson = text("package.json");
for (const script of [
  "desktop:package",
  "desktop:test:install-matrix",
  "desktop:test:update-rollback",
  "desktop:test:migrations",
  "desktop:verify:offline-bundle",
]) {
  check(packageJson.includes(`"${script}"`), "s36-wiring-scripts", script);
}
check(packageJson.includes("verify-s36.mjs"), "s36-wiring-verify", "verify-s36 chained into the repository gate");
check(
  text(".github/workflows/repository-verification.yml").includes("Verify S36 packaging update"),
  "s36-wiring-hosted",
  "hosted verification runs verify-s36",
);

console.log(`S36 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S36 verification passed.");
