/**
 * S28-WP01..WP05 — desktop workbench shell unit tests.
 *
 * Pure-module tests over the layout lattice, navigation projections,
 * identity gating, fixture ViewModels and layout persistence. Windows
 * absolute paths are not valid ESM specifiers, so every import goes
 * through a file URL (see S27's bridge test).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const layout = await src("workbenchLayout.js");
const navigation = await src("navigationProjection.js");
const identity = await src("identityContext.js");
const workspace = await src("agentWorkspace.js");
const persistence = await src("layoutPersistence.js");

const manifestPath = join(root, "apps/desktop-codeoss/extensions/saber-agent/package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

test("S28-WP01 safe states resolve at 1280/900/narrow boundaries", () => {
  assert.equal(layout.resolveSafeState(1280), "minimum");
  assert.equal(layout.resolveSafeState(1279), "compact");
  assert.equal(layout.resolveSafeState(900), "compact");
  assert.equal(layout.resolveSafeState(899), "narrow");
  assert.equal(layout.SAFE_STATES.minimum.minWidthPx, 1280);
  assert.equal(layout.SAFE_STATES.compact.minWidthPx, 900);
});

test("S28-WP01 splitter movement clamps into pane bounds and resets", () => {
  const moved = layout.moveSplitter(layout.DEFAULT_LAYOUT, "primary-sidebar", -1000);
  assert.equal(moved.panes["primary-sidebar"], layout.PANE_LIMITS["primary-sidebar"].min);
  const grown = layout.moveSplitter(layout.DEFAULT_LAYOUT, "primary-sidebar", 1000);
  assert.equal(grown.panes["primary-sidebar"], layout.PANE_LIMITS["primary-sidebar"].max);
  assert.equal(layout.SPLITTER_STEPS.small, 16);
  assert.equal(layout.SPLITTER_STEPS.large, 64);
  const reset = layout.resetLayout();
  assert.deepEqual(
    Object.fromEntries(Object.entries(reset.panes).sort()),
    Object.fromEntries(Object.entries(layout.PRESETS.team).sort()),
  );
  assert.equal(reset.preset, "team");
});

test("S28-WP01 named Focus/Build/Review/Team presets apply clamped", () => {
  for (const preset of ["focus", "build", "review", "team"]) {
    const applied = layout.applyPreset(layout.DEFAULT_LAYOUT, preset);
    assert.equal(applied.preset, preset);
    for (const [paneId, width] of Object.entries(applied.panes)) {
      const limits = layout.PANE_LIMITS[paneId];
      assert.ok(width >= limits.min && (limits.max === null || width <= limits.max), `${preset}/${paneId} in bounds`);
    }
  }
  assert.throws(() => layout.applyPreset(layout.DEFAULT_LAYOUT, "chaos"), /unknown_preset/);
});

test("S28-WP01 layout receipt binds workspace, task, realm and revision", () => {
  const receipt = layout.layoutReceipt(
    layout.applyPreset(layout.DEFAULT_LAYOUT, "review"),
    { workspaceId: "ws-1", taskId: "task-9", realmId: "production" },
    "rev-abc",
    1234,
  );
  assert.equal(receipt.workspaceId, "ws-1");
  assert.equal(receipt.taskId, "task-9");
  assert.equal(receipt.realmId, "production");
  assert.equal(receipt.revision, "rev-abc");
  assert.equal(receipt.preset, "review");
  assert.equal(receipt.formatVersion, layout.LAYOUT_FORMAT_VERSION);
  assert.ok(Object.isFrozen(receipt));
});

test("S28-WP01 theme tokens carry light/dark/high-contrast and reduced motion", () => {
  for (const [token, values] of Object.entries(layout.THEME_TOKENS)) {
    for (const theme of ["light", "dark", "highContrast"]) {
      assert.ok(typeof values[theme] === "string" && values[theme].startsWith("#"), `${token}.${theme} defined`);
    }
  }
  assert.equal(layout.REDUCED_MOTION.splitterAnimation, "none");
  assert.equal(layout.REDUCED_MOTION.presetTransition, "none");
});

test("S28-WP02 navigation store keeps stable IDs and incremental revisions", () => {
  const store = new navigation.NavigationStore();
  store.applySnapshot(
    [
      { id: "t-1", kind: "task", label: "One", state: "ready" },
      { id: "t-2", kind: "task", label: "Two", state: "waiting" },
    ],
    { workspaceOpened: true, connected: true },
  );
  const before = store.revision;
  store.applyDelta({ upserts: [{ id: "t-3", kind: "task", label: "Three", state: "ready" }] });
  assert.ok(store.revision > before, "delta bumps revision");
  const nodes = store.treeNodes("saber.tasks");
  assert.deepEqual(
    nodes.map((node) => node.id),
    ["t-1", "t-2", "t-3"],
  );
  assert.equal(nodes[0].contextValue, "saber-task--ready");
  store.applyDelta({ removals: ["t-2"] });
  assert.equal(store.nodesFor("saber.tasks").length, 2);
});

test("S28-WP02 view states cover the nine-state contract", () => {
  assert.deepEqual(
    [...navigation.NAV_STATES],
    ["first-run", "no-repository", "loading", "empty", "ready", "waiting", "failed", "archived", "offline"],
  );
  for (const state of navigation.NAV_STATES) {
    assert.ok(Array.isArray(navigation.TRANSITIONS[state]), `transitions for ${state}`);
  }
  const store = new navigation.NavigationStore();
  store.applySnapshot([], { workspaceOpened: false, connected: true });
  assert.equal(store.viewState("saber.tasks"), "first-run");
  store.applySnapshot([], { workspaceOpened: true, connected: true });
  assert.equal(store.viewState("saber.tasks"), "empty");
  store.setConnected(false);
  assert.equal(store.viewState("saber.tasks"), "offline");
  store.setConnected(true);
  store.applySnapshot([{ id: "t-1", kind: "task", label: "One", state: "failed" }], {
    workspaceOpened: true,
    connected: true,
  });
  assert.equal(store.viewState("saber.tasks"), "failed");
});

test("S28-WP02 selection and pins are local; archived sort last", () => {
  const store = new navigation.NavigationStore();
  store.applySnapshot(
    [
      { id: "t-1", kind: "task", label: "Active", state: "ready" },
      { id: "t-2", kind: "task", label: "Done", state: "archived" },
      { id: "t-3", kind: "task", label: "Pinned", state: "ready" },
    ],
    { workspaceOpened: true, connected: true },
  );
  store.select("t-1");
  assert.equal(store.selection, "t-1");
  assert.equal(store.nodesFor("saber.tasks").length, 3, "selection never mutates nodes");
  store.togglePin("t-3");
  assert.deepEqual(
    store.treeNodes("saber.tasks").map((node) => node.id),
    ["t-3", "t-1", "t-2"],
  );
  assert.ok(store.isPinned("t-3"));
  store.applyDelta({ removals: ["t-1"] });
  assert.equal(store.selection, null, "removed selection clears locally");
});

test("S28-WP02 context menus expose only valid transitions", () => {
  const store = new navigation.NavigationStore();
  store.applySnapshot(
    [
      { id: "t-1", kind: "task", label: "Ready", state: "ready" },
      { id: "t-2", kind: "task", label: "Archived", state: "archived" },
      { id: "t-3", kind: "task", label: "Loading", state: "loading" },
    ],
    { workspaceOpened: true, connected: true },
  );
  assert.ok(store.allowsTransition("t-1", "archive-task"));
  assert.equal(store.allowsTransition("t-1", "restore-task"), false);
  assert.ok(store.allowsTransition("t-2", "restore-task"));
  assert.deepEqual(store.validTransitions("t-3"), [], "loading exposes no transitions");
  // Every shipped context-menu entry must match the transition matrix.
  const items = manifest.contributes.menus["view/item/context"];
  assert.ok(items.length > 0);
  const transitionCommands = {
    "saber.workbench.selectTask": "open-task",
    "saber.workbench.pinTask": "pin-task",
    "saber.workbench.archiveTask": "archive-task",
    "saber.workbench.restoreTask": "restore-task",
    "saber.workbench.retry": "retry",
    "saber.workbench.reconnect": "reconnect",
  };
  for (const item of items) {
    const transition = transitionCommands[item.command];
    assert.ok(transition, `${item.command} maps to a matrix transition`);
    assert.ok(
      Object.values(navigation.TRANSITIONS).some((list) => list.includes(transition)),
      `${transition} is valid in the matrix`,
    );
    assert.match(item.when, /viewItem/, `${item.command} gated on viewItem state`);
  }
});

test("S28-WP02 saved views, search and queries are projections", () => {
  assert.deepEqual(Object.keys(navigation.SAVED_VIEWS).sort(), ["group", "timeline", "workspace"]);
  const store = new navigation.NavigationStore();
  store.applySnapshot([{ id: "t-1", kind: "task", label: "Workbench shell", state: "ready" }], {
    workspaceOpened: true,
    connected: true,
  });
  assert.equal(store.matchesQuery("t-1", "workbench"), true);
  assert.equal(store.matchesQuery("t-1", "zzz"), false);
  store.saveQuery("saber.tasks", "workbench");
  assert.equal(store.savedQuery("saber.tasks"), "workbench");
});

test("S28-WP03 identity gating fails closed without complete identity", () => {
  assert.equal(identity.isComplete(identity.MANUAL_IDENTITY), false);
  assert.match(identity.describeIdentity(identity.MANUAL_IDENTITY), /Manual edit/);
  const full = { taskId: "T-1", runId: "R-1", worktreeId: "W-1", realmId: "production" };
  assert.equal(identity.isComplete(full), true);
  assert.match(identity.describeIdentity(full), /Task T-1.*Run R-1.*Worktree W-1.*Realm production/);
  assert.equal(identity.assertDestructiveAllowed(identity.MANUAL_IDENTITY, "run.execute").allowed, false);
  assert.equal(identity.assertDestructiveAllowed({ taskId: "T-1" }, "terminal.command").reason, "missing-identity");
  assert.deepEqual(identity.assertDestructiveAllowed({ taskId: "T-1" }, "terminal.command").missing, [
    "runId",
    "worktreeId",
    "realmId",
  ]);
  assert.equal(identity.assertDestructiveAllowed(full, "not-an-action").reason, "unknown-action");
  assert.equal(identity.assertDestructiveAllowed(full, "run.execute").allowed, true);
});

test("S28-WP03 revision binding reports mismatches instead of hiding them", () => {
  assert.equal(identity.revisionBinding(identity.MANUAL_IDENTITY, "rev").reason, "manual-identity");
  assert.equal(identity.revisionBinding({ taskId: "T-1" }, "rev").reason, "missing-identity");
  assert.equal(
    identity.revisionBinding({ taskId: "T", runId: "R", worktreeId: "W", realmId: "p" }, "").reason,
    "missing-revision",
  );
  const bound = identity.revisionBinding({ taskId: "T", runId: "R", worktreeId: "W", realmId: "p" }, "rev-1");
  assert.equal(bound.bound, true);
  assert.equal(bound.revision, "rev-1");
});

test("S28-WP04 fixtures carry provenance; Command Center is secondary", () => {
  for (const fixture of [
    workspace.conversationFixture(),
    workspace.planFixture(),
    workspace.evidenceFixture(),
    workspace.vitalBarFixture(),
  ]) {
    assert.deepEqual(fixture.provenance, workspace.FIXTURE_PROVENANCE);
    assert.equal(fixture.provenance.authoritative, false);
  }
  const evidence = workspace.evidenceFixture();
  assert.ok(evidence.events.every((event) => typeof event.sequence === "number" && typeof event.type === "string"));
  assert.equal(workspace.COMMAND_CENTER.placement, "secondary-sidebar");
  assert.equal(workspace.COMMAND_CENTER.defaultStartupRoute, false);
  assert.equal(workspace.SPECIFICATION_STUDIO.executesSpecifications, false);
  const walkthrough = workspace.walkthroughPlan();
  assert.equal(walkthrough.remoteContent, false);
  assert.ok(walkthrough.steps.length >= 3);
  const serialized = JSON.stringify(walkthrough);
  assert.equal(/https?:\/\//.test(serialized), false, "walkthrough carries no remote content");
});

test("S28-WP05 layout persistence round-trips through dedicated keys", () => {
  const saved = persistence.serializeLayout(
    layout.applyPreset(layout.DEFAULT_LAYOUT, "review"),
    { workspaceId: "ws-1", worktreeId: "wt-1", realmId: "p" },
    99,
  );
  const restored = persistence.restoreLayout(saved, {
    currentIdentity: { workspaceId: "ws-1", worktreeId: "wt-1", realmId: "p" },
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.layout.preset, "review");
  assert.deepEqual(persistence.OWNED_STORAGE_KEYS, [
    persistence.LAYOUT_STORAGE_KEY,
    persistence.LAYOUT_IDENTITY_STORAGE_KEY,
  ]);
  assert.ok(!persistence.LAYOUT_STORAGE_KEY.includes("run"), "layout key never masquerades as run data");
});

test("S28-WP05 corrupt, mismatched and unavailable layouts recover safely", () => {
  const fallback = persistence.restoreLayout("{not json", {});
  assert.equal(fallback.ok, false);
  assert.equal(fallback.reason, "corrupt");
  assert.equal(fallback.layout.preset, "team", "corrupt layout falls back to the default lattice");
  const future = persistence
    .serializeLayout(layout.DEFAULT_LAYOUT, { workspaceId: "ws-1", worktreeId: "wt-1", realmId: "p" }, 1)
    .replace('"formatVersion":1', '"formatVersion":99');
  assert.equal(
    persistence.restoreLayout(future, { currentIdentity: { workspaceId: "ws-1", worktreeId: "wt-1", realmId: "p" } })
      .reason,
    "version-unsupported",
  );
  const otherWindow = persistence.restoreLayout(
    persistence.serializeLayout(layout.DEFAULT_LAYOUT, { workspaceId: "ws-1", worktreeId: "wt-1", realmId: "p" }, 1),
    { currentIdentity: { workspaceId: "ws-2", worktreeId: "wt-1", realmId: "p" } },
  );
  assert.equal(otherWindow.reason, "identity-mismatch", "a saved layout can never switch Worktree/Realm silently");
  const partial = persistence.restoreLayout(
    persistence.serializeLayout(layout.DEFAULT_LAYOUT, { workspaceId: null, worktreeId: null, realmId: null }, 1),
    {
      currentIdentity: { workspaceId: null, worktreeId: null, realmId: null },
      availablePanes: ["primary-sidebar", "agent-pane"],
    },
  );
  assert.equal(partial.ok, true);
  assert.ok(partial.replaced.some((pane) => pane.paneId === "evidence-drawer" && pane.kind === "placeholder"));
});

test("S28 manifest contributes the native shell without any webview", () => {
  assert.equal(manifest.contributes.viewsContainers.activitybar.length, 1);
  const activityViews = manifest.contributes.views["saber-workbench"].map((view) => view.id);
  assert.deepEqual(activityViews, [
    "saber.projects",
    "saber.goals",
    "saber.tasks",
    "saber.conversations",
    "saber.runs",
  ]);
  assert.deepEqual(
    manifest.contributes.views["saber-evidence-panel"].map((view) => view.id),
    ["saber.evidence"],
  );
  assert.deepEqual(
    manifest.contributes.views["saber-secondary"].map((view) => view.id),
    ["saber.commandCenter"],
  );
  assert.equal(manifest.contributes.viewsContainers.secondarySidebar[0].id, "saber-secondary");
  assert.ok(!JSON.stringify(manifest).includes('"webview"'), "native contributions only");
  for (const command of manifest.contributes.commands) {
    assert.ok(command.command.startsWith("saber."), `command namespace: ${command.command}`);
  }
});

test("S28 manifest keybindings cover the keyboard path and splitter steps", () => {
  const keybindings = manifest.contributes.keybindings;
  const pathCommands = [
    "saber.workbench.openRepository",
    "saber.workbench.selectTask",
    "saber.workbench.focusConversation",
    "saber.workbench.focusEditor",
    "saber.workbench.openTerminal",
    "saber.workbench.openEvidence",
    "saber.workbench.returnFocus",
  ];
  for (const command of pathCommands) {
    assert.ok(
      keybindings.some((binding) => binding.command === command),
      `keybinding for ${command}`,
    );
  }
  const splitterBindings = keybindings.filter((binding) => binding.command === "saber.workbench.layout.moveSplitter");
  assert.ok(splitterBindings.length >= 6);
  for (const binding of splitterBindings) {
    assert.ok(binding.args.pane in layout.PANE_LIMITS, `splitter pane ${binding.args.pane} exists`);
    assert.ok(Number.isInteger(binding.args.delta) && binding.args.delta !== 0);
  }
});
