/**
 * S30-WP02 — Run and Tool timeline projection.
 *
 * The durable Core states (queued/running/blocked/succeeded/failed/
 * cancelled) project onto the eleven UX states by appending the blocking
 * reason. The timeline shows only observable events — never an invented
 * progress percentage and never hidden thought. Cursor replay
 * deduplicates and orders causation, and late or stale events can never
 * regress a terminal state.
 */

/** UX states (S30-WP02). */
const UX_STATES = Object.freeze([
  "queued",
  "planning",
  "running",
  "waiting-approval",
  "waiting-user",
  "paused",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
  "recovering",
]);

/** Durable store states this projection maps from. */
const DURABLE_STATES = Object.freeze(["queued", "running", "blocked", "succeeded", "failed", "cancelled"]);

/** Terminal UX states — once entered, no later event can leave them. */
const TERMINAL_STATES = Object.freeze(["succeeded", "failed", "cancelled"]);

/** Map a durable state + reason onto the UX state. */
function uxState(durable, reason) {
  switch (durable) {
    case "queued":
      return "queued";
    case "running":
      return reason === "verifying" ? "verifying" : "running";
    case "blocked":
      if (reason === "waiting_approval") return "waiting-approval";
      if (reason === "paused") return "paused";
      if (reason === "waiting_user") return "waiting-user";
      if (reason === "recovering") return "recovering";
      return "waiting-user";
    default:
      return durable;
  }
}

/** True when the state is terminal and can no longer change. */
function isTerminal(state) {
  return TERMINAL_STATES.includes(state);
}

/**
 * Timeline reducer over replayed events with cursor semantics: identical
 * events replay into the identical timeline (dedup by event id), causal
 * order is the arrival order of first sight, and a late event targeting
 * a terminal run is recorded as stale without regressing the state.
 */
class RunTimeline {
  #seen = new Set();
  #entries = [];
  #durable = "queued";
  #reason = "";
  #stale = [];

  /** Ingest a page of durable events (idempotent by event id). */
  ingest(events, runId) {
    for (const event of events) {
      if (!event?.eventId || this.#seen.has(event.eventId)) {
        continue;
      }
      const mine = !runId || event.runId === runId;
      if (!mine) {
        continue;
      }
      this.#seen.add(event.eventId);
      this.#entries.push(Object.freeze({ ...event }));
      this.#apply(event);
    }
    return this.state();
  }

  #apply(event) {
    switch (event.type) {
      case "run.state_changed":
        if (isTerminal(uxState(this.#durable, this.#reason))) {
          this.#stale.push({ eventId: event.eventId, note: "terminal-state-locked" });
          return;
        }
        this.#durable = event.payload?.to ?? this.#durable;
        this.#reason = "";
        break;
      case "run.waiting_approval":
        // The engine transitions to blocked before recording the wait.
        this.#durable = "blocked";
        this.#reason = "waiting_approval";
        break;
      case "run.paused":
        this.#reason = "paused";
        break;
      case "run.effect_completed":
        this.#reason = "";
        break;
      case "run.acceptance_checked":
        this.#reason = this.#durable === "running" ? "verifying" : this.#reason;
        break;
      default:
        break;
    }
  }

  /** Current UX state (never an invented percentage). */
  state() {
    return Object.freeze({
      ux: uxState(this.#durable, this.#reason),
      durable: this.#durable,
      reason: this.#reason || null,
      eventCount: this.#entries.length,
      staleEvents: Object.freeze([...this.#stale]),
      progressPercent: null,
    });
  }

  /** Observable timeline entries in causal order. */
  entries() {
    return Object.freeze([...this.#entries]);
  }

  /** Tool summary from an effect_completed event: exact resource, Realm,
   * duration, result digest and evidence id — nothing invented. */
  static toolSummary(event) {
    const summary = event?.payload?.summary ?? {};
    return Object.freeze({
      kind: event.payload?.kind ?? "unknown",
      resource: summary.resource ?? null,
      realm: summary.realm ?? null,
      durationMs: summary.duration_ms ?? null,
      resultDigest: summary.result_digest ?? null,
      evidenceId: summary.evidence_id ?? null,
    });
  }
}

module.exports = {
  DURABLE_STATES,
  TERMINAL_STATES,
  UX_STATES,
  RunTimeline,
  isTerminal,
  uxState,
};
