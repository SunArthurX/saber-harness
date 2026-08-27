/**
 * Crash-safe run view: a pure replayable projection over the Core's durable
 * event stream (ADR-013). The view holds no run state — crashing the
 * client destroys only a local buffer, and a new view replays from any
 * cursor into the identical presentation because the Core's event store is
 * the single source of truth.
 */

/** One durable run event as seen by the renderer. */
export interface RunEvent {
  readonly sequence: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** A read-side event source with cursor semantics (the trusted Core). */
export interface RunEventSource {
  /** Read events strictly after `cursor`, up to `limit`. */
  readAfter(cursor: number, limit: number): RunEvent[];
}

/** Presentation state derived purely from replayed events. */
export interface RunViewState {
  readonly cursor: number;
  readonly lastEventType: string | null;
  readonly eventCount: number;
}

export class RunView {
  readonly #source: RunEventSource;
  #cursor = 0;
  #lastEventType: string | null = null;
  #eventCount = 0;

  constructor(source: RunEventSource, cursor = 0) {
    this.#source = source;
    this.#cursor = cursor;
  }

  /** The current replay cursor (persist this to resume elsewhere). */
  get cursor(): number {
    return this.#cursor;
  }

  /** Derived presentation state — never authoritative run state. */
  get state(): RunViewState {
    return {
      cursor: this.#cursor,
      lastEventType: this.#lastEventType,
      eventCount: this.#eventCount,
    };
  }

  /** Pull new events; reconnect and replay are the same operation. */
  refresh(limit = 256): RunEvent[] {
    const events = this.#source.readAfter(this.#cursor, limit);
    for (const event of events) {
      this.#cursor = event.sequence;
      this.#lastEventType = event.type;
      this.#eventCount += 1;
    }
    return events;
  }
}

/**
 * Render the events a view would present after replaying from a cursor —
 * deterministic for identical event streams, so a restarted renderer
 * reconstructs the identical presentation.
 */
export function replayPresentation(source: RunEventSource, cursor = 0, limit = 1_000_000): RunEvent[] {
  return source.readAfter(cursor, limit);
}
