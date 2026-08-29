/**
 * S27 supervision transport — the desktop's client half of the local Core
 * endpoint (ADR-013/ADR-028).
 *
 * The socket transport moves validated frames only: every request goes
 * through {@link encodeRequest}, so version, deadline, frame-size and
 * method validation happen on the untrusted side BEFORE any byte reaches
 * the Core, and the Core re-validates independently. The lifecycle
 * machine is a pure function so crash/reload/reconnect behavior is
 * testable without a Core. Nothing here grants the renderer host, file,
 * shell or network authority.
 */
import { connect, type Socket } from "node:net";

import {
  CURRENT_PROTOCOL_VERSION,
  encodeRequest,
  type IdeActor,
  type IdeMethod,
  PREVIOUS_PROTOCOL_VERSION,
} from "./protocol.js";

/** Desktop supervision lifecycle states (S27-WP01). */
export type SupervisionState =
  | "booting"
  | "starting_core"
  | "attaching"
  | "ready"
  | "incompatible"
  | "reconnecting"
  | "degraded"
  | "safe_mode"
  | "stopping"
  | "stopped";

/** Lifecycle events the desktop shell can observe. */
export type SupervisionEvent =
  | "spawned"
  | "socket_open"
  | "initialized"
  | "incompatible"
  | "disconnected"
  | "retry_scheduled"
  | "retries_exhausted"
  | "handshake_denied"
  | "enter_safe_mode"
  | "begin_stop"
  | "stopped";

/** Pure lifecycle transition; unknown combinations keep the current state. */
export function nextLifecycle(current: SupervisionState, event: SupervisionEvent): SupervisionState {
  switch (event) {
    case "spawned":
      return current === "booting" ? "starting_core" : current;
    case "socket_open":
      return current === "booting" || current === "starting_core" || current === "reconnecting" ? "attaching" : current;
    case "initialized":
      return current === "attaching" || current === "reconnecting" ? "ready" : current;
    case "incompatible":
      return current === "attaching" ? "incompatible" : current;
    case "disconnected":
      return current === "ready" || current === "attaching" ? "reconnecting" : current;
    case "retry_scheduled":
      return current === "reconnecting" ? "reconnecting" : current;
    case "retries_exhausted":
      return current === "reconnecting" ? "degraded" : current;
    case "handshake_denied":
      return current === "attaching" ? "degraded" : current;
    case "enter_safe_mode":
      return "safe_mode";
    case "begin_stop":
      return current === "stopped" ? current : "stopping";
    case "stopped":
      return current === "stopping" ? "stopped" : current;
    default:
      return current;
  }
}

/** One replayed event delivered by {@link SupervisionClient.replay}. */
export interface ReplayedEvent {
  readonly sequence: number;
  readonly event_id: string;
  readonly event_type: string;
  readonly occurred_at_ms: number;
  readonly payload_json: string;
}

/** Page result of one events.subscribe request. */
export interface ReplayPage {
  readonly events: readonly ReplayedEvent[];
  readonly next_cursor: number;
  readonly has_more: boolean;
}

/** Protocol response envelope (result xor error). */
export interface ResponseFrame {
  readonly id: string | null;
  readonly result?: Record<string, unknown>;
  readonly error?: { code: number; message: string };
}

/** Deterministic supervision failure with a stable code. */
export class SupervisionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const MAX_LINE_BYTES = 1024 * 1024 + 1;

/** Options for one supervision session. */
export interface SupervisionOptions {
  readonly socketPath: string;
  readonly actor: IdeActor;
  readonly requestTimeoutMs?: number;
  readonly maxBufferedEvents?: number;
  /** How long `ready()` may wait for the Core endpoint to appear. */
  readonly attachTimeoutMs?: number;
}

/**
 * Line-framed client over the workspace's local endpoint. One instance
 * owns one connection; call {@link initialize} exactly once before any
 * other request (the Core enforces the same order server-side).
 * Connections are lazy: `ready()` attaches, retrying while the Core is
 * still creating the endpoint (booting `starting_core` → `attaching`).
 */
