/**
 * S30-WP03 — Approval Queue card and adversarial gate (projection side).
 *
 * The card shows action, exact resource/argv, reason, boundary, network,
 * secret references, expiry, one-shot scope and alternatives; Deny is
 * always available; Narrow Scope can never broaden the request. This is
 * the mirror of the Core-side fail-closed gate: every check here is
 * advisory UX, the Core re-verifies everything before executing.
 */

/** Card fields the UI must display (S30-WP03). */
const CARD_FIELDS = Object.freeze([
  "approvalId",
  "action",
  "resource",
  "argv",
  "reason",
  "boundary",
  "network",
  "secretRefs",
  "expiresAtMs",
  "scope",
  "digest",
  "alternatives",
]);

/** The decision options — deny is always present and first. */
const DECISIONS = Object.freeze(["deny", "approve"]);

/** Validate that a card is displayable; returns missing fields. */
function cardCompleteness(card) {
  const missing = CARD_FIELDS.filter((field) => card?.[field] === undefined || card?.[field] === null);
  return Object.freeze({ complete: missing.length === 0, missing: Object.freeze(missing) });
}

/** Deny is always offered; approve requires a complete card. */
function offeredDecisions(card) {
  const completeness = cardCompleteness(card);
  return Object.freeze(completeness.complete ? DECISIONS : Object.freeze(["deny"]));
}

/**
 * Narrow-scope check: a narrowed argv may only REMOVE trailing
 * arguments from the approved argv — adding or reordering broadens the
 * request and is rejected (WP03: Narrow Scope cannot broaden).
 */
function narrowsScope(approvedArgv, narrowedArgv) {
  if (!Array.isArray(approvedArgv) || !Array.isArray(narrowedArgv)) {
    return false;
  }
  if (narrowedArgv.length > approvedArgv.length) {
    return false;
  }
  for (let index = 0; index < narrowedArgv.length; index += 1) {
    if (narrowedArgv[index] !== approvedArgv[index]) {
      return false;
    }
  }
  return true;
}

/** Client-side preflight of a resolution: lists every failing condition. */
function preflightResolution(card, resolution, nowMs) {
  const failures = [];
  if (!card?.approvalId) {
    failures.push("no-card");
    return Object.freeze({ allowed: false, failures: Object.freeze(failures) });
  }
  if (resolution?.approvalId !== card.approvalId) {
    failures.push("approval-unknown-for-run");
  }
  if (Number.isFinite(card.expiresAtMs) && nowMs >= card.expiresAtMs) {
    failures.push("approval-expired");
  }
  if (resolution?.digest !== undefined && resolution.digest !== card.digest) {
    failures.push("approval-digest-mismatch");
  }
  if (resolution?.planVersion !== undefined && resolution.planVersion !== card.planVersion) {
    failures.push("approval-plan-changed");
  }
  if (Array.isArray(resolution?.scope?.argv) && !narrowsScope(card.argv, resolution.scope.argv)) {
    failures.push("approval-scope-broadened");
  }
  if (resolution?.decision !== undefined && !DECISIONS.includes(resolution.decision)) {
    failures.push("invalid-decision");
  }
  return Object.freeze({ allowed: failures.length === 0, failures: Object.freeze(failures) });
}

module.exports = {
  CARD_FIELDS,
  DECISIONS,
  cardCompleteness,
  narrowsScope,
  offeredDecisions,
  preflightResolution,
};
