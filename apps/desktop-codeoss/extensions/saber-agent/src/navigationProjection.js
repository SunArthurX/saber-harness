/**
 * S28-WP02 — navigation projections over a pure replayable store.
 *
 * Projects Core-owned Projects, Goals, Tasks, Conversations and
 * background Runs into native tree nodes with stable IDs and incremental
 * updates (ZCD-01, ZED-01). The store never mutates Core state: selection,
 * expansion, pins and scroll positions are local non-authoritative state,
 * and context menus can only expose transitions the projection state
 * machine declares valid for the node's state — selection alone never
 * triggers an effect (CDX-01, ZCD-03).
 */

/** Aggregate view states (S28-WP02). */
const NAV_STATES = Object.freeze([
  "first-run",
  "no-repository",
  "loading",
  "empty",
  "ready",
  "waiting",
  "failed",
  "archived",
  "offline",
]);

/** Valid transitions per state — context menus expose exactly these. */
const TRANSITIONS = Object.freeze({
  "first-run": Object.freeze(["open-workspace"]),
  "no-repository": Object.freeze(["open-folder", "clone-repository"]),
  loading: Object.freeze([]),
  empty: Object.freeze(["create-goal", "create-task"]),
  ready: Object.freeze(["open-task", "pin-task", "archive-task", "search-tasks"]),
  waiting: Object.freeze(["cancel-wait", "retry"]),
  failed: Object.freeze(["retry", "show-diagnostics", "archive-task"]),
  archived: Object.freeze(["restore-task"]),
  offline: Object.freeze(["reconnect", "show-diagnostics"]),
});

/** Tree views and the node kinds they project. */
const NAV_VIEWS = Object.freeze({
  "saber.projects": Object.freeze(["project"]),
  "saber.goals": Object.freeze(["goal"]),
  "saber.tasks": Object.freeze(["task"]),
  "saber.conversations": Object.freeze(["conversation"]),
  "saber.runs": Object.freeze(["run"]),
});

/** Saved group/workspace/timeline views (ZCD-03). */
const SAVED_VIEWS = Object.freeze({
  group: Object.freeze({ id: "saved:group", label: "By group", groupBy: "parentId" }),
  workspace: Object.freeze({ id: "saved:workspace", label: "By workspace", groupBy: "workspaceId" }),
  timeline: Object.freeze({ id: "saved:timeline", label: "By timeline", groupBy: "lastActivityMs" }),
});

/** Node kinds and their display labels. */
const KIND_LABELS = Object.freeze({
  project: "Project",
  goal: "Goal",
  task: "Task",
  conversation: "Conversation",
  run: "Run",
});

/**
 * NavigationStore: an in-memory projection fed by snapshots/deltas from
 * the Core side. Every mutation is an id-addressed upsert/remove that
 * bumps a monotonic revision so tree providers can refresh incrementally.
 */
class NavigationStore {
  #nodes = new Map();
  #selection = null;
  #expansion = new Set();
  #pins = new Set();
  #queries = new Map();
  #revision = 0;
  #workspaceOpened = false;
  #connected = true;

  /** Apply a snapshot (replace-all) — used on first projection. */
  applySnapshot(records, options = {}) {
    this.#nodes = new Map();
    for (const record of records) {
      this.#upsert(record);
    }
    this.#workspaceOpened = options.workspaceOpened ?? this.#workspaceOpened;
    this.#connected = options.connected ?? this.#connected;
    this.#revision += 1;
  }

  /** Apply an incremental delta of upserts/removals by stable ID. */
  applyDelta({ upserts = [], removals = [] } = {}) {
    for (const record of upserts) {
      this.#upsert(record);
    }
    for (const id of removals) {
      if (this.#nodes.delete(id)) {
        if (this.#selection === id) {
          this.#selection = null; // selection is local, never blocking removal
        }
        this.#pins.delete(id);
      }
    }
    this.#revision += 1;
  }

