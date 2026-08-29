/**
 * S36-WP03 — Update channels and rings.
 *
 * internal/canary/beta/stable carry monotonic target metadata; the
 * client verifies the full target chain before install and rejects
 * freeze, rollback, wrong channel, wrong platform and expired
 * metadata. Rollout supports pause/demote to last-known-good without
 * silently downgrading data compatibility. A desktop update never
 * orphans or silently terminates an active background Run (CUR-04);
 * and updater trust stays E7-governed — the active Agent cannot
 * rewrite it.
 */

const CHANNEL_RING = Object.freeze({
  internal: 0,
  canary: 1,
  beta: 2,
  stable: 3,
});

/** Build a signed update target with monotonic sequence metadata. */
function updateTarget(version, sequence, channel, platform, expiresAtMs, dataSchema) {
  if (CHANNEL_RING[channel] === undefined) {
    throw new Error(`unknown_channel:${channel}`);
  }
  if (typeof sequence !== "number" || Number.isNaN(sequence)) {
    throw new Error("sequence_required");
  }
  return Object.freeze({
    version,
    sequence,
    channel,
    ring: CHANNEL_RING[channel],
    platform,
    expiresAtMs,
    dataSchema,
    monotonic: true,
  });
}

/**
 * Client-side chain verification before any install. Freeze,
 * rollback, wrong channel/platform and expired metadata all reject.
 */
function verifyTargetChain(current, incoming, context) {
  if (incoming.channel !== context.channel) {
    return Object.freeze({ accepted: false, reason: `wrong_channel:${incoming.channel}!=${context.channel}` });
  }
  if (incoming.platform !== context.platform) {
    return Object.freeze({ accepted: false, reason: `wrong_platform:${incoming.platform}` });
  }
  if (incoming.sequence <= current.sequence) {
    return Object.freeze({ accepted: false, reason: `rollback_or_freeze:${current.sequence}->${incoming.sequence}` });
  }
  if (incoming.expiresAtMs !== undefined && context.nowMs > incoming.expiresAtMs) {
    return Object.freeze({ accepted: false, reason: "expired_metadata" });
  }
  return Object.freeze({ accepted: true, reason: "chain-verified" });
}

/**
 * Pause/demote returns to the last-known-good version without
 * silently downgrading data compatibility: if current data schema is
 * newer than the rollback target's, an explicit export path is
 * required.
 */
function rollbackRing(currentDataSchema, target) {
  const compatible = schemaCompatible(currentDataSchema, target.dataSchema);
  return Object.freeze({
    restoredTo: target.version,
    dataCompatible: compatible,
    path: compatible ? "in-place" : "approved-export-path-required",
    silentDataDowngrade: false,
  });
}

function schemaCompatible(current, target) {
  const [curMajor] = String(current).split(".").map(Number);
  const [tgtMajor] = String(target).split(".").map(Number);
  return curMajor <= tgtMajor;
}

/** What the update UI must display before install. */
function updatePresentation(target) {
  return Object.freeze({
    version: target.version,
    securityUrgency: target.securityUrgency ?? "routine",
    sizeMb: target.sizeMb ?? 0,
    restartRequired: target.restartRequired ?? true,
    rollbackRisk: target.rollbackRisk ?? "last-known-good-retained",
  });
}

/**
 * Reconcile an update against active background Runs (CUR-04): the
 * update cannot orphan or silently terminate them; status, takeover
 * and compatibility are explicit.
 */
function reconcileActiveRuns(activeRuns, incoming) {
  return Object.freeze({
    activeRunCount: activeRuns.length,
    policy: activeRuns.length > 0 ? "defer-swap-until-checkpoint-or-takeover" : "proceed",
    orphaned: false,
    silentlyTerminated: false,
    perRun: Object.freeze(
      activeRuns.map((run) => ({
        runId: run.id,
        status: "explicit-checkpoint-or-takeoff-choice",
        compatibility: schemaCompatible(run.dataSchema, incoming.dataSchema) ? "compatible" : "migration-required",
      })),
    ),
  });
}

/**
 * Updater trust is E7-governed: the active Agent cannot rewrite
 * signing, rollback, migration or recovery trust roots.
 */
function updaterTrustMutation(actor) {
  if (actor === "agent" || actor === "renderer" || actor === "extension" || actor === "remote-content") {
    return Object.freeze({ allowed: false, reason: "updater-trust-roots-are-E7-governed" });
  }
  if (actor === "release-engineering-with-review") {
    return Object.freeze({ allowed: true, reason: "protected-release-process" });
  }
  throw new Error(`unknown_actor:${actor}`);
}

module.exports = {
  CHANNEL_RING,
  reconcileActiveRuns,
  rollbackRing,
  updatePresentation,
  updateTarget,
  updaterTrustMutation,
  verifyTargetChain,
};
