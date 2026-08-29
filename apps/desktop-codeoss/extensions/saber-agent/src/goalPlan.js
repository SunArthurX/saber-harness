/**
 * S30-WP01 — Goal and Plan authoring projection.
 *
 * A Goal freezes its acceptance contract; a Plan has immutable versions
 * where every edit is a new version with a diff; starting a Run binds
 * one plan version, model route, Realm, Worktree, policy snapshot and
 * idempotency key; an agent replan is only ever a proposal. This module
 * is the projection-side contract mirror of the Core's run engine — it
 * owns no state and grants nothing.
 */

/** Goal fields every authored Goal must declare (S30-WP01). */
const GOAL_FIELDS = Object.freeze([
  "objective",
  "acceptance",
  "constraints",
  "budget",
  "deadlineMs",
  "owner",
  "evidenceRequirements",
]);

/** Plan-diff facets an edit may touch (tasks, deps, permissions, budget, acceptance). */
const PLAN_DIFF_FACETS = Object.freeze(["tasks", "dependencies", "permissions", "budget", "acceptance"]);

/** Validate an authored Goal; returns the failures (empty = valid). */
function validateGoal(goal) {
  const failures = [];
  if (!goal || typeof goal.objective !== "string" || goal.objective.length === 0) {
    failures.push("objective-required");
  }
  if (!Array.isArray(goal?.acceptance) || goal.acceptance.length === 0) {
    failures.push("acceptance-required");
  } else {
    for (const check of goal.acceptance) {
      if (!check?.checkId || !check?.kind) {
        failures.push("acceptance-check-malformed");
        break;
      }
    }
  }
  if (goal?.deadlineMs !== undefined && !Number.isFinite(goal.deadlineMs)) {
    failures.push("deadline-not-numeric");
  }
  return Object.freeze(failures);
}

/**
 * Immutable plan versions: an edit produces a NEW version whose diff
 * records exactly which facets changed. A frozen version can never be
 * edited in place, and user acceptance criteria cannot change silently —
 * acceptance changes are always visible diff facets.
 */
function proposePlanEdit(current, edits, nowMs) {
  if (!current || typeof current.version !== "number") {
    throw new Error("plan_not_frozen");
  }
  const changedFacets = [];
  for (const facet of PLAN_DIFF_FACETS) {
    if (edits?.[facet] !== undefined && JSON.stringify(edits[facet]) !== JSON.stringify(current[facet] ?? null)) {
      changedFacets.push(facet);
    }
  }
  if (edits?.acceptance !== undefined) {
    changedFacets.push("acceptance-notice");
  }
  const next = {
    ...current,
    ...edits,
    version: current.version + 1,
    parentVersion: current.version,
    proposedAtMs: nowMs,
    status: "proposed",
    diff: Object.freeze({
      from: current.version,
      facets: Object.freeze([...new Set(changedFacets)]),
    }),
  };
  return Object.freeze(next);
}

/** Accepting a proposal freezes the new version; the old stays intact. */
function acceptProposal(proposal) {
  if (proposal?.status !== "proposed") {
    throw new Error("not_a_proposal");
  }
  return Object.freeze({ ...proposal, status: "frozen", frozenAtMs: proposal.proposedAtMs });
}

/**
 * The binding a run start must record (S30-WP01): one plan version, one
 * model route, one Realm, one Worktree, a policy snapshot and an
 * idempotency key. Any missing piece refuses to bind.
 */
function runBinding({ goalId, planVersion, modelRoute, realm, worktree, policySnapshot, idempotencyKey }) {
  const missing = Object.fromEntries(
    Object.entries({ goalId, planVersion, modelRoute, realm, worktree, policySnapshot, idempotencyKey })
      .filter(([, value]) => value === undefined || value === null || value === "")
      .map(([key]) => [key, true]),
  );
  if (Object.keys(missing).length > 0) {
    return Object.freeze({ bound: false, missing: Object.freeze(Object.keys(missing)) });
  }
  return Object.freeze({
    bound: true,
    missing: [],
    goalId,
    planVersion,
    modelRoute,
    realm,
    worktree,
    policySnapshot,
    idempotencyKey,
  });
}

module.exports = {
  GOAL_FIELDS,
  PLAN_DIFF_FACETS,
  acceptProposal,
  proposePlanEdit,
  runBinding,
  validateGoal,
};
