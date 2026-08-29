/**
 * S32-WP06 — fault game day (pure matrix): every injected fault stays
 * contained, accurate and recoverable.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const delegation = await src("delegationPolicy.js");
const lifecycle = await src("worktreeLifecycle.js");
const runTimeline = await src("runTimeline.js");

const FAULTS = [
  "child-crash",
  "realm-loss",
  "runaway-budget",
  "conflicting-changes",
  "stale-base",
  "cancel-cascade",
  "malicious-subagent-result",
];

test("S32-WP06 every fault in the matrix stays contained", () => {
  for (const fault of FAULTS) {
    const contained = delegation.containFault(fault, ["sibling-1", "sibling-2"]);
    assert.equal(contained.siblingsAffected.length, 0, fault);
    assert.equal(contained.goalState, "intact", fault);
    assert.equal(contained.authorityLaundered, false, fault);
  }
});

test("S32-WP06 runaway budget pauses with evidence, never re-routes", () => {
  const exhaustion = delegation.budgetExhaustion(
    { tokens: 1000, moneyUsd: 1, wallClockMinutes: 10, toolCalls: 5 },
    { tokens: 1000, moneyUsd: 2, wallClockMinutes: 11, toolCalls: 6 },
  );
  assert.equal(exhaustion.exhausted, true);
  assert.equal(exhaustion.dimensions.length, 4);
  assert.equal(exhaustion.action, "pause");
  assert.equal(exhaustion.silentlyReroutes, false);
});

test("S32-WP06 a malicious subagent result cannot launder completion", () => {
  // A crafted 'success' event from a worker is just an observation with
  // taint: it grants nothing on its own.
  const message = delegation.crossTaskMessage({
    id: "evil",
    source: "malicious-worker",
    audience: "leader",
    taint: "agent-derived",
  });
  assert.equal(message.grantsCompletion, false);
  assert.equal(message.grantsCapability, false);
  assert.equal(message.receivingPolicy, "default-deny");
  // And terminal lock keeps the honest timeline non-regressive.
  const timeline = new runTimeline.RunTimeline();
  timeline.ingest(
    [
      { eventId: "1", type: "run.queued", runId: "leader", payload: {} },
      { eventId: "2", type: "run.state_changed", runId: "leader", payload: { to: "succeeded" } },
      { eventId: "3", type: "run.state_changed", runId: "leader", payload: { to: "failed" } },
    ],
    "leader",
  );
  assert.equal(timeline.state().ux, "succeeded");
  assert.equal(timeline.state().staleEvents.length, 1);
});

test("S32-WP06 conflicting changes surface before any merge", () => {
  const conflicts = delegation.detectConflicts([
    { childId: "w1", files: ["shared.ts"] },
    { childId: "w2", files: ["shared.ts", "only-w2.ts"] },
  ]);
  assert.equal(conflicts.conflicts, true);
  assert.ok(conflicts.overlappingFiles.includes("shared.ts"));
});

test("S32-WP06 cancel cascade quarantines without destroying evidence", () => {
  const decision = lifecycle.cleanupDecision({ unreviewedChanges: false, taskState: "terminal" });
  assert.equal(decision.action, "quarantine");
  assert.equal(decision.destructiveGitUsed, false);
  assert.match(decision.recovery, /review/);
  // Unreviewed changes block cleanup entirely — evidence outlives cancellation.
  const blocked = lifecycle.cleanupDecision({ unreviewedChanges: true, taskState: "terminal" });
  assert.equal(blocked.allowed, false);
});

test("S32-WP06 stale base is detected at worktree creation time", () => {
  const detection = lifecycle.detect({ dirtyBase: true });
  assert.ok(detection.anomalies.includes("dirty-base"));
});
