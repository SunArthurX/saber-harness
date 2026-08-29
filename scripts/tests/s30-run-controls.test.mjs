/**
 * S30-WP02/WP04/WP05 — run timeline and control tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const runTimeline = await src("runTimeline.js");
const runControls = await src("runControls.js");

const EVENTS = [
  { eventId: "e1", type: "run.queued", runId: "r1", payload: {} },
  { eventId: "e2", type: "run.state_changed", runId: "r1", payload: { to: "running" } },
  {
    eventId: "e3",
    type: "run.effect_completed",
    runId: "r1",
    payload: {
      kind: "file.read",
      summary: {
        resource: "README.md",
        realm: "local",
        duration_ms: 3,
        result_digest: "dd",
        evidence_id: "intent-read",
      },
    },
  },
  { eventId: "e4", type: "run.waiting_approval", runId: "r1", payload: { card: {} } },
];

test("S30-WP02 the timeline covers all eleven UX states from six durable states", () => {
  assert.equal(runTimeline.UX_STATES.length, 11);
  assert.equal(runTimeline.DURABLE_STATES.length, 6);
  assert.equal(runTimeline.uxState("queued"), "queued");
  assert.equal(runTimeline.uxState("blocked", "waiting_approval"), "waiting-approval");
  assert.equal(runTimeline.uxState("blocked", "paused"), "paused");
  assert.equal(runTimeline.uxState("blocked", "waiting_user"), "waiting-user");
  assert.equal(runTimeline.uxState("running", "verifying"), "verifying");
  assert.equal(runTimeline.uxState("succeeded"), "succeeded");
});

test("S30-WP02 replay deduplicates and keeps causal order", () => {
  const timeline = new runTimeline.RunTimeline();
  timeline.ingest(EVENTS, "r1");
  const before = timeline.state().eventCount;
  timeline.ingest(EVENTS, "r1");
  assert.equal(timeline.state().eventCount, before, "replayed pages add nothing");
  assert.deepEqual(
    timeline.entries().map((entry) => entry.eventId),
    ["e1", "e2", "e3", "e4"],
  );
  assert.equal(timeline.state().ux, "waiting-approval");
});

test("S30-WP02 late or stale events cannot regress a terminal state", () => {
  const timeline = new runTimeline.RunTimeline();
  timeline.ingest(EVENTS, "r1");
  timeline.ingest(
    [
      { eventId: "e5", type: "run.state_changed", runId: "r1", payload: { to: "succeeded" } },
      { eventId: "e6", type: "run.state_changed", runId: "r1", payload: { to: "running" } }, // late
    ],
    "r1",
  );
  const state = timeline.state();
  assert.equal(state.ux, "succeeded");
  assert.ok(state.staleEvents.some((stale) => stale.eventId === "e6"));
  assert.equal(state.progressPercent, null, "no invented progress percentage");
});

test("S30-WP02 tool summaries state exact resource, realm, duration, digest, evidence", () => {
  const summary = runTimeline.RunTimeline.toolSummary(EVENTS[2]);
  assert.equal(summary.resource, "README.md");
  assert.equal(summary.realm, "local");
  assert.equal(summary.durationMs, 3);
  assert.equal(summary.resultDigest, "dd");
  assert.equal(summary.evidenceId, "intent-read");
});

test("S30-WP04 pause defines the next-step boundary; steer is control, not input", () => {
  assert.deepEqual(runControls.pauseBoundary([]), { boundary: "end", stepId: null });
  const boundary = runControls.pauseBoundary([{ stepId: "edit" }, { stepId: "net" }]);
  assert.deepEqual(boundary, { boundary: "next-step", stepId: "edit" });
  const nowPlacement = runControls.steerPlacement("blocked");
  assert.equal(nowPlacement.applies, "now");
  assert.equal(nowPlacement.contaminatesWorkerInput, false);
  assert.equal(runControls.steerPlacement("running").applies, "after-current-effect");
});

test("S30-WP04 cancel propagates everywhere and compensates; resume revalidates", () => {
  const propagation = runControls.cancelPropagation({ approvalId: "appr-1" });
  assert.equal(propagation.tool, "stopped");
  assert.equal(propagation.subprocess, "terminated");
  assert.equal(propagation.realm, "torn-down");
  assert.deepEqual([...propagation.compensated], ["appr-1"]);
  assert.deepEqual(runControls.cancelPropagation(null).compensated, []);
  assert.equal(runControls.resumeContract("snap-1", "snap-1").continues, true);
  assert.equal(runControls.resumeContract("snap-1", "snap-2").revalidated, false);
  const lineage = runControls.forkLineage("run-1", "run-2");
  assert.equal(lineage.merged, false);
  assert.throws(() => runControls.forkLineage("run-1", null), /lineage_requires_both_runs/);
});

test("S30-WP05 notifications fire only for user action, terminal result or incident", () => {
  assert.equal(runControls.notifies({ type: "run.effect_completed" }), false);
  assert.equal(runControls.notifies({ type: "run.steered" }), false);
  assert.equal(runControls.notifies({ type: "run.waiting_approval" }), true);
  assert.equal(runControls.notifies({ type: "run.state_changed", payload: { to: "succeeded" } }), true);
  assert.equal(runControls.notifies({ type: "run.state_changed", payload: { to: "running" } }), false);
  assert.equal(runControls.notifies({ type: "run.effect_denied_by_policy" }), true);
});

test("S30-WP05 one projection feeds every surface; success needs Core evidence", () => {
  const surfaces = runControls.projectSurfaces({ ux: "succeeded", reason: null, eventCount: 9 });
  assert.equal(surfaces.taskTree.state, "succeeded");
  assert.equal(surfaces.vitalBar.state, "succeeded");
  assert.equal(surfaces.assertsSuccess, true);
  assert.equal(runControls.projectSurfaces({ ux: "running", reason: null, eventCount: 3 }).assertsSuccess, false);
});

test("S30-WP05 closing a window never cancels a run; quit options are truthful", () => {
  const idle = runControls.quitOptions([]);
  assert.equal(idle.active, false);
  const active = runControls.quitOptions([{ runId: "r1" }]);
  assert.equal(active.active, true);
  assert.deepEqual([...active.options], ["background", "pause", "cancel"]);
  assert.match(active.consequences.cancel, /compensation/);
});
