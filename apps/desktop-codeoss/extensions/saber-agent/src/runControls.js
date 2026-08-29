/**
 * S30-WP04/WP05 — Runtime control and desktop UX projection.
 *
 * Pause stops scheduling new effects at a defined safe event boundary;
 * Steer creates a causal user event stating whether it applies now or
 * after the current effect; Cancel propagates with compensation records;
 * Resume revalidates policy; Fork creates explicit lineage. Desktop UX
 * rules: run state comes from ONE projection feeding Task tree,
 * Conversation, Timeline and Vital Bar; notifications fire only for user
 * action, terminal result or incident; closing a window never cancels a
 * run; reopening lands on the active Task.
 */

/** Notification-worthy causes (WP05): user action, terminal, incident. */
const NOTIFICATION_CAUSES = Object.freeze(["user-action", "terminal", "incident"]);

/** Whether a timeline event warrants a desktop notification (WP05). */
function notifies(event) {
  switch (event?.type) {
    case "run.state_changed":
      return ["succeeded", "failed", "cancelled"].includes(event.payload?.to);
    case "run.waiting_approval":
      return true; // user action required
    case "run.effect_denied_by_policy":
      return true; // incident
    case "run.effect_completed":
    case "run.acceptance_checked":
    case "run.steered":
    case "run.paused":
      return false; // observable, but not notification-worthy noise
    default:
      return false;
  }
}

/**
 * Pause boundary (WP04): the run stops scheduling NEW effects; the
 * boundary is the next pending step id (or the end when none remain).
 */
function pauseBoundary(remainingSteps) {
  if (!Array.isArray(remainingSteps) || remainingSteps.length === 0) {
    return Object.freeze({ boundary: "end", stepId: null });
  }
  return Object.freeze({ boundary: "next-step", stepId: remainingSteps[0].stepId ?? null });
}

/**
 * Steer semantics (WP04, MMX-03): a steer is a causal control event,
 * never worker input. Blocked runs take it NOW; a running run records
 * it to apply AFTER the current effect.
 */
function steerPlacement(durableState) {
  return Object.freeze({
    applies: durableState === "blocked" ? "now" : "after-current-effect",
    contaminatesWorkerInput: false,
  });
}

/**
 * Cancel propagation (WP04): Tool, sub-process and Realm all stop, and
 * partial effects enter compensation/recovery with honest records.
 */
function cancelPropagation(pendingApproval) {
  return Object.freeze({
    tool: "stopped",
    subprocess: "terminated",
    realm: "torn-down",
    compensated: pendingApproval ? [pendingApproval.approvalId ?? "unknown"] : [],
  });
}

/**
 * Resume contract (WP04): the environment and policy snapshot are
 * revalidated before any effect continues.
 */
function resumeContract(boundSnapshot, currentSnapshot) {
  return Object.freeze({
    revalidated: boundSnapshot === currentSnapshot,
    continues: boundSnapshot === currentSnapshot,
  });
}

/**
 * Fork lineage (WP04): a fork records its parent explicitly; the journal
 * keeps both runs causally linked but never merged.
 */
function forkLineage(parentRunId, childRunId) {
  if (!parentRunId || !childRunId) {
    throw new Error("lineage_requires_both_runs");
  }
  return Object.freeze({ parentRunId, childRunId, merged: false });
}

/**
 * One projection feeds every surface (WP05): Task tree, Conversation,
 * Timeline and Vital Bar all consume the SAME state snapshot, so no
 * surface can claim success without Core terminal evidence.
 */
function projectSurfaces(timelineState) {
  const terminal = ["succeeded", "failed", "cancelled"].includes(timelineState?.ux);
  return Object.freeze({
    taskTree: { state: timelineState?.ux ?? "unknown", label: timelineState?.reason ?? null },
    conversation: { canSend: true, runState: timelineState?.ux ?? "unknown" },
    timeline: { entries: timelineState?.eventCount ?? 0 },
    vitalBar: { state: timelineState?.ux ?? "unknown" },
    // UI success assertions require Core terminal evidence.
    assertsSuccess: terminal && timelineState?.ux === "succeeded",
  });
}

/**
 * Window lifecycle (WP05): closing a window never cancels a run;
 * quitting with active runs offers background, pause or cancel with
 * truthful consequences.
 */
function quitOptions(activeRuns) {
  if (!Array.isArray(activeRuns) || activeRuns.length === 0) {
    return Object.freeze({ active: false, options: Object.freeze(["quit"]) });
  }
  return Object.freeze({
    active: true,
    options: Object.freeze(["background", "pause", "cancel"]),
    consequences: Object.freeze({
      background: "Runs keep executing in the Core; reopen to observe",
      pause: "Runs pause at the next safe event boundary",
      cancel: "Runs stop terminally; partial effects enter compensation",
    }),
  });
}

module.exports = {
  NOTIFICATION_CAUSES,
  cancelPropagation,
  forkLineage,
  notifies,
  pauseBoundary,
  projectSurfaces,
  quitOptions,
  resumeContract,
  steerPlacement,
};
