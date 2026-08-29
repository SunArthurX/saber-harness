#!/usr/bin/env node
/**
 * S29 focused verifier — conversation and context contracts.
 *
 * Deterministic, offline and model-free: it checks that the message
 * model, composer state machine, context preview/receipt, selector
 * policy and privacy controls exist with their fail-closed contracts,
 * that the extension wiring stays a native projection with no model
 * calls, and that the S29 suites are chained into the repository gate.
 * Live streaming against a real provider is governed-run evidence
 * (S30+) and is not claimed here.
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
  `${extensionRoot}/src/conversationModel.js`,
  `${extensionRoot}/src/composerState.js`,
  `${extensionRoot}/src/contextReceipt.js`,
  `${extensionRoot}/src/selectorPolicy.js`,
  `${extensionRoot}/src/privacyControls.js`,
  `${extensionRoot}/src/extension.js`,
  "scripts/tests/s29-conversation.test.mjs",
  "scripts/tests/s29-context-receipts.test.mjs",
  "scripts/tests/s29-redaction-canary.test.mjs",
  "scripts/tests/s29-a11y-conversation.test.mjs",
  "scripts/run-a11y.mjs",
  "scripts/verify-s29.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s29-required-file", file);
}

const manifest = JSON.parse(text(`${extensionRoot}/package.json`));
const commands = manifest.contributes.commands.map((command) => command.command);

// S29-WP01 — message model: distinct kinds, dedup, no chain-of-thought.
const conversationModule = text(`${extensionRoot}/src/conversationModel.js`);
for (const contract of [
  "MESSAGE_KINDS",
  "agent-summary",
  "decision-proposal",
  "approval-request",
  "tool-summary",
  "checkpoint",
  "incident",
  "system-notice",
  "HIDDEN_ROLES",
  "chain-of-thought",
  "REDACTION_MARKER",
  "retryOf",
  "collapsedByDefault",
  "evidenceRef",
]) {
  check(conversationModule.includes(contract), "s29-conversation-contract", contract);
}
check(
  !conversationModule.includes("fetch(") && !conversationModule.includes('require("https'),
  "s29-conversation-contract",
  "no network in the message model",
);

// S29-WP02 — composer state machine.
const composerModule = text(`${extensionRoot}/src/composerState.js`);
for (const contract of [
  "context-over-budget",
  "dlp-blocked",
  "offline-queued",
  "resolving-references",
  "attachment-scanning",
  "TOKEN_TRIGGERS",
  "governed-capability",
  "validateAttachment",
  "malware-scan-required",
  "sensitivity-blocked",
  "steer_requires_event_cursor",
  "visibleBoundary",
  "draftRetained",
]) {
  check(composerModule.includes(contract), "s29-composer-contract", contract);
}

// S29-WP03 — context preview and receipt reconciliation.
const receiptModule = text(`${extensionRoot}/src/contextReceipt.js`);
for (const contract of [
  "FRAGMENT_FIELDS",
  "sourceId",
  "revision",
  "reason",
  "tokenEstimate",
  "transformation",
  "destinationProvider",
  "retentionPolicy",
  "reconcile",
  "divergences",
  "context.fragment_excluded",
  "secret_fragment_not_dispatchable",
]) {
  check(receiptModule.includes(contract), "s29-receipt-contract", contract);
}

// S29-WP04 — model/realm/autonomy/budget selectors bound by policy.
const selectorModule = text(`${extensionRoot}/src/selectorPolicy.js`);
for (const contract of [
  "CAPABILITIES",
  "AUTONOMY_PRESETS",
  "contextLimitTokens",
  "priceClass",
  "policyTags",
  "dataEgress",
  "BUDGET_LIMITS",
  "wallClockMinutes",
  "toolCalls",
  "model-not-eligible",
  "realm-not-permitted",
  "clamped-by-policy",
]) {
  check(selectorModule.includes(contract), "s29-selector-contract", contract);
}

// S29-WP05 — privacy controls.
const privacyModule = text(`${extensionRoot}/src/privacyControls.js`);
for (const contract of [
  "canaryScan",
  "CANARY_KINDS",
  "excludeBeforeDispatch",
  "revoke",
  "CANNOT claim deletion",
  "alreadyContactedProviders",
  "assertDraftStorage",
  "crash-dump-inclusion",
  "includedInCrashDumps: false",
]) {
  check(privacyModule.includes(contract), "s29-privacy-contract", contract);
}

// Extension wiring: native commands, keyboard reachability, no model calls.
for (const command of [
  "saber.conversation.focus",
  "saber.conversation.retry",
  "saber.conversation.previewContext",
  "saber.conversation.excludeFragment",
]) {
  check(commands.includes(command), "s29-wiring-commands", command);
}
check(
  manifest.contributes.keybindings.some((binding) => binding.command === "saber.conversation.focus"),
  "s29-wiring-commands",
  "conversation focus is keybound",
);
const extensionSource = text(`${extensionRoot}/src/extension.js`);
for (const contract of ["ConversationStream", "ContextPreview", "contextPreview.exclude", "conversation.retry"]) {
  check(extensionSource.includes(contract), "s29-wiring-extension", contract);
}
check(
  !extensionSource.includes("fetch(") && !/https:\/\/api/.test(extensionSource),
  "s29-wiring-extension",
  "no provider calls from the shell",
);
const english = JSON.parse(text(`${extensionRoot}/package.nls.json`));
const chinese = JSON.parse(text(`${extensionRoot}/package.nls.zh-cn.json`));
check(
  JSON.stringify(Object.keys(english).sort()) === JSON.stringify(Object.keys(chinese).sort()),
  "s29-wiring-nls",
  "zh/en parity",
);
for (const command of manifest.contributes.commands) {
  const key = command.title.slice(1, -1);
  check(Boolean(english[key]) && Boolean(chinese[key]), "s29-wiring-nls", `localized ${key}`);
}

// Wiring: scripts and hosted gates.
const packageJson = text("package.json");
for (const script of ["desktop:test:conversation", "desktop:test:context-receipts", "desktop:test:redaction-canary"]) {
  check(packageJson.includes(`"${script}"`), "s29-wiring-scripts", script);
}
check(packageJson.includes("run-a11y.mjs"), "s29-wiring-scripts", "a11y journey runner");
check(packageJson.includes("verify-s29.mjs"), "s29-wiring-verify", "verify-s29 chained into the repository gate");
const workflow = text(".github/workflows/repository-verification.yml");
check(
  workflow.includes("Verify S29 conversation and context"),
  "s29-wiring-hosted",
  "hosted verification runs verify-s29",
);

console.log(`S29 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S29 verification passed.");
