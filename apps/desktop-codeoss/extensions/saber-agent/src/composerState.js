/**
 * S29-WP02 — composer state machine.
 *
 * States: empty, drafting, resolving references, attachment scanning,
 * context over budget, DLP blocked, offline queued, ready, sending and
 * failed. Token triggers resolve file/symbol/artifact (@), Goal/Run/
 * conversation (#), command/workflow (/) and governed capability ($);
 * `+` attachments pass media, size, malware and sensitivity checks.
 * Queue and Steer are separate explicit operations with a visible
 * insertion boundary, and every failure retains the user draft with a
 * recovery explanation (S29-WP06).
 */

/** Composer states (S29-WP02). */
const COMPOSER_STATES = Object.freeze([
  "empty",
  "drafting",
  "resolving-references",
  "attachment-scanning",
  "context-over-budget",
  "dlp-blocked",
  "offline-queued",
  "ready",
  "sending",
  "failed",
]);

/** Valid state transitions — the composer can only walk these edges. */
const TRANSITIONS = Object.freeze({
  empty: Object.freeze(["drafting", "offline-queued"]),
  drafting: Object.freeze(["resolving-references", "attachment-scanning", "ready", "offline-queued", "empty"]),
  "resolving-references": Object.freeze(["drafting", "context-over-budget", "dlp-blocked", "ready"]),
  "attachment-scanning": Object.freeze(["drafting", "dlp-blocked", "ready"]),
  "context-over-budget": Object.freeze(["drafting", "resolving-references", "ready"]),
  "dlp-blocked": Object.freeze(["drafting", "resolving-references", "attachment-scanning"]),
  "offline-queued": Object.freeze(["drafting", "ready"]),
  ready: Object.freeze(["sending", "drafting", "offline-queued"]),
  sending: Object.freeze(["ready", "failed", "drafting"]),
  failed: Object.freeze(["drafting", "ready", "offline-queued"]),
});

/** Token triggers and what they resolve (S29-WP02). */
const TOKEN_TRIGGERS = Object.freeze({
  "@": Object.freeze({ resolves: Object.freeze(["file", "symbol", "artifact"]) }),
  "#": Object.freeze({ resolves: Object.freeze(["goal", "run", "conversation"]) }),
  "/": Object.freeze({ resolves: Object.freeze(["command", "workflow"]) }),
  $: Object.freeze({ resolves: Object.freeze(["governed-capability"]) }),
});

/** Attachment policy (S29-WP02 `+` checks). */
const ATTACHMENT_POLICY = Object.freeze({
  allowedMedia: Object.freeze(["image/png", "image/jpeg", "text/plain", "text/markdown", "application/pdf"]),
  maxBytes: 10 * 1024 * 1024,
  malwareRequirement: "clean",
  blockedSensitivity: Object.freeze(["blocked", "restricted"]),
});

/**
 * Rate-limited streaming announcer (S29-WP06): at most one announcement
 * per window, always summarized.
 */
class AnnouncementLimiter {
  #windowMs;
  #lastAt = Number.NEGATIVE_INFINITY;

  constructor(windowMs = 5000) {
    this.#windowMs = windowMs;
  }

  /** True when an announcement may be spoken now. */
  allow(nowMs) {
    if (nowMs - this.#lastAt >= this.#windowMs) {
      this.#lastAt = nowMs;
      return true;
    }
    return false;
  }
}

/** Pure composer state machine over a retained draft. */
class Composer {
  #state = "empty";
  #draft = "";
  #attachments = [];
  #references = [];
  #queue = [];
  #steers = [];

  get state() {
    return this.#state;
  }

  get draft() {
    return this.#draft;
  }

