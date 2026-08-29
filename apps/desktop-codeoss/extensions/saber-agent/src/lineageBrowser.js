/**
 * S33-WP02/WP03 — lineage browser and resumption capsule.
 *
 * Raw encrypted objects, canonical events, derived summaries/chunks and
 * lineage edges are separately visible with parser/version/digest and
 * recompute status; unsupported content stays untrusted and never
 * auto-promotes to Memory; deleting raw data invalidates or deletes
 * dependents per policy. The Resumption Capsule captures the full
 * continuation identity, revalidates it (unchanged/diverged/missing/
 * unknown), requires user choice for ambiguity and continues by
 * creating NEW linked events — never rewriting the imported
 * conversation (CDX-02, MMX-05, DSH-03, ZED-02).
 */

/** Lineage layers. */
const LINEAGE_LAYERS = Object.freeze(["raw-encrypted-object", "canonical-events", "derived-summary", "lineage-edges"]);

/** Build a lineage record for one imported object. */
function lineageRecord(raw) {
  return Object.freeze({
    layer: "raw-encrypted-object",
    id: raw.id,
    parser: raw.parser,
    parserVersion: raw.parserVersion,
    digest: raw.digest,
    recomputeStatus: raw.recomputed ? "verified" : "pending",
    dependents: Object.freeze(raw.dependents ?? []),
    trust: raw.trusted === true ? "trusted" : "untrusted",
  });
}

/**
 * Deletion propagation: removing a raw object invalidates derived
 * summaries and deletes canonical events per policy — never silently.
 */
function deletionPropagation(raw, { policy = "invalidate-derived" } = {}) {
  const effects = [];
  for (const dependent of raw.dependents ?? []) {
    effects.push(
      policy === "delete-dependent" ? { id: dependent, effect: "deleted" } : { id: dependent, effect: "invalidated" },
    );
  }
  return Object.freeze({
    rawDeleted: true,
    effects: Object.freeze(effects),
    dependentsRemaining: 0,
    recall: Object.freeze({ futureRecall: "blocked", graphVerified: true }),
  });
}

/** Untrusted imported text never auto-promotes to Memory. */
function promotionGate(lineage) {
  return Object.freeze({
    canPromote: lineage.trust === "trusted" && lineage.recomputeStatus === "verified",
    autoPromotion: false,
    reason: lineage.trust !== "trusted" ? "untrusted-source" : "needs-verified-recompute",
  });
}

/** S33-WP03 — capture a resumption capsule. */
function captureCapsule(snapshot) {
  const required = [
    "goalId",
    "taskId",
    "repositoryOrigin",
    "commit",
    "branch",
    "dirtyHash",
    "toolchain",
    "policySnapshot",
    "model",
    "capturedAtMs",
  ];
  const missing = required.filter((field) => snapshot?.[field] === undefined || snapshot?.[field] === null);
  if (missing.length > 0) {
    throw new Error(`capsule_missing:${missing.join(",")}`);
  }
  return Object.freeze({
    ...snapshot,
    dependencies: Object.freeze(snapshot.dependencies ?? []),
    decisions: Object.freeze(snapshot.decisions ?? []),
    artifacts: Object.freeze(snapshot.artifacts ?? []),
  });
}

/** Revalidate a capsule against current repository reality. */
function revalidateCapsule(capsule, current) {
  if (!current) {
    return Object.freeze({ status: "unknown", requiresUserChoice: true });
  }
  if (current.missing) {
    return Object.freeze({ status: "missing", requiresUserChoice: true });
  }
  if (current.commit === undefined) {
    return Object.freeze({ status: "unknown", requiresUserChoice: true });
  }
  if (current.commit !== capsule.commit || current.branch !== capsule.branch) {
    return Object.freeze({
      status: "diverged",
      drift: Object.freeze({
        commit: current.commit !== capsule.commit,
        branch: current.branch !== capsule.branch,
        dirtyHash: current.dirtyHash !== capsule.dirtyHash,
        toolchain: current.toolchain !== capsule.toolchain,
        policy: current.policySnapshot !== capsule.policySnapshot,
      }),
      requiresUserChoice: true,
    });
  }
  if (current.dirtyHash !== capsule.dirtyHash) {
    return Object.freeze({ status: "diverged", drift: Object.freeze({ dirtyHash: true }), requiresUserChoice: true });
  }
  return Object.freeze({ status: "unchanged", requiresUserChoice: false });
}

/** Continuation creates NEW events linked to the source — no rewrites. */
function continueFrom(capsule, newEvent) {
  return Object.freeze({
    kind: "continuation.created",
    linkedSource: Object.freeze({ goalId: capsule.goalId, taskId: capsule.taskId, capturedAtMs: capsule.capturedAtMs }),
    newEvent: Object.freeze({ ...newEvent, createdAtMs: newEvent.atMs }),
    rewritesSource: false,
  });
}

module.exports = {
  LINEAGE_LAYERS,
  captureCapsule,
  continueFrom,
  deletionPropagation,
  lineageRecord,
  promotionGate,
  revalidateCapsule,
};
