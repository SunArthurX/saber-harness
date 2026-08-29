/**
 * Untrusted renderer protocol client (ADR-013).
 *
 * The IDE client owns no authority: every mutation is a versioned protocol
 * request validated exactly like the S03 control contract — unknown
 * methods, oversized frames, expired deadlines, invalid identities and
 * version mismatches fail closed before anything is sent. There is no
 * renderer API that touches the host, the event store or a broker
 * directly.
 */

export const MAX_FRAME_BYTES = 1024 * 1024;
export const CURRENT_PROTOCOL_VERSION = "1.0.0";
export const PREVIOUS_PROTOCOL_VERSION = "0.1.0";

/** Mutation methods — they require a context idempotency key. */
const MUTATION_METHODS = new Set<IdeMethod>([
  "run.steer",
  "run.cancel",
  "run.retry",
  "run.fork",
  "run.start",
  "run.pause",
  "run.resume",
  "approval.resolve",
  "goal.create",
  "plan.freeze",
  "changeset.prepare",
  "changeset.apply",
  "changeset.rollback",
  "changeset.commit",
  "context.exclude",
  "context.revoke",
]);

/** IDE-side protocol methods (all routed through the trusted Core). */
export type IdeMethod =
  | "run.steer"
  | "run.cancel"
  | "run.retry"
  | "run.fork"
  | "run.start"
  | "run.pause"
  | "run.resume"
  | "events.subscribe"
  | "approval.resolve"
  | "goal.create"
  | "plan.freeze"
  | "changeset.prepare"
  | "changeset.apply"
  | "changeset.rollback"
  | "changeset.commit"
  | "context.exclude"
  | "context.revoke"
  | "core.initialize"
  | "core.health";

const METHODS = new Set<IdeMethod>([
  "run.steer",
  "run.cancel",
  "run.retry",
  "run.fork",
  "run.start",
  "run.pause",
  "run.resume",
  "events.subscribe",
  "approval.resolve",
  "goal.create",
  "plan.freeze",
  "changeset.prepare",
  "changeset.apply",
  "changeset.rollback",
  "changeset.commit",
  "context.exclude",
  "context.revoke",
  "core.initialize",
  "core.health",
]);

/** Deterministic protocol failure with a stable code. */
export class ProtocolViolation extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Actor identity presented with every frame. */
export interface IdeActor {
  readonly renderer_id: string;
  readonly workspace_id: string;
}

export interface EncodedFrame {
  readonly bytes: Uint8Array;
  readonly request_id: string;
  readonly method: IdeMethod;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Encode one protocol request. Fails closed on version mismatch, unknown
 * methods, oversized frames, invalid identities and past deadlines —
 * nothing is emitted in those cases.
 */
export function encodeRequest(
  method: IdeMethod,
  actor: IdeActor,
  requestId: string,
  params: Record<string, unknown>,
  nowUnixMs: number,
  deadlineUnixMs: number,
  protocolVersion: string = CURRENT_PROTOCOL_VERSION,
  idempotencyKey?: string,
): EncodedFrame {
  if (protocolVersion !== CURRENT_PROTOCOL_VERSION && protocolVersion !== PREVIOUS_PROTOCOL_VERSION) {
    throw new ProtocolViolation("incompatible_protocol");
  }
  if (!METHODS.has(method)) {
    throw new ProtocolViolation("unknown_method");
  }
  if (!isRecord(params)) {
    throw new ProtocolViolation("invalid_params");
  }
  if (
    typeof actor.renderer_id !== "string" ||
    actor.renderer_id.length === 0 ||
    actor.renderer_id.length > 128 ||
    typeof actor.workspace_id !== "string" ||
    actor.workspace_id.length === 0 ||
    actor.workspace_id.length > 128
  ) {
    throw new ProtocolViolation("invalid_actor");
  }
  if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 128) {
    throw new ProtocolViolation("invalid_request_id");
  }
  if (!Number.isSafeInteger(deadlineUnixMs) || deadlineUnixMs <= nowUnixMs) {
    throw new ProtocolViolation("deadline_exceeded");
  }
  const frame = {
    jsonrpc: "2.0",
    protocol_version: protocolVersion,
    method,
    context: {
      request_id: requestId,
      actor_id: actor.renderer_id,
      workspace_id: actor.workspace_id,
      deadline_unix_ms: deadlineUnixMs,
      ...(idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey }),
    },
    params,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(frame));
  if (bytes.byteLength > MAX_FRAME_BYTES) {
    throw new ProtocolViolation("frame_too_large");
  }
  // Frame limits stay the first contract; mutations then require their
  // idempotency key (mirroring the Core's decode order: size first,
  // then method semantics).
  if (MUTATION_METHODS.has(method) && (typeof idempotencyKey !== "string" || idempotencyKey.length === 0)) {
    throw new ProtocolViolation("idempotency_required");
  }
  return { bytes, request_id: requestId, method };
}

/**
 * The renderer-side transport handle. `send` is the ONLY effect path: the
 * frame must already be validated by {@link encodeRequest}. Implementations
 * forward bytes to the Core; they never gain authority by doing so.
 */
export interface CoreTransport {
  send(frame: EncodedFrame): void;
}

/** An untrusted IDE client bound to one transport and actor. */
export class IdeClient {
  readonly #transport: CoreTransport;
  readonly #actor: IdeActor;
  #sequence = 0;

  constructor(transport: CoreTransport, actor: IdeActor) {
    this.#transport = transport;
    this.#actor = actor;
  }

  /** Issue one protocol request; every failure throws before any send. */
  request(
    method: IdeMethod,
    params: Record<string, unknown>,
    nowUnixMs: number,
    deadlineUnixMs: number,
    idempotencyKey?: string,
  ): EncodedFrame {
    this.#sequence += 1;
    const requestId = `${this.#actor.renderer_id}-${this.#sequence.toString().padStart(6, "0")}`;
    const frame = encodeRequest(
      method,
      this.#actor,
      requestId,
      params,
      nowUnixMs,
      deadlineUnixMs,
      CURRENT_PROTOCOL_VERSION,
      idempotencyKey,
    );
    this.#transport.send(frame);
    return frame;
  }
}
