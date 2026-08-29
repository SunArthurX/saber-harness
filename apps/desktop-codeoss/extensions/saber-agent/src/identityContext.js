/**
 * S28-WP03 — Task/Run/Worktree/Realm identity for native surfaces.
 *
 * Every agent-related editor, terminal and diff header carries the Task,
 * Run, Worktree and Realm identity of the governing run, bound to the
 * visible revision (CUR-05, DSH-05, ZED-01). Missing identity is not
 * cosmetic: destructive agent actions fail closed when identity is
 * incomplete. User-owned manual edits carry the frozen MANUAL_IDENTITY —
 * they coexist with Agent Worktree changes in the same window but never
 * authorize agent effects, so a hand edit can never be billed to a run.
 */

/** Identity carried by user-owned manual edits (no agent run). */
const MANUAL_IDENTITY = Object.freeze({ kind: "manual" });

/** Actions that mutate repository or machine state — gated on full identity. */
const DESTRUCTIVE_ACTIONS = Object.freeze([
  "run.execute",
  "worktree.write",
  "terminal.command",
  "file.applyDiff",
  "workspace.dispose",
]);

/** True when the identity carries Task, Run, Worktree and Realm together. */
function isComplete(identity) {
  return Boolean(
    identity &&
      identity.kind !== "manual" &&
      typeof identity.taskId === "string" &&
      identity.taskId.length > 0 &&
      typeof identity.runId === "string" &&
      identity.runId.length > 0 &&
      typeof identity.worktreeId === "string" &&
      identity.worktreeId.length > 0 &&
      typeof identity.realmId === "string" &&
      identity.realmId.length > 0,
  );
}

/** One-line identity for editor/terminal/diff headers. */
function describeIdentity(identity) {
  if (!identity || identity.kind === "manual" || !isComplete(identity)) {
    return "Manual edit — no agent run identity";
  }
  return `Task ${identity.taskId} · Run ${identity.runId} · Worktree ${identity.worktreeId} · Realm ${identity.realmId}`;
}

/** Structured header for surfaces that render fields separately. */
function identityHeader(identity) {
  if (!identity || identity.kind === "manual" || !isComplete(identity)) {
    return Object.freeze({
      task: null,
      run: null,
      worktree: null,
      realm: null,
      complete: false,
      manual: identity?.kind === "manual",
    });
  }
  return Object.freeze({
    task: identity.taskId,
    run: identity.runId,
    worktree: identity.worktreeId,
    realm: identity.realmId,
    complete: true,
    manual: false,
  });
}

/** Missing identity fields, in canonical order. */
function missingFields(identity) {
  if (!identity || identity.kind === "manual") {
    return [];
  }
  const required = [
    ["taskId", identity.taskId],
    ["runId", identity.runId],
    ["worktreeId", identity.worktreeId],
    ["realmId", identity.realmId],
  ];
  return required.filter(([, value]) => typeof value !== "string" || value.length === 0).map(([field]) => field);
}

/**
 * Fail-closed gate for destructive agent actions: a surface without a
 * complete agent identity — or an unknown action — can never proceed.
 */
function assertDestructiveAllowed(identity, action) {
  if (!DESTRUCTIVE_ACTIONS.includes(action)) {
    return Object.freeze({ allowed: false, reason: "unknown-action" });
  }
  if (!identity || identity.kind === "manual") {
    return Object.freeze({ allowed: false, reason: "manual-identity" });
  }
  const missing = missingFields(identity);
  if (missing.length > 0) {
    return Object.freeze({ allowed: false, reason: "missing-identity", missing });
  }
  return Object.freeze({ allowed: true, reason: null, missing: [] });
}

/**
 * Bind an identity to the revision a surface displays (CUR-05): preview,
 * editor, terminal, LSP and repository views must render the same
 * revision the run used, or report the mismatch instead of hiding it.
 */
function revisionBinding(identity, revision) {
  if (!identity || identity.kind === "manual") {
    return Object.freeze({ bound: false, revision: null, reason: "manual-identity" });
  }
  if (!isComplete(identity)) {
    return Object.freeze({ bound: false, revision: null, reason: "missing-identity" });
  }
  if (typeof revision !== "string" || revision.length === 0) {
    return Object.freeze({ bound: false, revision: null, reason: "missing-revision" });
  }
  return Object.freeze({ bound: true, revision, reason: null });
}

module.exports = {
  DESTRUCTIVE_ACTIONS,
  MANUAL_IDENTITY,
  assertDestructiveAllowed,
  describeIdentity,
  identityHeader,
  isComplete,
  missingFields,
  revisionBinding,
};
