/**
 * S29-WP01 — conversation message model and rendering projection.
 *
 * A crash-safe, append-only message stream over durable conversation
 * events (ADR-013): reconnect replays are deduplicated by event ID,
 * retry creates a NEW causal event instead of rewriting history, hidden
 * chain-of-thought is never exposed, and every message kind renders
 * distinctly. Tool detail is collapsed by default while Evidence
 * navigation survives, and copy output carries explicit redaction
 * markers. This module is a pure projection: it owns no model calls and
 * no authority.
 */

/** Distinctly rendered message kinds (S29-WP01). */
const MESSAGE_KINDS = Object.freeze([
  "user",
  "agent-summary",
  "question",
  "decision-proposal",
  "approval-request",
  "tool-summary",
  "artifact",
  "checkpoint",
  "incident",
  "system-notice",
]);

/** Payload roles that must never surface in any projection. */
const HIDDEN_ROLES = Object.freeze(["chain-of-thought", "reasoning", "system:hidden"]);

/** Redaction marker used in copied text (S29-WP01 copy contract). */
const REDACTION_MARKER = "[redacted]";

/** Fields whose values are redacted in copy output. */
const SENSITIVE_FIELDS = Object.freeze(["secret", "token", "credential", "apiKey", "privateKey"]);

/** Rendering contract per kind: role label, detail default, evidence nav. */
const RENDER_CONTRACT = Object.freeze({
  user: Object.freeze({ role: "You", collapseDetail: false, evidence: false }),
  "agent-summary": Object.freeze({ role: "Agent", collapseDetail: false, evidence: true }),
  question: Object.freeze({ role: "Agent · Question", collapseDetail: false, evidence: false }),
  "decision-proposal": Object.freeze({ role: "Agent · Decision proposal", collapseDetail: false, evidence: true }),
  "approval-request": Object.freeze({ role: "Agent · Approval required", collapseDetail: false, evidence: true }),
  "tool-summary": Object.freeze({ role: "Tool", collapseDetail: true, evidence: true }),
  artifact: Object.freeze({ role: "Artifact", collapseDetail: false, evidence: true }),
  checkpoint: Object.freeze({ role: "Checkpoint", collapseDetail: false, evidence: false }),
  incident: Object.freeze({ role: "Incident", collapseDetail: false, evidence: true }),
  "system-notice": Object.freeze({ role: "System", collapseDetail: false, evidence: false }),
});

/**
 * Append-only conversation stream with reconnect deduplication.
 * Events are durable facts; `ingest` is idempotent so a replayed page
 * after reconnect can never duplicate a message.
 */
class ConversationStream {
  #events = new Map();
  #hiddenCount = 0;

  /** Ingest durable events (single or replay page); returns newly added IDs. */
  ingest(events) {
    const added = [];
    for (const event of events) {
      if (!event || typeof event.eventId !== "string" || !MESSAGE_KINDS.includes(event.kind)) {
        throw new Error("invalid_conversation_event");
      }
      if (this.#events.has(event.eventId)) {
        continue; // reconnect deduplication
      }
      if (event.hidden || HIDDEN_ROLES.includes(event.payload?.role)) {
        this.#hiddenCount += 1;
        this.#events.set(event.eventId, Object.freeze({ ...event, hidden: true }));
        continue;
      }
      this.#events.set(event.eventId, Object.freeze({ ...event, hidden: false }));
      added.push(event.eventId);
    }
    return added;
  }

  /** Messages in causal order; hidden chain-of-thought never appears. */
  messages() {
    return [...this.#events.values()].filter((event) => !event.hidden).map((event) => this.render(event));
  }

  /** Count of withheld chain-of-thought events (visible honesty, no text). */
  get withheldCount() {
    return this.#hiddenCount;
  }

  /** Render one event per the distinct-kind contract. */
  render(event) {
    const contract = RENDER_CONTRACT[event.kind];
    return Object.freeze({
      eventId: event.eventId,
      kind: event.kind,
      role: contract.role,
      text: String(event.payload?.text ?? ""),
      collapsedByDefault: contract.collapseDetail,
      evidenceRef:
        contract.evidence && typeof event.payload?.evidenceRef === "string" ? event.payload.evidenceRef : null,
      retryOf: event.retryOf ?? null,
      atMs: event.atMs ?? 0,
    });
  }

  /**
   * Retry a message by APPENDING a new causal event that references the
   * original — history is never rewritten or removed.
   */
  retry(eventId, newEventId, atMs) {
    const original = this.#events.get(eventId);
    if (!original || original.hidden) {
      throw new Error(`unknown_message:${eventId}`);
    }
    return this.ingest([
      {
        eventId: newEventId,
        kind: original.kind === "user" ? "user" : "agent-summary",
        atMs,
        retryOf: eventId,
        payload: { text: original.payload?.text ?? "", regenerated: true },
      },
    ]);
  }

  /** Copyable text with redaction markers; tool detail opt-in. */
  copyText({ includeToolDetail = false } = {}) {
    return this.messages()
      .filter((message) => includeToolDetail || !message.collapsedByDefault || message.kind !== "tool-summary")
      .map((message) => `${message.role}: ${redact(message.text)}`)
      .join("\n");
  }

  /**
   * Screen-reader summary of new streaming output (S29-WP06): one
   * summarized announcement, never token-by-token noise.
   */
  static announcementFor(rendered, previousCount, currentCount) {
    const delta = Math.max(0, currentCount - previousCount);
    if (delta === 0) {
      return null;
    }
    const kinds = [...new Set(rendered.slice(previousCount).map((message) => message.kind))];
    return Object.freeze({
      politeness: "polite",
      summary: `${delta} new message${delta === 1 ? "" : "s"} (${kinds.join(", ")})`,
      spokenPerMessage: false,
    });
  }
}

/** Replace sensitive field values in copied text with the marker. */
function redact(text) {
  let output = String(text ?? "");
  for (const field of SENSITIVE_FIELDS) {
    const pattern = new RegExp(`("${field}"\\s*:\\s*")[^"]*(")`, "gi");
    output = output.replace(pattern, `$1${REDACTION_MARKER}$2`);
  }
  return output;
}

module.exports = {
  ConversationStream,
  MESSAGE_KINDS,
  REDACTION_MARKER,
  RENDER_CONTRACT,
  redact,
};
