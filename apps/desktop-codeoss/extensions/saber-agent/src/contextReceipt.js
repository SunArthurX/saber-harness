/**
 * S29-WP03 — Context Preview and Receipt.
 *
 * Every model-visible fragment declares source ID, source type,
 * revision/hash, selection reason, trust, sensitivity, token estimate,
 * transformation/redaction, destination provider and retention policy.
 * The preview total must reconcile with the request receipt after send;
 * exclusion removes a fragment BEFORE provider dispatch and creates
 * evidence (S29-WP05). The preview is the user's ground truth for what
 * will be sent to which model and why (DSH-03, ZED-06).
 */

/** Required fields on every context fragment. */
const FRAGMENT_FIELDS = Object.freeze([
  "sourceId",
  "sourceType",
  "revision",
  "reason",
  "trust",
  "sensitivity",
  "tokenEstimate",
  "transformation",
  "destinationProvider",
  "retentionPolicy",
]);

/** Trust levels, ordered. */
const TRUST_LEVELS = Object.freeze(["low", "medium", "high"]);

/** Sensitivity classes; `secret` fragments are never dispatchable. */
const SENSITIVITY_CLASSES = Object.freeze(["public", "internal", "confidential", "secret"]);

/** Keyboard-operable context chip (S29-WP06). */
function contextChip(fragment) {
  return Object.freeze({
    id: fragment.sourceId,
    name: fragment.sourceId,
    source: fragment.sourceType,
    sensitivity: fragment.sensitivity,
    removeAction: "saber.conversation.excludeFragment",
    keyboardRemovable: true,
  });
}

/**
 * A preview of exactly what a provider request will contain. Adding a
 * fragment enforces the full field contract; excluding one removes it
 * from dispatch and records evidence; the sent receipt must reconcile
 * with the preview totals.
 */
class ContextPreview {
  #fragments = new Map();
  #exclusions = [];

  /** Add a fully-declared fragment; returns its context chip. */
  add(fragment) {
    for (const field of FRAGMENT_FIELDS) {
      if (fragment?.[field] === undefined || fragment?.[field] === null || fragment?.[field] === "") {
        throw new Error(`missing_fragment_field:${field}`);
      }
    }
    if (!TRUST_LEVELS.includes(fragment.trust)) {
      throw new Error(`invalid_trust:${fragment.trust}`);
    }
    if (!SENSITIVITY_CLASSES.includes(fragment.sensitivity)) {
      throw new Error(`invalid_sensitivity:${fragment.sensitivity}`);
    }
    if (!Number.isFinite(fragment.tokenEstimate) || fragment.tokenEstimate < 0) {
      throw new Error("invalid_token_estimate");
    }
    if (fragment.sensitivity === "secret") {
      throw new Error("secret_fragment_not_dispatchable");
    }
    this.#fragments.set(fragment.sourceId, Object.freeze({ ...fragment }));
    return contextChip(fragment);
  }

  /** Fragments in insertion order. */
  fragments() {
    return [...this.#fragments.values()];
  }

  /** Preview totals — the ground truth the receipt must reconcile with. */
  totals() {
    const list = this.fragments();
    return Object.freeze({
      fragmentCount: list.length,
      tokenEstimate: list.reduce((sum, fragment) => sum + fragment.tokenEstimate, 0),
      bySensitivity: Object.freeze(
        Object.fromEntries(SENSITIVITY_CLASSES.map((cls) => [cls, list.filter((f) => f.sensitivity === cls).length])),
      ),
      providers: Object.freeze([...new Set(list.map((fragment) => fragment.destinationProvider))].sort()),
    });
  }

  /**
   * Exclude a fragment before provider dispatch (S29-WP05): removes it
   * and returns the evidence record proving the exclusion happened.
   */
  exclude(sourceId, atMs) {
    const fragment = this.#fragments.get(sourceId);
    if (!fragment) {
      throw new Error(`unknown_fragment:${sourceId}`);
    }
    this.#fragments.delete(sourceId);
    const evidence = Object.freeze({
      kind: "context.fragment_excluded",
      sourceId,
      reason: fragment.reason,
      wouldHaveGoneTo: fragment.destinationProvider,
      atMs,
    });
    this.#exclusions.push(evidence);
    return evidence;
  }

  /** Exclusion evidence, in order (never silently dropped). */
  exclusions() {
    return Object.freeze([...this.#exclusions]);
  }

  /** Freeze the sent receipt for a provider request. */
  receipt(requestId, atMs) {
    const totals = this.totals();
    return Object.freeze({
      requestId,
      atMs,
      fragmentCount: totals.fragmentCount,
      tokenEstimate: totals.tokenEstimate,
      providers: totals.providers,
      excludedCount: this.#exclusions.length,
      fragments: Object.freeze(this.fragments().map((fragment) => Object.freeze({ ...fragment }))),
    });
  }
}

/**
 * Reconcile a preview snapshot against a sent receipt: every divergence
 * is listed; an empty list means the preview was exactly what was sent.
 */
function reconcile(previewTotals, receipt) {
  const divergences = [];
  if (previewTotals.fragmentCount !== receipt.fragmentCount) {
    divergences.push(`fragment-count ${previewTotals.fragmentCount} != ${receipt.fragmentCount}`);
  }
  if (previewTotals.tokenEstimate !== receipt.tokenEstimate) {
    divergences.push(`token-estimate ${previewTotals.tokenEstimate} != ${receipt.tokenEstimate}`);
  }
  const previewProviders = [...previewTotals.providers].sort().join("|");
  const receiptProviders = [...receipt.providers].sort().join("|");
  if (previewProviders !== receiptProviders) {
    divergences.push(`providers ${previewProviders} != ${receiptProviders}`);
  }
  return Object.freeze({ reconciled: divergences.length === 0, divergences: Object.freeze(divergences) });
}

module.exports = {
  FRAGMENT_FIELDS,
  SENSITIVITY_CLASSES,
  TRUST_LEVELS,
  ContextPreview,
  contextChip,
  reconcile,
};
