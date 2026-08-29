/**
 * Saber Agent Workbench — desktop workbench shell (S28).
 *
 * Native Code-OSS contribution points only: five navigation tree views
 * (Projects, Goals, Tasks, Conversations, Runs) projected from a pure
 * NavigationStore over clearly-labeled fixtures, an Evidence drawer in
 * the bottom panel, a user-selected secondary Command Center, a Vital
 * Bar status item, the full keyboard path, layout presets and versioned
 * layout persistence. There is no webview, no agent execution and no
 * Core connection yet: every card is marked as a fixture, identity is
 * manual until the Core binds Task/Run/Worktree/Realm to real runs
 * (S28-WP03), and navigation never mutates Core state — only explicit
 * user commands touch the local projection. This extension remains a
 * disposable projection (ZED-01): Goal, Task, Run, policy, secret and
 * execution authority stays in the trusted Rust Core.
 */
const vscode = require("vscode");

const { NavigationStore, NAV_VIEWS } = require("./navigationProjection.js");
const { PRESETS, applyPreset, layoutReceipt, moveSplitter, resetLayout } = require("./workbenchLayout.js");
const { MANUAL_IDENTITY, describeIdentity } = require("./identityContext.js");
const {
  COMMAND_CENTER,
  SPECIFICATION_STUDIO,
  conversationFixture,
  evidenceFixture,
  vitalBarFixture,
  walkthroughPlan,
} = require("./agentWorkspace.js");
const {
  LAYOUT_IDENTITY_STORAGE_KEY,
  LAYOUT_STORAGE_KEY,
  restoreLayout,
  serializeLayout,
} = require("./layoutPersistence.js");
const { ConversationStream } = require("./conversationModel.js");
const { ContextPreview } = require("./contextReceipt.js");
const { FIXTURE_PROVENANCE } = require("./agentWorkspace.js");

const WORKBENCH_SCHEME = "saber-workbench";
const NOT_CONNECTED = "not-connected";

/** Fixture seed for the projection (labeled, non-authoritative). */
function seedStore() {
  const store = new NavigationStore();
  store.applySnapshot(
    [
      { id: "project-basic", kind: "project", label: "basic (fixture)", state: "ready", workspaceId: "ws-fixture" },
      {
        id: "goal-first",
        kind: "goal",
        label: "Ship the workbench shell (fixture)",
        state: "ready",
        parentId: "project-basic",
      },
      {
        id: "task-shell",
        kind: "task",
        label: "S28 workbench shell (fixture)",
        state: "ready",
        parentId: "goal-first",
      },
      {
        id: "task-a11y",
        kind: "task",
        label: "Accessibility review (fixture)",
        state: "waiting",
        parentId: "goal-first",
      },
      { id: "task-done", kind: "task", label: "Lattice tokens (fixture)", state: "archived", parentId: "goal-first" },
      {
        id: "conv-1",
        kind: "conversation",
        label: "Conversation — workbench (fixture)",
        state: "ready",
        parentId: "task-shell",
      },
      { id: "run-1", kind: "run", label: "Background run (fixture)", state: "failed", parentId: "task-shell" },
    ],
    { workspaceOpened: true, connected: false },
  );
  return store;
}

/** A tree view bound to one NavigationStore view id (S28-WP02). */
class ProjectionTree {
  #store;
  #view;
  #emitter;

  constructor(store, view) {
    this.#store = store;
    this.#view = view;
    this.#emitter = new vscode.EventEmitter();
  }

  get onDidChangeTreeData() {
    return this.#emitter.event;
  }

  refresh() {
    this.#emitter.fire(undefined);
  }

  getTreeItem(element) {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.id; // stable ID across refreshes (S28-WP02)
    item.contextValue = element.contextValue;
    item.description = element.pinned ? vscode.l10n.t("pinned") : undefined;
    item.tooltip = `${element.id} · ${element.contextValue}`;
    return item;
  }

  getChildren() {
    return this.#store.treeNodes(this.#view);
  }
}

/** One fixture-backed flat provider for Evidence / Command Center views. */
function flatProvider(rows) {
  const emitter = new vscode.EventEmitter();
  return {
    onDidChangeTreeData: emitter.event,
    getTreeItem: (element) => {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.id = element.id;
      item.description = element.description;
      item.contextValue = element.contextValue;
      return item;
    },
    getChildren: () => rows(),
  };
}

