/**
 * S32-WP02/WP04 — worktree lifecycle and follow/steer/take-over.
 *
 * Worktrees are created from explicit commits with collision-safe
 * paths and owner metadata; dirty bases, external deletions, branch
 * moves and case conflicts are detected; cleanup defaults to
 * recoverable quarantine rather than deletion; destructive git
 * reset/checkout is never used to resolve user changes. Take-over
 * pauses the agent and verifies the worktree before user edits; Realm
 * or model moves create a revalidation boundary with a capability diff.
 */

/** Worktree lifecycle states. */
const WORKTREE_STATES = Object.freeze(["creating", "active", "dirty", "taken-over", "quarantined", "cleaned"]);

/** Detect lifecycle anomalies from filesystem observations. */
function detect(worktree) {
  const anomalies = [];
  if (worktree.metaMissing) {
    anomalies.push("owner-metadata-missing");
  }
  if (worktree.dirtyBase) {
    anomalies.push("dirty-base");
  }
  if (worktree.externalDeletion) {
    anomalies.push("external-deletion");
  }
  if (worktree.branchMoved) {
    anomalies.push("branch-moved");
  }
  if (worktree.caseConflict) {
    anomalies.push("case-conflict");
  }
  return Object.freeze({ anomalies: Object.freeze(anomalies), healthy: anomalies.length === 0 });
}

/** Cleanup decision: quarantine by default; unreviewed changes block. */
function cleanupDecision(worktree) {
  if (worktree.unreviewedChanges) {
    return Object.freeze({
      allowed: false,
      reason: "cleanup_blocked_unreviewed_changes",
      remediation: "review the change set, then quarantine",
    });
  }
  if (worktree.taskState !== "terminal") {
    return Object.freeze({
      allowed: false,
      reason: "cleanup_blocked_task_not_terminal",
      remediation: "wait for the task to reach a terminal state",
    });
  }
  return Object.freeze({
    allowed: true,
    action: "quarantine",
    recovery: "move the directory back or review its change set before deletion",
    destructiveGitUsed: false,
  });
}

/** Take-over: pause first, verify the worktree, then hand control. */
function takeOver(agentState, worktreeHealth) {
  const steps = Object.freeze([
    { step: "pause-agent", precondition: agentState === "running" || agentState === "blocked" },
    { step: "verify-worktree", precondition: worktreeHealth.healthy },
    { step: "grant-user-edit", precondition: true },
  ]);
  const blocked = steps.filter((step) => !step.precondition).map((step) => step.step);
  return Object.freeze({ steps, blocked: Object.freeze(blocked), allowed: blocked.length === 0 });
}

/** Realm/model move: revalidation boundary with a capability diff. */
function moveBoundary(from, to) {
  const fromCaps = new Set(from.capabilities ?? []);
  const toCaps = new Set(to.capabilities ?? []);
  const gained = [...toCaps].filter((capability) => !fromCaps.has(capability));
  const lost = [...fromCaps].filter((capability) => !toCaps.has(capability));
  return Object.freeze({
    revalidationRequired: true,
    capabilityDiff: Object.freeze({ gained: Object.freeze(gained), lost: Object.freeze(lost) }),
    widened: gained.length > 0,
  });
}

/** Follow: filter the timeline to one agent, preserving goal causality. */
function followFilter(events, agentId) {
  return Object.freeze(events.filter((event) => event.agentId === agentId || event.goalScoped === true));
}

/** Queued cross-task messages show a delivery boundary; cancel anytime. */
function queuedMessage(message, boundarySequence) {
  return Object.freeze({
    id: message.id,
    audience: message.audience,
    deliveryBoundary: boundarySequence,
    cancellable: true,
    delivered: false,
  });
}

module.exports = {
  WORKTREE_STATES,
  cleanupDecision,
  detect,
  followFilter,
  moveBoundary,
  queuedMessage,
  takeOver,
};
