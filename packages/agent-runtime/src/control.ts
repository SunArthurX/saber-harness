import type { ControlMethod, ControlRequest } from "./generated/contracts.js";

export const MAX_FRAME_BYTES = 1024 * 1024;
export const CURRENT_PROTOCOL_VERSION = "1.0.0";
export const PREVIOUS_PROTOCOL_VERSION = "0.1.0";

const METHODS = new Set<ControlMethod>([
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
]);
const MUTATIONS = new Set<ControlMethod>([
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
]);

export class ProtocolViolation extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

export function decodeControlRequest(frame: Uint8Array, nowUnixMs: number): ControlRequest {
  if (frame.byteLength > MAX_FRAME_BYTES) throw new ProtocolViolation("frame_too_large");
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame));
  } catch {
    throw new ProtocolViolation("invalid_json");
  }
  if (!isRecord(input) || !hasOnly(input, new Set(["jsonrpc", "protocol_version", "method", "context", "params"]))) {
    throw new ProtocolViolation("invalid_request");
  }
  if (
    typeof input.jsonrpc !== "string" ||
    typeof input.protocol_version !== "string" ||
    typeof input.method !== "string" ||
    !isRecord(input.context) ||
    !isRecord(input.params)
  ) {
    throw new ProtocolViolation("invalid_request");
  }
  const context = input.context;
  if (
    !hasOnly(
      context,
      new Set(["request_id", "actor_id", "workspace_id", "causation_id", "deadline_unix_ms", "idempotency_key"]),
    ) ||
    typeof context.request_id !== "string" ||
    typeof context.actor_id !== "string" ||
    typeof context.workspace_id !== "string" ||
    !Number.isSafeInteger(context.deadline_unix_ms) ||
    (context.deadline_unix_ms as number) < 0 ||
    (context.causation_id !== undefined && context.causation_id !== null && typeof context.causation_id !== "string") ||
    (context.idempotency_key !== undefined &&
      context.idempotency_key !== null &&
      typeof context.idempotency_key !== "string")
  ) {
    throw new ProtocolViolation("invalid_request");
  }
  if (input.jsonrpc !== "2.0") throw new ProtocolViolation("invalid_jsonrpc_version");
  if (input.protocol_version !== CURRENT_PROTOCOL_VERSION && input.protocol_version !== PREVIOUS_PROTOCOL_VERSION) {
    throw new ProtocolViolation("incompatible_protocol");
  }
  if (!METHODS.has(input.method as ControlMethod)) {
    throw new ProtocolViolation("unknown_method");
  }
  if ((context.deadline_unix_ms as number) < nowUnixMs) throw new ProtocolViolation("deadline_exceeded");
  if (
    MUTATIONS.has(input.method as ControlMethod) &&
    (typeof context.idempotency_key !== "string" || context.idempotency_key.length === 0)
  ) {
    throw new ProtocolViolation("idempotency_required");
  }
  return input as unknown as ControlRequest;
}
