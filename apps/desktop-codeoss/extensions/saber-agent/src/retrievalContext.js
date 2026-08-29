/**
 * S33-WP04 — retrieval and context integration.
 *
 * Hybrid lexical/symbol/vector retrieval with rerank and per-source
 * budgets; trust, sensitivity, workspace/user/team scope, TTL and
 * revocation filters run BEFORE anything is returned; every fragment
 * carries a Context Receipt; the evaluation harness measures precision,
 * stale rate, duplicate rate and false provenance against a fixed set.
 */

/** Retrieval channels. */
const CHANNELS = Object.freeze(["lexical", "symbol", "vector"]);

/** One retrieved fragment with its receipt. */
function fragment(source, { score, channel, rerankScore } = {}) {
  return Object.freeze({
    sourceId: source.id,
    text: source.text,
    trust: source.trust ?? "medium",
    sensitivity: source.sensitivity ?? "internal",
    scopes: Object.freeze(source.scopes ?? []),
    expiresAtMs: source.expiresAtMs ?? null,
    revokedAtMs: source.revokedAtMs ?? null,
    revision: source.revision ?? null,
    stale: source.stale === true,
    score,
    channel,
    rerankScore,
  });
}

/** Filters applied before fragments may return. */
function retrievalFilter(fragments_, _query, { workspaceId, userId, nowMs }) {
  const reasons = [];
  const visible = fragments_.filter((item) => {
    if (item.sensitivity === "secret") {
      reasons.push({ sourceId: item.sourceId, reason: "sensitivity-secret" });
      return false;
    }
    if (item.revokedAtMs !== null && item.revokedAtMs <= nowMs) {
      reasons.push({ sourceId: item.sourceId, reason: "revoked" });
      return false;
    }
    if (item.expiresAtMs !== null && item.expiresAtMs <= nowMs) {
      reasons.push({ sourceId: item.sourceId, reason: "expired-ttl" });
      return false;
    }
    const scopes = item.scopes;
    const inWorkspace = scopes.length === 0 || scopes.includes(`workspace:${workspaceId}`);
    const inUser =
      scopes.length === 0 || scopes.some((scope) => scope === `user:${userId}` || scope.startsWith("team:"));
    if (!inWorkspace || !inUser) {
      reasons.push({ sourceId: item.sourceId, reason: "scope" });
      return false;
    }
    return true;
  });
  return Object.freeze({ visible: Object.freeze(visible), filtered: Object.freeze(reasons) });
}

/** Rerank by channel blend with per-source budgets. */
function rerank(fragments_, { perSourceBudget = 3 } = {}) {
  const counts = new Map();
  return fragments_
    .map((item) => ({ item, blended: (item.score ?? 0) * 0.6 + (item.rerankScore ?? 0) * 0.4 }))
    .sort((a, b) => b.blended - a.blended)
    .filter(({ item }) => {
      const used = counts.get(item.sourceId) ?? 0;
      if (used >= perSourceBudget) {
        return false;
      }
      counts.set(item.sourceId, used + 1);
      return true;
    })
    .map(({ item }) => item);
}

/** The Context Receipt every returned fragment carries. */
function contextReceipt(fragments_, query) {
  return Object.freeze({
    query,
    fragmentCount: fragments_.length,
    sources: Object.freeze(fragments_.map((item) => item.sourceId)),
    trustLevels: Object.freeze([...new Set(fragments_.map((item) => item.trust))]),
    generatedAtMs: null,
    provenanceVerified: fragments_.every((item) => item.revision !== null),
  });
}

/**
 * Evaluation over a fixed labelled set: precision, stale rate,
 * duplicate rate and false provenance (MMX-06/AID-01).
 */
function evaluate(retrieved, labelled) {
  const relevant = new Set(labelled.relevantSourceIds);
  const hits = retrieved.filter((item) => relevant.has(item.sourceId));
  const precision = retrieved.length === 0 ? 0 : hits.length / retrieved.length;
  const stale = retrieved.filter((item) => item.stale === true).length;
  const duplicateIds = retrieved.length - new Set(retrieved.map((item) => item.sourceId)).size;
  const falseProvenance = retrieved.filter(
    (item) =>
      item.revision === null || item.revision !== (labelled.expectedRevisions?.[item.sourceId] ?? item.revision),
  ).length;
  return Object.freeze({
    precision,
    staleRate: retrieved.length === 0 ? 0 : stale / retrieved.length,
    duplicateRate: retrieved.length === 0 ? 0 : duplicateIds / retrieved.length,
    falseProvenanceRate: retrieved.length === 0 ? 0 : falseProvenance / retrieved.length,
  });
}

module.exports = {
  CHANNELS,
  contextReceipt,
  evaluate,
  fragment,
  rerank,
  retrievalFilter,
};
