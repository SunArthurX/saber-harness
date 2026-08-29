/**
 * S28-WP04 — agent workspace placeholders over fixture ViewModels.
 *
 * The central agent pane hosts Conversation and Plan placeholders backed
 * by clearly-labeled fixture ViewModels; the Evidence drawer and Vital
 * Bar render fixture data in the same shapes the S27 supervision client
 * produces (lifecycle state, core.health, cursor replay). No agent
 * execution happens here and nothing is authoritative: every fixture
 * carries frozen provenance so any surface can state honestly where its
 * data came from. The Command Center stays a user-selected secondary
 * view — absent from the default startup route — and the first-run
 * walkthrough opens/creates a Workspace and Goal with zero remote or
 * marketing content (CDX-07, CLD-02, ZCD-04, ZED-03, KIR-03, OHD-03,
 * KIR-01 reserves the Specification Studio route without executing it).
 */

/** Frozen provenance stamped on every fixture ViewModel. */
const FIXTURE_PROVENANCE = Object.freeze({
  fixture: true,
  source: "s28-workbench-fixtures",
  authoritative: false,
});

/** Conversation placeholder messages (S28-WP04). */
function conversationFixture() {
  return Object.freeze({
    provenance: FIXTURE_PROVENANCE,
    title: "Conversation",
    messages: Object.freeze([
      Object.freeze({ role: "user", text: "Summarize this repository (fixture preview).", atMs: 0 }),
      Object.freeze({
        role: "agent",
        text: "No Core connection in this preview — this card is a labeled fixture, not agent output.",
        atMs: 1,
      }),
    ]),
  });
}

/** Plan placeholder steps (S28-WP04; a projection, never a spec engine). */
function planFixture() {
  return Object.freeze({
    provenance: FIXTURE_PROVENANCE,
    title: "Plan",
    steps: Object.freeze([
      Object.freeze({ id: "plan-1", title: "Open a repository", status: "proposed" }),
      Object.freeze({ id: "plan-2", title: "Create a Goal", status: "proposed" }),
      Object.freeze({ id: "plan-3", title: "Review the run contract", status: "proposed" }),
    ]),
  });
}

/** Evidence drawer cards in the replay event shape (S27 cursor semantics). */
function evidenceFixture() {
  return Object.freeze({
    provenance: FIXTURE_PROVENANCE,
    events: Object.freeze([
      Object.freeze({ sequence: 1, type: "run.started", payload: { fixture: true } }),
      Object.freeze({ sequence: 2, type: "supervision.handshake_rejected", payload: { fixture: true } }),
      Object.freeze({ sequence: 3, type: "run.completed", payload: { fixture: true } }),
    ]),
    replay: Object.freeze({ cursor: 3, hasMore: false }),
  });
}

/**
 * Vital Bar fixture in S27 shapes: a ten-state lifecycle value, a
 * core.health result and a replay cursor. Rendered by the native status
 * bar; state changes announce politely without streaming noise (S28-WP06).
 */
function vitalBarFixture() {
  return Object.freeze({
    provenance: FIXTURE_PROVENANCE,
    lifecycle: "ready",
    health: Object.freeze({ ok: true, detail: "fixture" }),
    replay: Object.freeze({ cursor: 3, hasMore: false }),
  });
}

/**
 * Command Center is a user-selected secondary view: it lives in the
 * secondary sidebar, never in the activity bar, and is absent from the
 * default startup route (verified by the S28 startup assertion).
 */
const COMMAND_CENTER = Object.freeze({
  viewId: "saber.commandCenter",
  placement: "secondary-sidebar",
  defaultStartupRoute: false,
});

/**
 * Specification Studio route reservation (KIR-01): S28 supplies the
 * accessible shell link; authoritative spec execution lands later.
 */
const SPECIFICATION_STUDIO = Object.freeze({
  routeId: "saber.specificationStudio",
  reserved: true,
  executesSpecifications: false,
});

/**
 * First-run walkthrough: opens/creates a Workspace and a Goal using only
 * local commands — no remote, marketing or telemetry content (S28-WP04).
 */
const WALKTHROUGH_STEPS = Object.freeze([
  Object.freeze({
    id: "open-workspace",
    title: "Open or create a Workspace",
    command: "saber.workbench.openRepository",
  }),
  Object.freeze({ id: "open-goal-view", title: "Open the Goals view", command: "saber.workbench.focusGoals" }),
  Object.freeze({ id: "create-goal", title: "Create your first Goal", command: "saber.workbench.createGoal" }),
  Object.freeze({
    id: "open-conversation",
    title: "Focus the Conversation pane",
    command: "saber.workbench.focusConversation",
  }),
]);

/** Walkthrough plan with provenance and an explicit no-remote guarantee. */
function walkthroughPlan() {
  return Object.freeze({
    provenance: FIXTURE_PROVENANCE,
    steps: WALKTHROUGH_STEPS,
    remoteContent: false,
  });
}

module.exports = {
  COMMAND_CENTER,
  FIXTURE_PROVENANCE,
  SPECIFICATION_STUDIO,
  WALKTHROUGH_STEPS,
  conversationFixture,
  evidenceFixture,
  planFixture,
  vitalBarFixture,
  walkthroughPlan,
};