  get attachments() {
    return Object.freeze([...this.#attachments]);
  }

  get references() {
    return Object.freeze([...this.#references]);
  }

  #transition(next) {
    if (!TRANSITIONS[this.#state].includes(next)) {
      throw new Error(`invalid_transition:${this.#state}->${next}`);
    }
    this.#state = next;
  }

  /** Type into the composer; the draft survives every failure path. */
  type(text) {
    this.#draft = String(text ?? "");
    if (this.#state === "empty" && this.#draft.length > 0) {
      this.#transition("drafting");
    }
    if (this.#draft.length === 0 && this.#state === "drafting") {
      this.#transition("empty");
    }
    return this.#state;
  }

  /** Begin resolving a token trigger; returns what the trigger resolves. */
  resolveToken(trigger) {
    const spec = TOKEN_TRIGGERS[trigger];
    if (!spec) {
      throw new Error(`unknown_trigger:${trigger}`);
    }
    this.#transition("resolving-references");
    return spec.resolves;
  }

  /** Accept a resolved reference (file/symbol/... with source id). */
  acceptReference(reference) {
    if (!reference?.id || !reference?.sourceType) {
      throw new Error("invalid_reference");
    }
    this.#references.push(Object.freeze({ ...reference }));
    this.#transition("drafting");
    return this.references;
  }

  /**
   * Validate a `+` attachment against media/size/malware/sensitivity
   * policy. Rejections carry the reason and retain the draft.
   */
  attach(candidate) {
    this.#transition("attachment-scanning");
    const rejection = validateAttachment(candidate);
    if (rejection) {
      this.#transition("dlp-blocked");
      return {
        accepted: false,
        reason: rejection,
        draftRetained: true,
        recovery: `Remove or fix the attachment (${rejection}) and continue editing`,
      };
    }
    this.#attachments.push(Object.freeze({ ...candidate }));
    this.#transition("drafting");
    return { accepted: true, reason: null, draftRetained: true, recovery: null };
  }

  /** Mark the context over budget; only shrinking returns to drafting. */
  overBudget() {
    this.#transition("context-over-budget");
    return { draftRetained: true, recovery: "Exclude fragments until the preview fits the budget" };
  }

  /** Queue (enqueue for later) and Steer (insert mid-run) are separate. */
  queue() {
    this.#transition("offline-queued");
    this.#queue.push(Object.freeze({ text: this.#draft, atBoundary: "queue-tail" }));
    return { operation: "queue", visibleBoundary: "queue-tail", draftRetained: false };
  }

  steer(eventCursor) {
    if (typeof eventCursor !== "number") {
      throw new Error("steer_requires_event_cursor");
    }
    this.#steers.push(Object.freeze({ text: this.#draft, insertionBoundary: eventCursor }));
    return { operation: "steer", visibleBoundary: eventCursor, draftRetained: false };
  }

  /** Enter ready from a legal state. */
  ready() {
    this.#transition("ready");
    return this.#state;
  }

  sending() {
    this.#transition("sending");
    return this.#state;
  }

  /** Failure keeps the draft and explains recovery (S29-WP06). */
  fail(reason) {
    this.#transition("failed");
    return { reason, draftRetained: true, recovery: `Draft preserved (${reason}); retry sending or keep editing` };
  }
}

/** Attachment policy check; returns a rejection reason or null. */
function validateAttachment(candidate) {
  if (!candidate || !ATTACHMENT_POLICY.allowedMedia.includes(candidate.media)) {
    return "media-not-allowed";
  }
  if (!Number.isFinite(candidate.sizeBytes) || candidate.sizeBytes > ATTACHMENT_POLICY.maxBytes) {
    return "size-over-limit";
  }
  if (candidate.malware !== ATTACHMENT_POLICY.malwareRequirement) {
    return "malware-scan-required";
  }
  if (ATTACHMENT_POLICY.blockedSensitivity.includes(candidate.sensitivity)) {
    return "sensitivity-blocked";
  }
  return null;
}

module.exports = {
  ATTACHMENT_POLICY,
  COMPOSER_STATES,
  Composer,
  TOKEN_TRIGGERS,
  TRANSITIONS,
  AnnouncementLimiter,
  validateAttachment,
};
