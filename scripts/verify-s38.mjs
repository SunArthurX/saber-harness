#!/usr/bin/env node
/**
 * S38 focused verifier — design partner and production contracts.
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
  `${extensionRoot}/src/partnerCohort.js`,
  `${extensionRoot}/src/taskBenchmark.js`,
  `${extensionRoot}/src/releaseRings.js`,
  `${extensionRoot}/src/productionDecision.js`,
  "scripts/acceptance-design-partner.mjs",
  "scripts/verify-release-candidate.mjs",
  "scripts/tests/s38-cohort-benchmark.test.mjs",
  "scripts/tests/s38-rings-support.test.mjs",
  "scripts/tests/s38-release-decision.test.mjs",
  "fixtures/design-partner/benchmark.json",
  "fixtures/design-partner/journeys.json",
  "scripts/verify-s38.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s38-required-file", file);
}

for (const contract of [
  "CONSENT_CLAUSES",
  "incident-notification",
  "cohortSelection",
  "cohort_too_small",
  "rejected-cherry-picked",
  "partnerWorkspace",
  "partner_identity_incomplete",
  "researchProtocol",
  "requests-private-data",
]) {
  check(text(`${extensionRoot}/src/partnerCohort.js`).includes(contract), "s38-cohort-contract", contract);
}
for (const contract of [
  "TASK_CATEGORIES",
  "understand",
  "denial",
  "freezeTask",
  "acceptance_and_starting_commit_required",
  "recordRun",
  "humanCorrections",
  "approvalInterruptions",
  "memoryPrecision",
  "PRODUCTION_THRESHOLDS",
  "evaluateBenchmark",
  "thresholds-missed",
  "categoryCoverage",
  "routeComparison",
  "productIdentityClaim",
]) {
  check(text(`${extensionRoot}/src/taskBenchmark.js`).includes(contract), "s38-benchmark-contract", contract);
}
for (const contract of [
  "RINGS",
  "internal-alpha",
  "private-beta",
  "release-candidate",
  "ringPlan",
  "ring_plan_missing",
  "productionSignedArtifacts",
  "ringProgression",
  "missingPrerequisites",
  "PLAYBOOKS",
  "security-disclosure",
  "REHEARSALS",
  "secret-incident",
  "corrupted-local-profile",
  "supportReadiness",
  "selfServiceRecovery",
  "supportRequest",
  "raw_secrets",
  "unrestricted_private_repositories",
]) {
  check(text(`${extensionRoot}/src/releaseRings.js`).includes(contract), "s38-rings-contract", contract);
}
for (const contract of [
  "PRIVACY_CHECKS",
  "opt-in-telemetry",
  "subprocessors",
  "dsr-workflow",
  "regional-deployment-claims",
  "docs-match-behavior",
  "governanceReview",
  "allIndependent",
  "PACKET_CONTENTS",
  "signed-artifact-provenance",
  "s37-readiness-digest",
  "design-partner-kpis",
  "releasePacket",
  "packet_incomplete",
  "bounded-rollout-approved",
  "monitoringRemoved",
  "rollbackRemoved",
  "criticalExceptionApproval",
  "no one-person approval",
  "approvalBoundaries",
]) {
  check(text(`${extensionRoot}/src/productionDecision.js`).includes(contract), "s38-decision-contract", contract);
}

for (const contract of ["benchmark.json", "journeys.json", "categoryCoverage", "evaluateBenchmark", "thresholds"]) {
  check(text("scripts/acceptance-design-partner.mjs").includes(contract), "s38-acceptance-contract", contract);
}
for (const contract of ["descriptors.json", "releasePacket", "readiness", "bounded-rollout"]) {
  check(text("scripts/verify-release-candidate.mjs").includes(contract), "s38-rc-contract", contract);
}

const benchmarkFixture = text("fixtures/design-partner/benchmark.json");
for (const category of [
  "understand",
  "fix",
  "refactor",
  "test",
  "dependency",
  "documentation",
  "multi-file",
  "long-running",
  "multi-agent",
  "resume",
  "recovery",
  "denial",
]) {
  check(benchmarkFixture.includes(`"category": "${category}"`), "s38-fixture-category", category);
}
const journeysFixture = text("fixtures/design-partner/journeys.json");
check(journeysFixture.includes("DJ-14"), "s38-fixture-journeys", "DJ-14 import/resume");
check(journeysFixture.includes("DJ-24"), "s38-fixture-journeys", "DJ-24 cross-task-messages");
check(journeysFixture.includes("DJ-32"), "s38-fixture-journeys", "DJ-32 immune-forgetting");

const packageJson = text("package.json");
for (const script of ["desktop:acceptance:design-partner", "desktop:verify:release-candidate"]) {
  check(packageJson.includes(`"${script}"`), "s38-wiring-scripts", script);
}
check(packageJson.includes("verify-s38.mjs"), "s38-wiring-verify", "verify-s38 chained into the repository gate");
check(
  text(".github/workflows/repository-verification.yml").includes("Verify S38 design partner production"),
  "s38-wiring-hosted",
  "hosted verification runs verify-s38",
);

console.log(`S38 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S38 verification passed.");