export class SupervisionClient {
  #socket: Socket | null;
  readonly #options: SupervisionOptions;
  readonly #actor: IdeActor;
  readonly #timeoutMs: number;
  readonly #maxBuffered: number;
  readonly #attachTimeoutMs: number;
  #buffer = "";
  #sequence = 0;
  #pending: {
    id: string;
    resolve: (frame: ResponseFrame) => void;
    reject: (error: SupervisionError) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  #closed = false;
  #initialized = false;

  constructor(options: SupervisionOptions, socket?: Socket) {
    this.#options = options;
    this.#actor = options.actor;
    this.#timeoutMs = options.requestTimeoutMs ?? 5_000;
    this.#maxBuffered = options.maxBufferedEvents ?? 5_000;
    this.#attachTimeoutMs = options.attachTimeoutMs ?? 10_000;
    if (socket !== undefined) {
      this.#socket = socket;
      this.#attachHandlers(socket);
    } else {
      this.#socket = null;
    }
  }

  #attachHandlers(socket: Socket): void {
    socket.setNoDelay(true);
    socket.on("data", (chunk: Buffer) => {
      this.#buffer += chunk.toString("utf8");
      let index = this.#buffer.indexOf("\n");
      while (index >= 0) {
        const line = this.#buffer.slice(0, index);
        this.#buffer = this.#buffer.slice(index + 1);
        if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
          this.#failPending(new SupervisionError("frame_too_large"));
          return;
        }
        this.#deliver(line);
        index = this.#buffer.indexOf("\n");
      }
      if (Buffer.byteLength(this.#buffer, "utf8") > MAX_LINE_BYTES) {
        this.#failPending(new SupervisionError("frame_too_large"));
      }
    });
    socket.on("error", () => this.#failPending(new SupervisionError("transport_error")));
    socket.on("close", () => this.#failPending(new SupervisionError("disconnected")));
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Await socket connectivity, retrying while the endpoint is still booting. */
  async ready(): Promise<void> {
    if (this.#socket !== null && this.#socket.readyState === "open") return;
    const deadline = Date.now() + this.#attachTimeoutMs;
    for (;;) {
      const attempt = await new Promise<Socket | null>((resolve) => {
        const candidate = connect(this.#options.socketPath);
        candidate.once("connect", () => resolve(candidate));
        candidate.once("error", () => {
          candidate.destroy();
          resolve(null);
        });
      });
      if (attempt !== null) {
        this.#socket = attempt;
        this.#attachHandlers(attempt);
        return;
      }
      if (Date.now() >= deadline) {
        throw new SupervisionError("attach_timeout");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  #requireSocket(): Socket {
    if (this.#socket === null || this.#socket.readyState !== "open") {
      throw new SupervisionError("not_attached");
    }
    return this.#socket;
  }

  #deliver(line: string): void {
    if (line.trim().length === 0) return;
    let parsed: ResponseFrame;
    try {
      parsed = JSON.parse(line) as ResponseFrame;
    } catch {
      this.#failPending(new SupervisionError("invalid_json"));
      return;
    }
    const pending = this.#pending;
    if (pending === null) return;
    if (parsed.id !== null && pending.id !== parsed.id) return;
    clearTimeout(pending.timer);
    this.#pending = null;
    pending.resolve(parsed);
  }

  #failPending(error: SupervisionError): void {
    const pending = this.#pending;
    if (pending === null) return;
    clearTimeout(pending.timer);
    this.#pending = null;
    pending.reject(error);
  }

  #request(method: IdeMethod, params: Record<string, unknown>): Promise<ResponseFrame> {
    if (this.#closed) {
      return Promise.reject(new SupervisionError("client_closed"));
    }
    this.#sequence += 1;
    const now = Date.now();
    const frame = encodeRequest(
      method,
      this.#actor,
      `${this.#actor.renderer_id}-sup-${this.#sequence.toString().padStart(6, "0")}`,
      params,
      now,
      now + this.#timeoutMs,
      CURRENT_PROTOCOL_VERSION,
      typeof params.idempotency_key === "string" ? params.idempotency_key : undefined,
    );
    return new Promise<ResponseFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending = null;
        reject(new SupervisionError("deadline_exceeded"));
      }, this.#timeoutMs);
      this.#pending = { id: frame.request_id, resolve, reject, timer };
      const socket = this.#requireSocket();
      socket.write(frame.bytes);
      socket.write("\n");
    });
  }

