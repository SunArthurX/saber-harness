/**
 * S34-WP02/S34-WP03 — Evolution workshop tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const evolution = await src("evolutionWorkshop.js");

function candidate(overrides = {}) {
  return {
    id: "cand-1",
    title: "Prefer pnpm scripts in this workspace",
    source: "repeated-correction",
    rung: "E1",
    expectedBenefit: "fewer wrong-package-manager runs",
    affectedScopes: ["workspace://saber"],
    newPermissions: [],
    owner: "user",
    ...overrides,
  };
}

test("S34-WP02 the ladder is E0-E7 with E6 proposal-only and E7 forbidden", () => {
  assert.equal(evolution.EVOLUTION_LADDER.length, 8);
  assert.deepEqual(
    evolution.EVOLUTION_LADDER.map((entry) => entry.rung),
    ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7"],
  );
  assert.equal(evolution.EVOLUTION_LADDER[6].constraint, "protected-PR-only");
  assert.equal(evolution.EVOLUTION_LADDER[7].constraint, "never");
});

test("S34-WP02 duplicate, conflicting and poisoned candidates are blocked or grouped", () => {
  const existing = [
    { id: "cand-0", title: "Prefer pnpm scripts in this workspace", rung: "E1" },
    { id: "cand-x", scope: "workspace://saber", effect: "lint-on-save" },
  ];
  const duplicate = evolution.intakeGate(candidate(), existing);
  assert.equal(duplicate.verdict, "grouped");
  assert.equal(duplicate.groupedWith, "cand-0");
  const conflicting = evolution.intakeGate(
    candidate({ id: "cand-2", title: "Other", scope: "workspace://saber", effect: "lint-on-save" }),
    existing,
  );
  assert.equal(conflicting.verdict, "blocked");
  assert.equal(conflicting.reason, "conflicting-effect-in-scope");
  const poisoned = evolution.intakeGate(candidate({ id: "cand-3", title: "Poison", sourcePoisoned: true }), existing);
  assert.equal(poisoned.verdict, "blocked");
  assert.equal(poisoned.reason, "source-poisoned");
  const fresh = evolution.intakeGate(candidate({ id: "cand-4", title: "Brand new" }), existing);
  assert.equal(fresh.verdict, "accepted");
  assert.equal(fresh.medium, "rule");
});

test("S34-WP02 E7 never passes intake and unknown sources fail closed", () => {
  assert.throws(() => evolution.intakeGate(candidate({ rung: "E7" })), /rung_forbidden:E7/);
  assert.throws(
    () => evolution.intakeGate(candidate({ source: "adversary-suggestion" })),
    /unknown_candidate_source:adversary-suggestion/,
  );
  assert.throws(() => evolution.intakeGate(candidate({ rung: "E9" })), /unknown_rung:E9/);
});

test("S34-WP02 candidate review shows benefit, scopes, permissions, data, owner, expiry, rollback and never self-installs", () => {
  const review = evolution.candidateReview(candidate());
  assert.equal(review.medium, "rule");
  assert.deepEqual([...review.affectedScopes], ["workspace://saber"]);
  assert.deepEqual([...review.newPermissions], []);
  assert.equal(review.owner, "user");
  assert.equal(review.expiry, "90d");
  assert.equal(review.rollback, "revert-to-last-known-good");
  assert.equal(review.selfInstalled, false);
});

test("S34-WP03 baseline freezes tasks and last-known-good; empty fails closed", () => {
  const baseline = evolution.freezeBaseline(["task-a", "task-b"], "skillset@3");
  assert.deepEqual([...baseline.tasks], ["task-a", "task-b"]);
  assert.equal(baseline.lastKnownGood, "skillset@3");
  assert.equal(baseline.immutable, true);
  assert.throws(() => evolution.freezeBaseline([], "x"), /empty_baseline/);
  assert.throws(() => evolution.freezeBaseline(["a"], ""), /missing_last_known_good/);
});

test("S34-WP03 evaluation is isolated, secret-free and honest about regressions", () => {
  const baseline = evolution.freezeBaseline(["task-a"], "skillset@3");
  const good = evolution.evaluateCandidate(baseline, {
    success: 10,
    regression: 0,
    safety: "pass",
    humanCorrections: 0,
  });
  assert.equal(good.isolatedRealm, "evaluation");
  assert.equal(good.productionSecrets, "none");
  assert.equal(good.verdict, "candidate-ready-for-canary");
  const bad = evolution.evaluateCandidate(baseline, { success: 8, regression: 2, safety: "fail", humanCorrections: 3 });
  assert.equal(bad.verdict, "candidate-rejected");
});

test("S34-WP03 canary requires cohort, duration, stop thresholds and owner", () => {
  const plan = evolution.canaryPlan(candidate(), {
    cohort: "10%",
    duration: "3d",
    stopThresholds: { regression: 0, safety: "any" },
    owner: "user",
  });
  assert.deepEqual({ ...plan.stopThresholds }, { regression: 0, safety: "any" });
  assert.equal(plan.rollbackReady, true);
  assert.throws(
    () => evolution.canaryPlan(candidate(), { cohort: "10%", duration: "3d", owner: "user" }),
    /canary_plan_missing:stopThresholds/,
  );
});

test("S34-WP03 rollback works from UI and Core even when the candidate crashed", () => {
  const crashed = evolution.rollbackCandidate({ id: "cand-9", crashed: true, lastKnownGood: "skillset@3" });
  assert.equal(crashed.crashed, true);
  assert.equal(crashed.restoredFrom, "core");
  assert.equal(crashed.restoredTo, "skillset@3");
  assert.equal(crashed.evidencePreserved, true);
  const clean = evolution.rollbackCandidate({ id: "cand-9", crashed: false, lastKnownGood: "skillset@3" });
  assert.equal(clean.restoredFrom, "ui-or-core");
});