  #upsert(record) {
    if (!record || typeof record.id !== "string" || !KIND_LABELS[record.kind]) {
      throw new Error("invalid_navigation_record");
    }
    this.#nodes.set(
      record.id,
      Object.freeze({
        id: record.id,
        kind: record.kind,
        label: String(record.label ?? record.id),
        state: NAV_STATES.includes(record.state) ? record.state : "loading",
        parentId: record.parentId ?? null,
        workspaceId: record.workspaceId ?? null,
        lastActivityMs: record.lastActivityMs ?? 0,
        sequence: record.sequence ?? 0,
        archivedAtMs: record.archivedAtMs ?? null,
      }),
    );
  }

  /** Monotonic projection revision — providers refresh when it changes. */
  get revision() {
    return this.#revision;
  }

  /** Mark the projection offline/online (transport lifecycle, S27). */
  setConnected(connected) {
    this.#connected = connected;
    this.#revision += 1;
  }

  /** Aggregate state of a view (first run, no repository, offline, ...). */
  viewState(view) {
    if (!this.#connected) {
      return "offline";
    }
    if (!this.#workspaceOpened) {
      return "first-run";
    }
    const nodes = this.nodesFor(view);
    const active = nodes.filter((node) => node.state !== "archived");
    if (nodes.length > 0 && active.length === 0) {
      return "archived";
    }
    if (nodes.length === 0) {
      return "empty";
    }
    if (nodes.some((node) => node.state === "failed")) {
      return "failed";
    }
    if (nodes.every((node) => node.state === "waiting")) {
      return "waiting";
    }
    return "ready";
  }

  /** Nodes of a view in stable order: pinned first, archived last. */
  nodesFor(view) {
    const kinds = NAV_VIEWS[view];
    if (!kinds) {
      throw new Error(`unknown_view:${view}`);
    }
    return [...this.#nodes.values()]
      .filter((node) => kinds.includes(node.kind))
      .sort((a, b) => this.#order(a) - this.#order(b) || a.id.localeCompare(b.id));
  }

  #order(node) {
    if (this.#pins.has(node.id)) {
      return 0;
    }
    return node.state === "archived" ? 2 : 1;
  }

  /** Provider-agnostic tree descriptors with stable IDs and context values. */
  treeNodes(view) {
    return this.nodesFor(view).map((node) => ({
      id: node.id,
      label: node.label,
      collapsibleState: this.#expansion.has(node.id) ? "expanded" : "collapsed",
      contextValue: `saber-${node.kind}--${node.state}`,
      pinned: this.#pins.has(node.id),
    }));
  }

  /** Local selection — records intent, performs no effect. */
  select(id) {
    if (id !== null && !this.#nodes.has(id)) {
      throw new Error(`unknown_node:${id}`);
    }
    this.#selection = id;
    return this.#selection;
  }

  get selection() {
    return this.#selection;
  }

  /** Local expansion persistence (non-authoritative). */
  setExpanded(id, expanded) {
    if (expanded) {
      this.#expansion.add(id);
    } else {
      this.#expansion.delete(id);
    }
  }

  /** Local pin toggle — ordering only, never a Core mutation. */
  togglePin(id) {
    if (!this.#nodes.has(id)) {
      throw new Error(`unknown_node:${id}`);
    }
    if (this.#pins.has(id)) {
      this.#pins.delete(id);
      return false;
    }
    this.#pins.add(id);
    return true;
  }

  isPinned(id) {
    return this.#pins.has(id);
  }

  /** Valid transitions for a node — context menus expose exactly these. */
  validTransitions(id) {
    const node = this.#nodes.get(id);
    if (!node) {
      return [];
    }
    return [...TRANSITIONS[node.state]];
  }

  /** True when a transition is legal for the node state (gate for menus). */
  allowsTransition(id, transition) {
    return this.validTransitions(id).includes(transition);
  }

  /** Saved-view grouping descriptor (ZCD-03). */
  static savedView(id) {
    return SAVED_VIEWS[id] ?? null;
  }

  /** Search over labels and saved-query persistence (ZCD-03). */
  matchesQuery(id, query) {
    const node = this.#nodes.get(id);
    if (!node) {
      return false;
    }
    const needle = String(query ?? "").toLowerCase();
    return needle === "" || node.label.toLowerCase().includes(needle);
  }

  saveQuery(view, query) {
    this.#queries.set(view, query);
    this.#revision += 1;
  }

  savedQuery(view) {
    return this.#queries.get(view) ?? "";
  }
}

module.exports = {
  KIND_LABELS,
  NAV_STATES,
  NAV_VIEWS,
  SAVED_VIEWS,
  TRANSITIONS,
  NavigationStore,
};
