#!/usr/bin/env node
/**
 * S33 focused verifier — continuity and knowledge contracts.
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
  `${extensionRoot}/src/importWizard.js`,
  `${extensionRoot}/src/lineageBrowser.js`,
  `${extensionRoot}/src/retrievalContext.js`,
  `${extensionRoot}/src/memoryLedger.js`,
  `${extensionRoot}/src/privacyDeletion.js`,
  "fixtures/exports/codex-sample.json",
  "fixtures/exports/claude-sample.json",
  "scripts/tests/s33-import-lineage.test.mjs",
  "scripts/tests/s33-resume-drift.test.mjs",
  "scripts/tests/s33-memory-ledger.test.mjs",
  "scripts/tests/s33-deletion-e2ee.test.mjs",
  "scripts/eval-memory.mjs",
  "scripts/verify-s33.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s33-required-file", file);
}

for (const contract of [
  "consentManifest",
  "validateImport",
  "malicious-attachment-content",
  "parser-version-mismatch",
  "unsupported-format",
  "canonicalize",
  "unsupportedFields",
  "importSession",
  "cancelled",
]) {
  check(text(`${extensionRoot}/src/importWizard.js`).includes(contract), "s33-import-contract", contract);
}
for (const contract of [
  "LINEAGE_LAYERS",
  "lineageRecord",
  "deletionPropagation",
  "promotionGate",
  "captureCapsule",
  "revalidateCapsule",
  "diverged",
  "requiresUserChoice",
  "continueFrom",
  "rewritesSource",
]) {
  check(text(`${extensionRoot}/src/lineageBrowser.js`).includes(contract), "s33-lineage-contract", contract);
}
for (const contract of [
  "retrievalFilter",
  "sensitivity-secret",
  "expired-ttl",
  "revoked",
  "rerank",
  "perSourceBudget",
  "contextReceipt",
  "evaluate",
  "falseProvenanceRate",
]) {
  check(text(`${extensionRoot}/src/retrievalContext.js`).includes(contract), "s33-retrieval-contract", contract);
}
for (const contract of [
  "MEMORY_TYPES",
  "MEMORY_ACTIONS",
  "memoryLedger",
  "revision_conflict",
  "recall",
  "conflictResolution",
  "secretLastWriteWins",
  "recallPromotionGate",
  "independent-evidence",
]) {
  check(text(`${extensionRoot}/src/memoryLedger.js`).includes(contract), "s33-memory-contract", contract);
}
for (const contract of [
  "STORAGE_POLICY",
  "os-credential-store",
  "syncEnvelope",
  "metadata_not_allowed",
  "strictModeCapabilities",
  "serverSidePlaintextSearch",
  "deletionPropagation",
  "legal-hold",
  "derived-data-deletion",
  "clientKeyContinuity",
  "conflictHidden",
]) {
  check(text(`${extensionRoot}/src/privacyDeletion.js`).includes(contract), "s33-privacy-contract", contract);
}

const evalScript = text("scripts/eval-memory.mjs");
for (const contract of [
  "PRECISION_THRESHOLD",
  "STALE_THRESHOLD",
  "DUPLICATE_THRESHOLD",
  "FALSE_PROVENANCE_THRESHOLD",
]) {
  check(evalScript.includes(contract), "s33-eval-contract", contract);
}

const packageJson = text("package.json");
for (const script of [
  "desktop:test:import-lineage",
  "desktop:test:resume-drift",
  "desktop:test:memory-ledger",
  "desktop:test:deletion-e2ee",
  "desktop:eval:memory",
]) {
  check(packageJson.includes(`"${script}"`), "s33-wiring-scripts", script);
}
check(packageJson.includes("verify-s33.mjs"), "s33-wiring-verify", "verify-s33 chained into the repository gate");
check(
  text(".github/workflows/repository-verification.yml").includes("Verify S33 continuity and knowledge"),
  "s33-wiring-hosted",
  "hosted verification runs verify-s33",
);

console.log(`S33 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S33 verification passed.");