function activate(context) {
  const store = seedStore();
  const currentLayout = { layout: resetLayout() };

  // Navigation projections (S28-WP02): selection is local intent only.
  for (const view of Object.keys(NAV_VIEWS)) {
    const projection = new ProjectionTree(store, view);
    const tree = vscode.window.createTreeView(view, { treeDataProvider: projection });
    tree.onDidChangeSelection((event) => {
      const first = event.selection[0];
      if (first?.id) {
        store.select(first.id); // records intent — no effect, no Core mutation
      }
    });
    context.subscriptions.push(tree);
  }

  // Evidence drawer (bottom panel) and Command Center (secondary sidebar).
  const evidence = evidenceFixture();
  context.subscriptions.push(
    vscode.window.createTreeView("saber.evidence", {
      treeDataProvider: flatProvider(() =>
        evidence.events.map((event) => ({
          id: `evidence-${event.sequence}`,
          label: `#${event.sequence} ${event.type}`,
          description: vscode.l10n.t("fixture"),
          contextValue: "saber-evidence--fixture",
        })),
      ),
    }),
    vscode.window.createTreeView(COMMAND_CENTER.viewId, {
      treeDataProvider: flatProvider(() => [
        {
          id: "cc-conversations",
          label: vscode.l10n.t("Conversations (fixture)"),
          description: undefined,
          contextValue: "saber-command-center",
        },
        {
          id: "cc-specification",
          label: vscode.l10n.t("Specification Studio (reserved)"),
          description: undefined,
          contextValue: "saber-command-center",
        },
      ]),
    }),
  );

  // Vital Bar (S28-WP04): polite state announcements, no streaming noise.
  const vital = vitalBarFixture();
  const vitalBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  vitalBar.name = "Saber Vital Bar";
  vitalBar.text = `Saber: ${vital.lifecycle} (${vscode.l10n.t("fixture")})`;
  vitalBar.tooltip = vscode.l10n.t(
    "Saber Vital Bar (fixture preview; core.health and replay come from the supervision transport)",
  );
  vitalBar.command = "saber.workbench.status";
  vitalBar.show();
  context.subscriptions.push(vitalBar);

  // Identity header for the active surface (S28-WP03): manual until the
  // Core binds Task/Run/Worktree/Realm to real runs.
  const identityBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  identityBar.name = "Saber Identity";
  const identityText = describeIdentity(MANUAL_IDENTITY);
  const syncIdentity = () => {
    identityBar.text = identityText;
    identityBar.tooltip = vscode.l10n.t(
      "Agent identity binds to Task, Run, Worktree and Realm when a governed run is active",
    );
    identityBar.show();
  };
  syncIdentity();
  context.subscriptions.push(identityBar, vscode.window.onDidChangeActiveTextEditor(syncIdentity));

  // Placeholder documents: Conversation, Plan, Specification Studio (KIR-01).
  const provider = {
    provideTextDocumentContent: (uri) => {
      if (uri.path === "/conversation") {
        const fixture = conversationFixture();
        return [
          `# ${fixture.title} (${vscode.l10n.t("fixture")})`,
          "",
          ...fixture.messages.map((message) => `- **${message.role}**: ${message.text}`),
          "",
          "This card is a labeled fixture ViewModel, not agent output.",
        ].join("\n");
      }
      if (uri.path === "/specification-studio") {
        return [
          `# Specification Studio (${vscode.l10n.t("reserved")})`,
          "",
          `route: ${SPECIFICATION_STUDIO.routeId}`,
          `executes specifications: ${SPECIFICATION_STUDIO.executesSpecifications}`,
          "",
          "S28 reserves the accessible route linked to Goal/Task identity;",
          "authoritative specification execution lands in a later segment.",
        ].join("\n");
      }
      return [
        "Saber Studio — Desktop Agent Workbench (engineering preview)",
        "",
        "Three-zone lattice: navigation, central agent pane, native editor.",
        "Goal / Task / Run / Realm identities are owned by the trusted",
        "Rust Core and are only projected into this workbench.",
        "All cards in this preview are labeled fixtures; nothing here",
        "executes commands, reads secrets or mutates Core state.",
      ].join("\n");
    },
  };
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(WORKBENCH_SCHEME, provider));

  const openPlaceholder = async (path, column) => {
    const document = await vscode.workspace.openTextDocument({ scheme: WORKBENCH_SCHEME, path });
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: column });
  };

  // Layout persistence (S28-WP05) — dedicated keys only, never run data.
  const persistLayout = (layout, nowMs = Date.now()) => {
    currentLayout.layout = layout;
    void context.workspaceState.update(
      LAYOUT_STORAGE_KEY,
      serializeLayout(layout, { workspaceId: null, worktreeId: null, realmId: null }, nowMs),
    );
    void context.workspaceState.update(
      LAYOUT_IDENTITY_STORAGE_KEY,
      JSON.stringify({ workspaceId: null, worktreeId: null, realmId: null }),
    );
  };
  const stored = context.workspaceState.get(LAYOUT_STORAGE_KEY);
  if (typeof stored === "string") {
    const restored = restoreLayout(stored, { currentIdentity: { workspaceId: null, worktreeId: null, realmId: null } });
    currentLayout.layout = restored.layout; // corrupt/mismatch already fell back to default
  }

  const register = (id, handler) => context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  // Keyboard path (S28-WP06): open repository, select task, focus
  // conversation, focus editor, open terminal, open evidence, return.
  register("saber.workbench.openRepository", () => vscode.commands.executeCommand("workbench.action.files.openFolder"));
  register("saber.workbench.selectTask", async () => {
    await vscode.commands.executeCommand("saber.tasks.focus");
    const tasks = store.nodesFor("saber.tasks").filter((node) => node.state !== "archived");
    if (tasks.length > 0) {
      store.select(tasks[0].id); // selection intent only — no run started
      vscode.window.showInformationMessage(vscode.l10n.t("Task selected (projection only; no run started)"));
    }
  });
  register("saber.workbench.focusConversation", () => openPlaceholder("/conversation", vscode.ViewColumn.One));
  register("saber.workbench.focusEditor", () =>
    vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup"),
  );
  register("saber.workbench.openTerminal", () =>
    vscode.commands.executeCommand("workbench.action.terminal.toggleTerminal"),
  );
  register("saber.workbench.openEvidence", () => vscode.commands.executeCommand("saber.evidence.focus"));
  register("saber.workbench.returnFocus", () => vscode.commands.executeCommand("saber.workbench.view.focus"));
  register("saber.workbench.focusGoals", () => vscode.commands.executeCommand("saber.goals.focus"));
  register("saber.workbench.createGoal", async () => {
    const title = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Goal title (stored locally as a fixture until the Core connects)"),
    });
    if (!title) {
      return;
    }
    store.applyDelta({ upserts: [{ id: `goal-${Date.now()}`, kind: "goal", label: title, state: "ready" }] });
    vscode.window.showInformationMessage(
      vscode.l10n.t("Goal recorded as a local fixture; the authoritative Goal lives in the Core"),
    );
  });

  // First-run walkthrough (S28-WP04): local commands only, no remote content.
  register("saber.workbench.walkthrough", async () => {
    const plan = walkthroughPlan();
    const pick = await vscode.window.showQuickPick(
      plan.steps.map((step) => ({ label: step.title, description: step.command })),
      { placeHolder: vscode.l10n.t("First-run walkthrough — open a Workspace and create a Goal") },
    );
    if (pick) {
      const step = plan.steps.find((candidate) => candidate.title === pick.label);
      if (step) {
        await vscode.commands.executeCommand(step.command);
      }
    }
  });
  register("saber.workbench.specificationStudio", () =>
    openPlaceholder("/specification-studio", vscode.ViewColumn.One),
  );

  // Layout presets, reset and keyboard splitter movement (S28-WP01).
  for (const preset of Object.keys(PRESETS)) {
    register(`saber.workbench.layout.preset.${preset}`, () => {
      persistLayout(applyPreset(currentLayout.layout, preset));
      vscode.window.showInformationMessage(vscode.l10n.t(`Layout preset: ${preset}`));
    });
  }
  register("saber.workbench.layout.reset", () => {
    persistLayout(resetLayout());
    vscode.window.showInformationMessage(vscode.l10n.t("Layout reset to the default lattice"));
  });
  register("saber.workbench.layout.moveSplitter", (_uri, args) => {
    const { pane, delta } = args ?? {};
    try {
      persistLayout(moveSplitter(currentLayout.layout, pane, Number(delta) || 0));
    } catch {
      vscode.window.showErrorMessage(vscode.l10n.t("Unknown pane"));
    }
  });
  register("saber.workbench.layout.receipt", () => {
    const receipt = layoutReceipt(
      currentLayout.layout,
      { workspaceId: null, taskId: null, realmId: null },
      null,
      Date.now(),
    );
    vscode.window.showInformationMessage(vscode.l10n.t(`Layout receipt ${receipt.preset}/${receipt.safeState} issued`));
  });

  // Explicit projection commands (S28-WP02): local fixture state only.
  const allNodes = () => [
    ...store.nodesFor("saber.tasks"),
    ...store.nodesFor("saber.goals"),
    ...store.nodesFor("saber.runs"),
  ];
  const mutateProjection = (id, patch) => {
    const node = allNodes().find((candidate) => candidate.id === id);
    if (!node) {
      return;
    }
    store.applyDelta({ upserts: [{ ...node, ...patch }] });
  };
  register("saber.workbench.pinTask", (node) => store.togglePin(node?.id));
  register("saber.workbench.archiveTask", (node) =>
    mutateProjection(node?.id, { state: "archived", archivedAtMs: Date.now() }),
  );
  register("saber.workbench.restoreTask", (node) => mutateProjection(node?.id, { state: "ready", archivedAtMs: null }));
  register("saber.workbench.retry", (node) => mutateProjection(node?.id, { state: "ready" }));
  register("saber.workbench.reconnect", () => {
    store.setConnected(true);
    vscode.window.showInformationMessage(
      vscode.l10n.t("Projection reconnect requested; the supervision transport owns connection state"),
    );
  });

  // S29 — conversation and context (projections over fixture data).
  const conversation = new ConversationStream();
  conversation.ingest([
    { eventId: "fixture-1", kind: "user", atMs: 1, payload: { text: "What will be sent to the model? (fixture)" } },
    {
      eventId: "fixture-2",
      kind: "agent-summary",
      atMs: 2,
      payload: { text: "Exactly the fragments in the context preview (fixture).", evidenceRef: "run-1#3" },
    },
    {
      eventId: "fixture-3",
      kind: "tool-summary",
      atMs: 3,
      payload: { text: "read 2 files (fixture)", evidenceRef: "run-1#2" },
    },
  ]);
  const contextPreview = new ContextPreview();
  for (const fragment of [
    {
      sourceId: "src/hello.ts",
      sourceType: "file-selection",
      revision: "rev-fixture",
      reason: "user-pinned",
      trust: "high",
      sensitivity: "internal",
      tokenEstimate: 40,
      transformation: "none",
      destinationProvider: "local",
      retentionPolicy: "request-only",
    },
    {
      sourceId: "goal-first",
      sourceType: "goal",
      revision: "rev-fixture",
      reason: "active-goal",
      trust: "high",
      sensitivity: "internal",
      tokenEstimate: 25,
      transformation: "summary",
      destinationProvider: "local",
      retentionPolicy: "request-only",
    },
  ]) {
    contextPreview.add(fragment);
  }
  register("saber.conversation.focus", () => openPlaceholder("/conversation", vscode.ViewColumn.One));
  register("saber.conversation.retry", async () => {
    const messages = conversation.messages();
    const last = messages[messages.length - 1];
    if (!last) {
      return;
    }
    conversation.retry(last.eventId, `retry-${Date.now()}`, Date.now());
    vscode.window.showInformationMessage(
      vscode.l10n.t("Retry appended as a new causal event; history is never rewritten"),
    );
  });
  register("saber.conversation.previewContext", async () => {
    const totals = contextPreview.totals();
    const pick = await vscode.window.showQuickPick(
      contextPreview.fragments().map((fragment) => ({
        label: `${fragment.sourceId} (${fragment.tokenEstimate}t)`,
        description: `${fragment.sourceType} → ${fragment.destinationProvider} · ${fragment.sensitivity}`,
        sourceId: fragment.sourceId,
      })),
      {
        placeHolder: vscode.l10n.t(
          `Context preview: ${totals.fragmentCount} fragments, ${totals.tokenEstimate} tokens — exactly what the provider request will contain (fixture)`,
        ),
      },
    );
    if (pick) {
      await vscode.commands.executeCommand("saber.conversation.excludeFragment", pick.sourceId);
    }
  });
  register("saber.conversation.excludeFragment", async (sourceId) => {
    if (typeof sourceId !== "string") {
      return;
    }
    try {
      const evidence = contextPreview.exclude(sourceId, Date.now());
      vscode.window.showInformationMessage(
        vscode.l10n.t(
          `Excluded ${evidence.sourceId} before dispatch (evidence recorded; would have gone to ${evidence.wouldHaveGoneTo})`,
        ),
      );
    } catch {
      vscode.window.showErrorMessage(vscode.l10n.t("Unknown context fragment"));
    }
  });
  void FIXTURE_PROVENANCE;

  // S26 commands retained.
  register("saber.workbench.open", () => openPlaceholder("/workbench", vscode.ViewColumn.One));
  register("saber.workbench.status", () => {
    vscode.window.showInformationMessage(
      vscode.l10n.t("Saber Core: not connected (workbench shell preview; all cards are labeled fixtures)"),
    );
  });

  return { status: NOT_CONNECTED };
}

function deactivate() {
  /* trees, providers and bars are disposed via context.subscriptions */
}

module.exports = { activate, deactivate };
