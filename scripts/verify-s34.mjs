#!/usr/bin/env node
/**
 * S34 focused verifier — armor, evolution and health contracts.
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
  `${extensionRoot}/src/armorRack.js`,
  `${extensionRoot}/src/evolutionWorkshop.js`,
  `${extensionRoot}/src/healthMonitor.js`,
  `${extensionRoot}/src/gameDay.js`,
  "scripts/tests/s34-armor-rack.test.mjs",
  "scripts/tests/s34-evolution-workshop.test.mjs",
  "scripts/tests/s34-health-incidents.test.mjs",
  "scripts/tests/s34-game-day.test.mjs",
  "scripts/verify-s34.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s34-required-file", file);
}

for (const contract of [
  "ARMOR_KINDS",
  "verifyManifest",
  "signature_mismatch",
  "untrusted_signer",
  "armorCard",
  "uninstallImpact",
  "installGrant",
  "grantsBeyondManifest",
  "reversibleLoad",
  "immuneRootStaysPrivileged",
  "revokeArmor",
  "dependentWorkflowsMarked",
]) {
  check(text(`${extensionRoot}/src/armorRack.js`).includes(contract), "s34-armor-contract", contract);
}
for (const contract of [
  "CANDIDATE_SOURCES",
  "EVOLUTION_LADDER",
  "protected-PR-only",
  "intakeGate",
  "source-poisoned",
  "grouped",
  "rung_forbidden",
  "candidateReview",
  "selfInstalled",
  "freezeBaseline",
  "missing_last_known_good",
  "evaluateCandidate",
  "productionSecrets",
  "canaryPlan",
  "canary_plan_missing",
  "rollbackCandidate",
  "evidencePreserved",
]) {
  check(text(`${extensionRoot}/src/evolutionWorkshop.js`).includes(contract), "s34-evolution-contract", contract);
}
for (const contract of [
  "VITAL_SIGNALS",
  "HEALTH_SEVERITIES",
  "classifyIncident",
  "unknown_vital_signal",
  "incidentLifecycle",
  "incidentPresentation",
  "supportBundle",
  "userReviewed",
  "IMMUNE_CONTROLS",
  "modelApprovalRequired",
  "agentHealthAttempt",
  "suppress-health-event",
  "edit-audit-history",
  "exit-safe-mode",
  "safeModeTransition",
  "external human/admin/vendor authority",
  "circuitBreaker",
]) {
  check(text(`${extensionRoot}/src/healthMonitor.js`).includes(contract), "s34-health-contract", contract);
}
for (const contract of [
  "SCENARIOS",
  "PLAYBOOK",
  "plugin-crash-loop",
  "poisoned-candidate",
  "sandbox-escape-signal",
  "provider-misroute",
  "corrupt-index",
  "bad-update-candidate",
  "runScenario",
  "runGameDay",
  "containmentBounded",
  "last-known-good",
  "safe-mode",
  "evidencePreserved",
  "append-only",
]) {
  check(text(`${extensionRoot}/src/gameDay.js`).includes(contract), "s34-game-day-contract", contract);
}

const packageJson = text("package.json");
for (const script of [
  "desktop:test:armor-rack",
  "desktop:test:evolution-workshop",
  "desktop:test:health-incidents",
  "desktop:test:game-day",
]) {
  check(packageJson.includes(`"${script}"`), "s34-wiring-scripts", script);
}
check(packageJson.includes("verify-s34.mjs"), "s34-wiring-verify", "verify-s34 chained into the repository gate");
check(
  text(".github/workflows/repository-verification.yml").includes("Verify S34 armor evolution health"),
  "s34-wiring-hosted",
  "hosted verification runs verify-s34",
);

console.log(`S34 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S34 verification passed.");
