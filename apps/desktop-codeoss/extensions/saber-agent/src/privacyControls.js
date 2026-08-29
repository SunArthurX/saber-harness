/**
 * S29-WP05 — Privacy controls.
 *
 * Exclude removes a fragment before provider dispatch and creates
 * evidence; Revoke affects future retrieval and follows the Memory/
 * derived-deletion policy while never falsely claiming deletion from an
 * already-contacted provider; secret and sensitive-data canaries never
 * reach model fixtures; local drafts live only in approved profile
 * storage (encrypted, excluded from crash dumps).
 */

/** Where drafts may live (S29-WP05). */
const DRAFT_STORAGE_POLICY = Object.freeze({
  storage: "approved-profile-storage",
  encryption: "profile-key",
  includedInCrashDumps: false,
  syncedRemotely: false,
});

/** Canary kinds planted by tests and audits (never dispatched). */
const CANARY_KINDS = Object.freeze(["secret", "sensitive-data"]);

/**
 * Scan a provider-visible fixture/body for planted canaries. Any hit is
 * a hard failure: canary material must never reach a model fixture.
 */
function canaryScan(body, canaries) {
  const haystack = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const hits = [];
  for (const canary of canaries ?? []) {
    if (!canary?.kind || !CANARY_KINDS.includes(canary.kind) || typeof canary.value !== "string") {
      throw new Error("invalid_canary");
    }
    if (haystack.includes(canary.value)) {
      hits.push({ kind: canary.kind, marker: canary.marker ?? canary.value.slice(0, 6) });
    }
  }
  return Object.freeze({ clean: hits.length === 0, hits: Object.freeze(hits) });
}

/**
 * Exclude a fragment before provider dispatch. Returns the dispatch
 * payload WITHOUT the fragment plus the evidence record proving the
 * exclusion (mirrors ContextPreview.exclude for payload-level use).
 */
function excludeBeforeDispatch(fragments, sourceId, atMs) {
  const list = [...(fragments ?? [])];
  const index = list.findIndex((fragment) => fragment.sourceId === sourceId);
  if (index === -1) {
    throw new Error(`unknown_fragment:${sourceId}`);
  }
  const [removed] = list.splice(index, 1);
  return Object.freeze({
    remainingFragments: Object.freeze(list),
    evidence: Object.freeze({
      kind: "context.fragment_excluded",
      sourceId,
      wouldHaveGoneTo: removed.destinationProvider,
      atMs,
    }),
  });
}

/**
 * Revoke a memory/derived record: stops future retrieval and cascades
 * per the deletion policy — while stating plainly which providers were
 * ALREADY contacted, because those cannot be claimed deleted.
 */
function revoke(record, { deletionPolicy = "revoke-future-and-derived", alreadyContactedProviders = [] } = {}) {
  const contacted = [...new Set(alreadyContactedProviders)];
  return Object.freeze({
    recordId: record?.recordId ?? null,
    futureRetrieval: "blocked",
    derivedRecords: deletionPolicy === "revoke-future-and-derived" ? "cascaded" : "left-in-place",
    alreadyContactedProviders: Object.freeze(contacted),
    honestNotice:
      contacted.length === 0
        ? "No provider had received this record; revocation is complete for future dispatch."
        : `Revocation affects future retrieval only. It CANNOT claim deletion from providers already contacted: ${contacted.join(", ")}.`,
  });
}

/**
 * Assert the draft storage policy for a surface about to persist local
 * drafts: only approved profile storage, encrypted, never in crash
 * dumps, never remotely synced.
 */
function assertDraftStorage(candidate) {
  const violations = [];
  if (candidate?.storage !== DRAFT_STORAGE_POLICY.storage) {
    violations.push("storage-not-approved");
  }
  if (candidate?.encryption !== DRAFT_STORAGE_POLICY.encryption) {
    violations.push("encryption-missing");
  }
  if (candidate?.includedInCrashDumps !== false) {
    violations.push("crash-dump-inclusion");
  }
  if (candidate?.syncedRemotely !== false) {
    violations.push("remote-sync-not-allowed");
  }
  return Object.freeze({
    compliant: violations.length === 0,
    violations: Object.freeze(violations),
    policy: DRAFT_STORAGE_POLICY,
  });
}

module.exports = {
  CANARY_KINDS,
  DRAFT_STORAGE_POLICY,
  assertDraftStorage,
  canaryScan,
  excludeBeforeDispatch,
  revoke,
};
