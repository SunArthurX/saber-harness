/**
 * S32-WP02/WP04 — worktree lifecycle and follow/take-over tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const lifecycle = await src("worktreeLifecycle.js");
const delegation = await src("delegationPolicy.js");

test("S32-WP02 lifecycle anomalies are detected explicitly", () => {
  const healthy = lifecycle.detect({ dirtyBase: false });
  assert.equal(healthy.healthy, true);
  const sick = lifecycle.detect({
    dirtyBase: true,
    externalDeletion: true,
    branchMoved: true,
    caseConflict: true,
    metaMissing: true,
  });
  assert.equal(sick.healthy, false);
  assert.equal(sick.anomalies.length, 5);
});

test("S32-WP02 cleanup defaults to quarantine; unreviewed changes block", () => {
  const blocked = lifecycle.cleanupDecision({ unreviewedChanges: true, taskState: "terminal" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "cleanup_blocked_unreviewed_changes");
  const notTerminal = lifecycle.cleanupDecision({ unreviewedChanges: false, taskState: "running" });
  assert.equal(notTerminal.reason, "cleanup_blocked_task_not_terminal");
  const quarantined = lifecycle.cleanupDecision({ unreviewedChanges: false, taskState: "terminal" });
  assert.equal(quarantined.action, "quarantine");
  assert.equal(quarantined.destructiveGitUsed, false);
  assert.match(quarantined.recovery, /review its change set/);
});

test("S32-WP04 take-over pauses first and verifies the worktree", () => {
  const allowed = lifecycle.takeOver("running", { healthy: true });
  assert.equal(allowed.allowed, true);
  assert.deepEqual(
    allowed.steps.map((step) => step.step),
    ["pause-agent", "verify-worktree", "grant-user-edit"],
  );
  const dirty = lifecycle.takeOver("running", { healthy: false });
  assert.equal(dirty.allowed, false);
  assert.ok(dirty.blocked.includes("verify-worktree"));
});

test("S32-WP04 realm moves create a revalidation boundary with a capability diff", () => {
  const move = lifecycle.moveBoundary(
    { capabilities: ["read.browse", "read.search"] },
    { capabilities: ["read.browse", "read.search", "exec.sandboxed"] },
  );
  assert.equal(move.revalidationRequired, true);
  assert.deepEqual([...move.capabilityDiff.gained], ["exec.sandboxed"]);
  assert.equal(move.widened, true);
  const shrink = lifecycle.moveBoundary({ capabilities: ["a", "b"] }, { capabilities: ["a"] });
  assert.equal(shrink.widened, false);
});

test("S32-WP04 follow filters one agent while preserving goal causality", () => {
  const events = [
    { agentId: "worker-1", type: "effect" },
    { agentId: "worker-2", type: "effect" },
    { goalScoped: true, type: "goal.verdict" },
  ];
  const mine = lifecycle.followFilter(events, "worker-1");
  assert.equal(mine.length, 2);
  assert.ok(mine.some((event) => event.goalScoped));
});

test("S32-WP04 queued messages show a cancellable delivery boundary", () => {
  const queued = lifecycle.queuedMessage({ id: "m1", audience: "worker-2" }, 42);
  assert.equal(queued.deliveryBoundary, 42);
  assert.equal(queued.cancellable, true);
  assert.equal(queued.delivered, false);
});

test("S32-WP03 children never widen parent scope on any dimension", () => {
  const parent = {
    capabilities: ["read.browse", "read.search"],
    secrets: ["db-url"],
    realms: ["local"],
    network: "none",
    dataClass: "internal",
  };
  const ok = delegation.validateDelegation(parent, {
    capabilities: ["read.browse"],
    secrets: [],
    realms: ["local"],
    network: "none",
    dataClass: "public",
  });
  assert.equal(ok.allowed, true);
  const widened = delegation.validateDelegation(parent, {
    capabilities: ["read.browse", "exec.host"],
    secrets: ["db-url", "admin-key"],
    realms: ["local", "cloud"],
    network: "egress",
    dataClass: "confidential",
  });
  assert.equal(widened.allowed, false);
  assert.deepEqual(
    [...widened.widened],
    ["capability:exec.host", "secret:admin-key", "realm:cloud", "network", "dataClass"],
  );
});

test("S32-WP03 budgets clamp to the parent and exhaustion pauses with evidence", () => {
  const clamped = delegation.clampBudgets({ tokens: 100, toolCalls: 10 }, { tokens: 500, toolCalls: 5 });
  assert.equal(clamped.tokens, 100);
  assert.equal(clamped.toolCalls, 5);
  const exhaustion = delegation.budgetExhaustion({ tokens: 100, toolCalls: 10 }, { tokens: 120, toolCalls: 4 });
  assert.equal(exhaustion.exhausted, true);
  assert.deepEqual([...exhaustion.dimensions], ["tokens"]);
  assert.equal(exhaustion.action, "pause");
  assert.equal(exhaustion.silentlyReroutes, false);
  assert.ok(exhaustion.evidence.includes("budget:tokens:120/100"));
});

test("S32-WP05 team value decisions explain themselves from the factors", () => {
  const team = delegation.teamValueDecision({
    dependencyWidth: 3,
    risk: 2,
    uncertainty: 1,
    domainDiversity: 2,
    verificationCost: 1,
    budgetPressure: 0,
  });
  assert.equal(team.team, true);
  assert.match(team.rationale, /Team:/);
  const solo = delegation.teamValueDecision({
    dependencyWidth: 1,
    risk: 1,
    uncertainty: 0,
    domainDiversity: 0,
    verificationCost: 3,
    budgetPressure: 2,
  });
  assert.equal(solo.team, false);
  assert.match(solo.rationale, /Solo:/);
});

test("S32-WP05 conflicts are detected before merge with a proposed order", () => {
  const conflicts = delegation.detectConflicts([
    { childId: "w1", files: ["a.ts", "b.ts"] },
    { childId: "w2", files: ["b.ts"] },
  ]);
  assert.equal(conflicts.conflicts, true);
  assert.deepEqual([...conflicts.overlappingFiles], ["b.ts"]);
  assert.deepEqual([...conflicts.proposedOrder], ["w2", "w1"], "smaller change sets integrate first");
});

test("S32-WP06 fault injection contains siblings and launders nothing", () => {
  const contained = delegation.containFault("child-crash", ["w2", "w3"]);
  assert.deepEqual([...contained.siblingsAffected], []);
  assert.equal(contained.goalState, "intact");
  assert.equal(contained.authorityLaundered, false);
  assert.equal(contained.boundedCleanup, "quarantine-child-worktree");
  const message = delegation.crossTaskMessage({ id: "m", source: "w1", audience: "w2" });
  assert.equal(message.grantsCapability, false);
  assert.equal(message.grantsCompletion, false);
  assert.equal(message.receivingPolicy, "default-deny");
});
