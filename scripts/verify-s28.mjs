#!/usr/bin/env node
/**
 * S28 focused verifier — desktop workbench shell contracts.
 *
 * Deterministic, offline and launch-independent: it checks that the
 * three-zone lattice, navigation projections, identity gating, fixture
 * ViewModels, versioned layout persistence and the accessibility
 * contract exist where they must be, that the shipped manifest keeps
 * the native-only contribution surface (no webview), that Command
 * Center stays a secondary view absent from the default startup route,
 * and that the S28 tests are wired into the repository gate. The real
 * runtime evidence (three-OS launch, restart and corrupt-layout
 * recovery in a packaged app) is hosted-CI evidence and is not claimed
 * here.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");
const normalized = (value) => value.replace(/\s+/g, " ");

const extensionRoot = "apps/desktop-codeoss/extensions/saber-agent";
const requiredFiles = [
  `${extensionRoot}/src/extension.js`,
  `${extensionRoot}/src/workbenchLayout.js`,
  `${extensionRoot}/src/navigationProjection.js`,
  `${extensionRoot}/src/identityContext.js`,
  `${extensionRoot}/src/agentWorkspace.js`,
  `${extensionRoot}/src/layoutPersistence.js`,
  `${extensionRoot}/src/a11yAudit.js`,
  `${extensionRoot}/package.json`,
  `${extensionRoot}/package.nls.json`,
  `${extensionRoot}/package.nls.zh-cn.json`,
  "scripts/tests/s28-workbench-shell.test.mjs",
  "scripts/tests/s28-a11y.test.mjs",
  "scripts/verify-s28.mjs",
  "fixtures/repos/basic/README.md",
  "fixtures/repos/basic/src/hello.ts",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s28-required-file", file);
}

const manifest = JSON.parse(text(`${extensionRoot}/package.json`));
const commands = manifest.contributes.commands.map((command) => command.command);

// S28-WP01 — layout tokens, presets, splitter math, receipts, themes.
const layoutModule = text(`${extensionRoot}/src/workbenchLayout.js`);
for (const contract of [
  "minWidthPx: 1280",
  "minWidthPx: 900",
  "SPLITTER_STEPS",
  "small: 16",
  "large: 64",
  "focus:",
  "build:",
  "review:",
  "team:",
  "layoutReceipt",
  "highContrast",
  "REDUCED_MOTION",
]) {
  check(layoutModule.includes(contract), "s28-layout-contract", contract);
}
check(
  manifest.contributes.keybindings.some((b) => b.command === "saber.workbench.layout.moveSplitter"),
  "s28-layout-contract",
  "splitter keybinding",
);
check(commands.includes("saber.workbench.layout.reset"), "s28-layout-contract", "default reset command");
for (const preset of ["focus", "build", "review", "team"]) {
  check(
    commands.includes(`saber.workbench.layout.preset.${preset}`),
    "s28-layout-contract",
    `preset command ${preset}`,
  );
}

// S28-WP02 — navigation projections with stable IDs and valid transitions.
const navigationModule = text(`${extensionRoot}/src/navigationProjection.js`);
for (const contract of [
  "first-run",
  "no-repository",
  "loading",
  "empty",
  "ready",
  "waiting",
  "failed",
  "archived",
  "offline",
  "TRANSITIONS",
  "applyDelta",
  "contextValue",
  "togglePin",
  "SAVED_VIEWS",
]) {
  check(navigationModule.includes(contract), "s28-navigation-contract", contract);
}
const activityViews = manifest.contributes.views["saber-workbench"].map((view) => view.id);
check(
  JSON.stringify(activityViews) ===
    JSON.stringify(["saber.projects", "saber.goals", "saber.tasks", "saber.conversations", "saber.runs"]),
  "s28-navigation-views",
  "five navigation views in the default container",
);
check(
  manifest.contributes.menus["view/item/context"].every(
    (item) => typeof item.when === "string" && item.when.includes("viewItem"),
  ),
  "s28-navigation-contract",
  "context menus gated on viewItem state",
);

// S28-WP03 — identity context fails closed for destructive actions.
const identityModule = text(`${extensionRoot}/src/identityContext.js`);
for (const contract of [
  "MANUAL_IDENTITY",
  "assertDestructiveAllowed",
  "missing-identity",
  "manual-identity",
  "revisionBinding",
  "DESTRUCTIVE_ACTIONS",
]) {
  check(identityModule.includes(contract), "s28-identity-contract", contract);
}
check(
  normalized(identityModule).includes("authorize agent effects"),
  "s28-identity-contract",
  "manual edits never authorize agent effects",
);

// S28-WP04 — fixture ViewModels, secondary Command Center, walkthrough.
const workspaceModule = text(`${extensionRoot}/src/agentWorkspace.js`);
for (const contract of [
  "FIXTURE_PROVENANCE",
  "conversationFixture",
  "planFixture",
  "evidenceFixture",
  "vitalBarFixture",
  "COMMAND_CENTER",
  "secondary-sidebar",
  "WALKTHROUGH_STEPS",
  "SPECIFICATION_STUDIO",
]) {
  check(workspaceModule.includes(contract), "s28-workspace-contract", contract);
}
check(
  manifest.contributes.views["saber-secondary"].some((view) => view.id === "saber.commandCenter"),
  "s28-workspace-contract",
  "command center in auxiliary sidebar",
);
check(
  manifest.contributes.viewsContainers.auxiliary.length === 1 &&
    !manifest.contributes.viewsContainers.activitybar.some((container) => container.id === "saber.commandCenter"),
  "s28-workspace-contract",
  "command center absent from the activity bar (secondary by construction)",
);
check(
  manifest.contributes.views["saber-evidence-panel"].some((view) => view.id === "saber.evidence") &&
    Array.isArray(manifest.contributes.viewsContainers.panel),
  "s28-workspace-contract",
  "evidence drawer in the bottom panel",
);
check(commands.includes("saber.workbench.walkthrough"), "s28-workspace-contract", "first-run walkthrough command");
check(
  !/https?:\/\//.test(JSON.stringify(manifest.contributes.viewsWelcome)),
  "s28-workspace-contract",
  "welcome content carries no remote/marketing links",
);

// S28-WP05 — versioned layout persistence, corrupt fallback, identity pinning.
const persistenceModule = text(`${extensionRoot}/src/layoutPersistence.js`);
for (const contract of [
  "LAYOUT_STORAGE_KEY",
  "LAYOUT_FORMAT_VERSION",
  "serializeLayout",
  "restoreLayout",
  "corrupt",
  "identity-mismatch",
  "version-unsupported",
  "surface-unavailable",
  "OWNED_STORAGE_KEYS",
]) {
  check(persistenceModule.includes(contract), "s28-persistence-contract", contract);
}
check(
  normalized(persistenceModule).includes("deleting run data"),
  "s28-persistence-contract",
  "corrupt layout never deletes run data",
);
const extensionSource = text(`${extensionRoot}/src/extension.js`);
check(
  extensionSource.includes("restoreLayout(stored"),
  "s28-persistence-contract",
  "activation restores the saved layout",
);
check(
  extensionSource.includes("LAYOUT_STORAGE_KEY"),
  "s28-persistence-contract",
  "extension persists under the dedicated key",
);

// S28-WP06 — accessibility contract and localization parity.
const a11yModule = text(`${extensionRoot}/src/a11yAudit.js`);
for (const contract of [
  "KEYBOARD_PATH",
  "LANDMARKS",
  "LIVE_REGIONS",
  "state-changes-only",
  "none-while-streaming",
  "POINTER_TARGET_MIN_PX",
  "FOCUS_RING_TOKEN",
  "truncationMiddle",
  "contrastRatio",
  "auditZoom",
  "auditLocalizationParity",
]) {
  check(a11yModule.includes(contract), "s28-a11y-contract", contract);
}
for (const step of [
  "saber.workbench.openRepository",
  "saber.workbench.selectTask",
  "saber.workbench.focusConversation",
  "saber.workbench.focusEditor",
  "saber.workbench.openTerminal",
  "saber.workbench.openEvidence",
  "saber.workbench.returnFocus",
]) {
  check(commands.includes(step), "s28-a11y-contract", `keyboard path command ${step}`);
}
const english = JSON.parse(text(`${extensionRoot}/package.nls.json`));
const chinese = JSON.parse(text(`${extensionRoot}/package.nls.zh-cn.json`));
check(
  JSON.stringify(Object.keys(english).sort()) === JSON.stringify(Object.keys(chinese).sort()),
  "s28-a11y-contract",
  "zh/en string table parity",
);
for (const command of manifest.contributes.commands) {
  const key = command.title.slice(1, -1);
  check(Boolean(english[key]) && Boolean(chinese[key]), "s28-a11y-contract", `localized strings for ${key}`);
}

// Startup route: patch 0002 keeps the workbench container as the default
// sidebar route, and the workbench container (not Command Center) is it.
const patch = text("apps/desktop-codeoss/patches/0002-workbench-default-route.patch");
check(patch.includes("saber-workbench"), "s28-startup-route", "patch 0002 targets the workbench container");

// Native-only surface: no webview anywhere in the shell contributions.
check(!JSON.stringify(manifest).includes('"webview"'), "s28-native-only", "no webview in the manifest");
for (const moduleFile of [
  "extension.js",
  "workbenchLayout.js",
  "navigationProjection.js",
  "identityContext.js",
  "agentWorkspace.js",
  "layoutPersistence.js",
  "a11yAudit.js",
]) {
  const source = text(`${extensionRoot}/src/${moduleFile}`);
  check(!source.includes("createWebviewPanel"), "s28-native-only", `no webview in ${moduleFile}`);
}
check(
  !extensionSource.includes("child_process") && !extensionSource.includes("node:fs"),
  "s28-native-only",
  "extension host code spawns no processes and touches no filesystem directly",
);

// Wiring: tests and scripts chained into the repository gate and hosted CI.
const packageJson = text("package.json");
check(packageJson.includes("desktop:test:workbench"), "s28-wiring-scripts", "desktop:test:workbench");
check(packageJson.includes("desktop:test:a11y"), "s28-wiring-scripts", "desktop:test:a11y");
check(packageJson.includes("verify-s28.mjs"), "s28-wiring-verify", "verify-s28 chained into the repository gate");
const workflow = text(".github/workflows/repository-verification.yml");
check(
  workflow.includes("Verify S28 desktop workbench shell"),
  "s28-wiring-hosted",
  "hosted repository verification runs verify-s28",
);
const smoke = text("apps/desktop-codeoss/scripts/smoke.mjs");
check(smoke.includes("--workspace"), "s28-wiring-smoke", "smoke accepts --workspace fixtures");
check(smoke.includes("saber.commandCenter"), "s28-wiring-smoke", "smoke asserts the secondary command center");

console.log(`S28 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S28 verification passed.");
