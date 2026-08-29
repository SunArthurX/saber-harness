/**
 * S30-WP01 — Goal and Plan authoring tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const goalPlan = await src("goalPlan.js");

const VALID_GOAL = {
  objective: "Fix the failing fixture test",
  acceptance: [{ checkId: "c1", kind: "file_contains", path: "notes.md", needle: "ok" }],
  constraints: ["read-only-research-first"],
  budget: { toolCalls: 20 },
  deadlineMs: 1893456000000,
  owner: "user",
  evidenceRequirements: ["run.acceptance_checked"],
};

test("S30-WP01 a Goal declares all authored fields with frozen acceptance", () => {
  assert.deepEqual(goalPlan.validateGoal(VALID_GOAL), []);
  assert.equal(goalPlan.GOAL_FIELDS.length, 7);
  assert.deepEqual(goalPlan.validateGoal({ ...VALID_GOAL, objective: "" }), ["objective-required"]);
  assert.deepEqual(goalPlan.validateGoal({ ...VALID_GOAL, acceptance: [] }), ["acceptance-required"]);
  assert.deepEqual(goalPlan.validateGoal({ ...VALID_GOAL, acceptance: [{ nope: 1 }] }), ["acceptance-check-malformed"]);
  assert.deepEqual(goalPlan.validateGoal({ ...VALID_GOAL, deadlineMs: "soon" }), ["deadline-not-numeric"]);
  assert.ok(Object.isFrozen(goalPlan.validateGoal(VALID_GOAL)));
});

test("S30-WP01 plan versions are immutable — edits create proposed diffs", () => {
  const frozen = { version: 1, tasks: ["read", "edit"], acceptance: ["c1"], budget: { toolCalls: 20 } };
  const proposed = goalPlan.proposePlanEdit(frozen, { tasks: ["read", "edit", "test"] }, 1000);
  assert.equal(proposed.version, 2);
  assert.equal(proposed.parentVersion, 1);
  assert.equal(proposed.status, "proposed");
  assert.deepEqual([...proposed.diff.facets], ["tasks"]);
  assert.deepEqual(frozen.tasks, ["read", "edit"], "the frozen version is untouched");
  assert.throws(() => goalPlan.proposePlanEdit(null, {}, 1), /plan_not_frozen/);
});

test("S30-WP01 acceptance changes are always a visible diff facet", () => {
  const frozen = { version: 1, tasks: ["read"], acceptance: ["c1"], budget: {} };
  const proposed = goalPlan.proposePlanEdit(frozen, { acceptance: ["c1", "c2"] }, 2000);
  assert.ok(proposed.diff.facets.includes("acceptance"));
  assert.ok(proposed.diff.facets.includes("acceptance-notice"));
});

test("S30-WP01 accepting a proposal freezes it; only proposals are acceptable", () => {
  const proposed = goalPlan.proposePlanEdit({ version: 1, tasks: [] }, { tasks: ["x"] }, 1);
  const accepted = goalPlan.acceptProposal(proposed);
  assert.equal(accepted.status, "frozen");
  assert.ok(Object.isFrozen(accepted));
  assert.throws(() => goalPlan.acceptProposal(accepted), /not_a_proposal/);
});

test("S30-WP01 run binding requires the complete S30-WP01 tuple", () => {
  const full = goalPlan.runBinding({
    goalId: "g1",
    planVersion: 2,
    modelRoute: "fixture-deterministic",
    realm: "local",
    worktree: "/tmp/wt",
    policySnapshot: "abc",
    idempotencyKey: "run-1",
  });
  assert.equal(full.bound, true);
  const partial = goalPlan.runBinding({ goalId: "g1", planVersion: 1 });
  assert.equal(partial.bound, false);
  assert.deepEqual(partial.missing, ["modelRoute", "realm", "worktree", "policySnapshot", "idempotencyKey"]);
});