  /** One-time handshake with the bootstrap token captured from Core stdout. */
  async initialize(
    bootstrapToken: string,
  ): Promise<{ protocol_version: string; core_build: string; capabilities: readonly string[] }> {
    const response = await this.#request("core.initialize", { bootstrap_token: bootstrapToken });
    if (response.error) {
      throw new SupervisionError(response.error.message);
    }
    const result = response.result ?? {};
    const version = typeof result.protocol_version === "string" ? result.protocol_version : "";
    if (version !== CURRENT_PROTOCOL_VERSION && version !== PREVIOUS_PROTOCOL_VERSION) {
      throw new SupervisionError("incompatible_protocol");
    }
    if (typeof result.core_build !== "string" || !Array.isArray(result.capabilities)) {
      throw new SupervisionError("invalid_response");
    }
    this.#initialized = true;
    return {
      protocol_version: version,
      core_build: result.core_build,
      capabilities: result.capabilities.filter((value): value is string => typeof value === "string"),
    };
  }

  /**
   * One governed-run mutation (goal.create, plan.freeze, run.*, approval
   * resolution...). The frame validation, deadline and handshake order
   * are identical to every other request; the Core re-validates and
   * owns the outcome — this side only observes the result or error.
   */
  async request(method: IdeMethod, params: Record<string, unknown>): Promise<unknown> {
    if (method === "core.initialize") {
      throw new SupervisionError("use_initialize_for_handshake");
    }
    if (!this.#initialized) {
      throw new SupervisionError("not_initialized");
    }
    const response = await this.#request(method, params);
    if (response.error) {
      throw new SupervisionError(response.error.message);
    }
    return response.result ?? {};
  }

  /** Current Core health snapshot. */
  async health(): Promise<{ status: string; run_count: number; event_count: number }> {
    const response = await this.#request("core.health", {});
    if (response.error) {
      throw new SupervisionError(response.error.message);
    }
    const result = response.result ?? {};
    if (typeof result.status !== "string") {
      throw new SupervisionError("invalid_response");
    }
    return {
      status: result.status,
      run_count: typeof result.run_count === "number" ? result.run_count : 0,
      event_count: typeof result.event_count === "number" ? result.event_count : 0,
    };
  }

  /** Replay one bounded page after a durable cursor. */
  async replay(afterSequence: number, limit: number): Promise<ReplayPage> {
    const response = await this.#request("events.subscribe", { after_sequence: afterSequence, limit });
    if (response.error) {
      throw new SupervisionError(response.error.message);
    }
    const result = response.result ?? {};
    const events = Array.isArray(result.events) ? result.events : [];
    if (this.#bufferedTotal + events.length > this.#maxBuffered) {
      throw new SupervisionError("buffer_overflow");
    }
    this.#bufferedTotal += events.length;
    return {
      events: events.filter((value): value is ReplayedEvent => typeof value?.sequence === "number"),
      next_cursor: typeof result.next_cursor === "number" ? result.next_cursor : afterSequence,
      has_more: result.has_more === true,
    };
  }

  #bufferedTotal = 0;

  /** Drain pages from a cursor, acknowledging each page's cursor. */
  async *replayAll(afterSequence: number, pageSize = 100): AsyncGenerator<ReplayPage> {
    let cursor = afterSequence;
    for (;;) {
      const page = await this.replay(cursor, pageSize);
      cursor = page.next_cursor;
      yield page;
      if (!page.has_more || page.events.length === 0) return;
    }
  }

  close(): void {
    this.#closed = true;
    this.#failPending(new SupervisionError("client_closed"));
    this.#socket?.destroy();
  }
}
