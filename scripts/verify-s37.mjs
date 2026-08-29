#!/usr/bin/env node
/**
 * S37 focused verifier — quality and security gate contracts.
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
  `${extensionRoot}/src/performanceSlo.js`,
  `${extensionRoot}/src/a11yLocalization.js`,
  `${extensionRoot}/src/securityRedteam.js`,
  `${extensionRoot}/src/chaosReliability.js`,
  `${extensionRoot}/src/readinessGate.js`,
  "scripts/bench-desktop.mjs",
  "scripts/readiness-desktop.mjs",
  "scripts/tests/s37-a11y-all.test.mjs",
  "scripts/tests/s37-redteam.test.mjs",
  "scripts/tests/s37-chaos.test.mjs",
  "fixtures/readiness/descriptors.json",
  "scripts/verify-s37.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s37-required-file", file);
}

for (const contract of [
  "SLO_TABLE",
  "cold-start",
  "first-agent-response",
  "index-10k-files",
  "large-diff-render",
  "memory-idle",
  "cpu-idle",
  "disk-growth-per-day",
  "evaluateSlo",
  "unknown_slo_metric",
  "evaluateReport",
  "median",
  "p95",
  "rawMetadataOnly",
  "userContentIncluded",
]) {
  check(text(`${extensionRoot}/src/performanceSlo.js`).includes(contract), "s37-slo-contract", contract);
}
for (const contract of [
  "KEYBOARD_JOURNEYS",
  "first-run",
  "agent-task",
  "approval",
  "diff-review",
  "SCREEN_READERS",
  "voiceover",
  "nvda",
  "orca-at-spi",
  "A11Y_CHECKS",
  "zoom-400",
  "reduced-motion",
  "defectGate",
  "a11y-blocked",
  "GLOSSARY",
  "localeCompleteness",
  "untranslatedSecurityDecisions",
  "pseudoLocalize",
  "pseudoExpansionCheck",
  "formattingContract",
  "imeCompositionSafe",
  "localeDependentParserBehavior",
]) {
  check(text(`${extensionRoot}/src/a11yLocalization.js`).includes(contract), "s37-a11y-contract", contract);
}
for (const contract of [
  "THREATS",
  "prompt-injection",
  "terminal-escape",
  "webview-xss",
  "renderer-extension-compromise",
  "ipc-spoof",
  "secret-theft",
  "egress-bypass",
  "mcp-plugin-supply-chain",
  "update-tamper",
  "cross-tenant-access",
  "resource-exhaustion",
  "audit-tamper",
  "redteamFinding",
  "exploit_evidence_missing",
  "redteamCampaign",
  "pjNegativeRule",
  "PJ-negative",
  "remoteDispatchAttack",
  "replayed-approval",
  "globalStopReachable",
  "teamValueMeasurement",
  "parityClaim",
  "runtimeImageCheck",
  "drifted-rebuild",
]) {
  check(text(`${extensionRoot}/src/securityRedteam.js`).includes(contract), "s37-redteam-contract", contract);
}
for (const contract of [
  "CHAOS_SCENARIOS",
  "24h-workload",
  "crash-loop",
  "os-restart",
  "network-partition",
  "disk-full",
  "corrupt-index",
  "provider-outage",
  "sync-conflict",
  "failed-migration",
  "runChaos",
  "chaosCampaign",
  "chaos-passed",
  "retryPolicy",
  "escalate",
  "evidenceRetention",
  "chaos_evidence_is_retained",
]) {
  check(text(`${extensionRoot}/src/chaosReliability.js`).includes(contract), "s37-chaos-contract", contract);
}
for (const contract of [
  "REQUIRED_FAMILIES",
  "DesktopTruth",
  "CoreBoundary",
  "FunctionalJourney",
  "CrossPlatform",
  "Accessibility",
  "Performance",
  "Privacy",
  "Recovery",
  "SupplyChain",
  "ThreatCoverage",
  "ReportHygiene",
  "finding",
  "evaluateGate",
  "blockerFindings",
  "digest",
  "reportHygiene",
  "private-transcript",
]) {
  check(text(`${extensionRoot}/src/readinessGate.js`).includes(contract), "s37-gate-contract", contract);
}

for (const contract of ["REFERENCE_MACHINE_CLASS", "median", "p95", "rawMetadataOnly", "userContentIncluded"]) {
  check(text("scripts/bench-desktop.mjs").includes(contract), "s37-bench-contract", contract);
}
for (const contract of ["descriptors.json", "evaluateGate", "verdict", "digest"]) {
  check(text("scripts/readiness-desktop.mjs").includes(contract), "s37-readiness-contract", contract);
}

const packageJson = text("package.json");
for (const script of [
  "desktop:bench",
  "desktop:test:a11y:all",
  "desktop:test:redteam",
  "desktop:test:chaos",
  "desktop:readiness",
]) {
  check(packageJson.includes(`"${script}"`), "s37-wiring-scripts", script);
}
check(packageJson.includes("verify-s37.mjs"), "s37-wiring-verify", "verify-s37 chained into the repository gate");
check(
  text(".github/workflows/repository-verification.yml").includes("Verify S37 quality security gate"),
  "s37-wiring-hosted",
  "hosted verification runs verify-s37",
);

console.log(`S37 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S37 verification passed.");
