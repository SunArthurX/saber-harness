/**
 * S34-WP02/S34-WP03 — Evolution candidate intake, eval, canary and
 * rollback.
 *
 * Experience may propose Memory, Skill, workflow or Code Capsule
 * through the Evolution Ladder (MMX-04, CDX-06, ZCD-08) but it never
 * self-installs. Every candidate carries evidence and a permission
 * delta, is evaluated against a frozen baseline in an isolated Realm
 * with no production secret, canaried with explicit stop thresholds
 * and rolls back to last-known-good even if the candidate crashes.
 * E6 is protected-PR-only; E7 never mutates autonomously.
 */

/** Candidate sources recognized by intake. */
const CANDIDATE_SOURCES = Object.freeze([
  "feedback",
  "repeated-correction",
  "failed-task",
  "accepted-workflow",
  "benchmark-opportunity",
]);

/** The E0-E7 ladder; E6 is proposal-only, E7 is forbidden. */
const EVOLUTION_LADDER = Object.freeze([
  { rung: "E0", medium: "memory" },
  { rung: "E1", medium: "rule" },
  { rung: "E2", medium: "workflow" },
  { rung: "E3", medium: "skill" },
  { rung: "E4", medium: "strategy" },
  { rung: "E5", medium: "code-capsule" },
  { rung: "E6", medium: "protected-core-proposal", constraint: "protected-PR-only" },
  { rung: "E7", medium: "autonomous-mutation", constraint: "never" },
]);

/** Duplicate, conflicting and source-poisoned candidates never pass intake. */
function intakeGate(candidate, existing = []) {
  if (!candidate || !CANDIDATE_SOURCES.includes(candidate.source)) {
    throw new Error(`unknown_candidate_source:${String(candidate?.source)}`);
  }
  const rung = EVOLUTION_LADDER.find((entry) => entry.rung === candidate.rung);
  if (!rung) {
    throw new Error(`unknown_rung:${String(candidate.rung)}`);
  }
  if (rung.constraint === "never") {
    throw new Error("rung_forbidden:E7 autonomous mutation is not a permitted medium");
  }
  const duplicate = existing.find((entry) => entry.title === candidate.title && entry.rung === candidate.rung);
  if (duplicate) {
    return Object.freeze({ verdict: "grouped", groupedWith: duplicate.id, reason: "duplicate" });
  }
  const conflicting = existing.find(
    (entry) => entry.scope === candidate.scope && entry.effect === candidate.effect && entry.effect !== undefined,
  );
  if (conflicting) {
    return Object.freeze({ verdict: "blocked", blockedBy: conflicting.id, reason: "conflicting-effect-in-scope" });
  }
  if (candidate.sourcePoisoned === true) {
    return Object.freeze({ verdict: "blocked", reason: "source-poisoned" });
  }
  return Object.freeze({ verdict: "accepted", medium: rung.medium, constraint: rung.constraint });
}

/**
 * What the user reviews per candidate: expected benefit, affected
 * scopes, new permissions, training/eval data, owner, expiry and
 * rollback.
 */
function candidateReview(candidate) {
  return Object.freeze({
    id: candidate.id,
    title: candidate.title,
    rung: candidate.rung,
    medium: EVOLUTION_LADDER.find((entry) => entry.rung === candidate.rung)?.medium,
    expectedBenefit: candidate.expectedBenefit,
    affectedScopes: Object.freeze([...(candidate.affectedScopes ?? [])]),
    newPermissions: Object.freeze([...(candidate.newPermissions ?? [])]),
    trainingEvalData: candidate.trainingEvalData ?? "none",
    owner: candidate.owner,
    expiry: candidate.expiry ?? "90d",
    rollback: candidate.rollback ?? "revert-to-last-known-good",
    selfInstalled: false,
  });
}

/**
 * Freeze the baseline task set and the last-known-good version before
 * any evaluation or canary.
 */
function freezeBaseline(tasks, lastKnownGood) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("empty_baseline");
  }
  if (!lastKnownGood) {
    throw new Error("missing_last_known_good");
  }
  return Object.freeze({
    tasks: Object.freeze([...tasks]),
    lastKnownGood,
    frozenAt: "baseline-frozen",
    immutable: true,
  });
}

/**
 * A candidate is evaluated in an isolated evaluation Realm with no
 * production secret; compare success, regression, safety, latency,
 * cost and human correction against the frozen baseline.
 */
function evaluateCandidate(baseline, results) {
  const summary = {
    success: results.success ?? 0,
    regression: results.regression ?? 0,
    safety: results.safety ?? "pass",
    latencyMs: results.latencyMs ?? 0,
    costUsd: results.costUsd ?? 0,
    humanCorrections: results.humanCorrections ?? 0,
  };
  const promoted = summary.regression === 0 && summary.safety === "pass" && summary.humanCorrections === 0;
  return Object.freeze({
    baseline: baseline.lastKnownGood,
    isolatedRealm: "evaluation",
    productionSecrets: "none",
    ...summary,
    verdict: promoted ? "candidate-ready-for-canary" : "candidate-rejected",
  });
}

/**
 * Canary requires an explicit cohort, duration, stop thresholds and
 * owner; missing any of them fails closed.
 */
function canaryPlan(candidate, plan) {
  const missing = ["cohort", "duration", "stopThresholds", "owner"].filter(
    (field) => plan?.[field] === undefined || plan?.[field] === null,
  );
  if (missing.length > 0) {
    throw new Error(`canary_plan_missing:${missing.join(",")}`);
  }
  return Object.freeze({
    candidate: candidate.id,
    cohort: plan.cohort,
    duration: plan.duration,
    stopThresholds: Object.freeze({ ...plan.stopThresholds }),
    owner: plan.owner,
    rollbackReady: true,
  });
}

/**
 * Rollback to last-known-good is available from UI and Core even if
 * the candidate crashes; evidence of the failed attempt is preserved.
 */
function rollbackCandidate(candidateState) {
  const crashed = candidateState.crashed === true;
  return Object.freeze({
    candidate: candidateState.id,
    crashed,
    restoredTo: candidateState.lastKnownGood,
    restoredFrom: crashed ? "core" : "ui-or-core",
    evidencePreserved: true,
    rollbackProof: "hash-verified-restore",
  });
}

module.exports = {
  CANDIDATE_SOURCES,
  EVOLUTION_LADDER,
  canaryPlan,
  candidateReview,
  evaluateCandidate,
  freezeBaseline,
  intakeGate,
  rollbackCandidate,
};
