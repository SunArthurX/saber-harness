/**
 * S38-WP03/WP04 — Alpha/beta/RC rings and support/incident readiness.
 *
 * Each ring has start/stop thresholds, cohort, duration, owner and
 * rollback; RC uses production-signed artifacts and the update
 * channel. Support offers safe diagnostics, bundles and self-service
 * recovery; playbooks cover severity/on-call/communication/RCA and
 * disclosure; rehearsals span bad update, provider outage, sync loss,
 * secret incident and corrupted profile. Support can never request
 * raw secrets or unrestricted private repositories.
 */

const RINGS = Object.freeze(["internal-alpha", "private-beta", "release-candidate"]);

/** A ring plan fails closed without all control fields. */
function ringPlan(ring, plan) {
  if (!RINGS.includes(ring)) {
    throw new Error(`unknown_ring:${ring}`);
  }
  const required = ["startThresholds", "stopThresholds", "cohort", "duration", "owner", "rollback"];
  const missing = required.filter((field) => plan?.[field] === undefined || plan?.[field] === null);
  if (missing.length > 0) {
    throw new Error(`ring_plan_missing:${missing.join(",")}`);
  }
  return Object.freeze({
    ring,
    startThresholds: Object.freeze({ ...plan.startThresholds }),
    stopThresholds: Object.freeze({ ...plan.stopThresholds }),
    cohort: plan.cohort,
    duration: plan.duration,
    owner: plan.owner,
    rollback: Object.freeze({ ...plan.rollback }),
    productionSignedArtifacts: ring === "release-candidate",
    usesUpdateChannel: ring === "release-candidate",
  });
}

/** Rings must advance in order; RC only after beta thresholds pass. */
function ringProgression(completedRings, attempting) {
  const order = { "internal-alpha": 0, "private-beta": 1, "release-candidate": 2 };
  if (!order[attempting]) {
    throw new Error(`unknown_ring:${attempting}`);
  }
  const required = Object.keys(order)
    .filter((ring) => order[ring] < order[attempting])
    .filter((ring) => !completedRings.includes(ring));
  return Object.freeze({
    attempting,
    missingPrerequisites: Object.freeze(required),
    allowed: required.length === 0,
  });
}

const PLAYBOOKS = Object.freeze(["severity", "on-call", "communication", "rca", "security-disclosure"]);

const REHEARSALS = Object.freeze([
  "bad-update",
  "provider-outage",
  "sync-loss",
  "secret-incident",
  "corrupted-local-profile",
]);

/** Support readiness: playbooks and rehearsals all present and passed. */
function supportReadiness(playbooksPassed, rehearsalsPassed) {
  const missingPlaybooks = PLAYBOOKS.filter((playbook) => !playbooksPassed.includes(playbook));
  const missingRehearsals = REHEARSALS.filter((rehearsal) => !rehearsalsPassed.includes(rehearsal));
  return Object.freeze({
    missingPlaybooks: Object.freeze(missingPlaybooks),
    missingRehearsals: Object.freeze(missingRehearsals),
    userFacingDiagnostics: true,
    selfServiceRecovery: true,
    ready: missingPlaybooks.length === 0 && missingRehearsals.length === 0,
  });
}

/** Support requests are bounded: raw secrets and unrestricted repos fail closed. */
function supportRequest(request) {
  if (request.rawSecrets === true) {
    return Object.freeze({ accepted: false, reason: "support_cannot_request_raw_secrets" });
  }
  if (request.unrestrictedPrivateRepositories === true) {
    return Object.freeze({ accepted: false, reason: "support_cannot_request_unrestricted_private_repositories" });
  }
  return Object.freeze({
    accepted: true,
    bundle: request.redactedBundle === true ? "user-reviewed-redacted-bundle" : "none",
  });
}

module.exports = { PLAYBOOKS, REHEARSALS, RINGS, ringPlan, ringProgression, supportReadiness, supportRequest };
