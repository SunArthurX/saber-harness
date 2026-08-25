import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeControlRequest, MAX_FRAME_BYTES, ProtocolViolation } from "../dist/index.js";

const fixture = readFileSync(new URL("../../../schemas/fixtures/v1/control-request.json", import.meta.url));

test("current control request fixture round trips", () => {
  const request = decodeControlRequest(fixture, 0);
  assert.equal(request.protocol_version, "1.0.0");
  assert.equal(request.method, "run.cancel");
});

test("N-1 is accepted and unknown versions fail closed", () => {
  const input = JSON.parse(fixture.toString("utf8"));
  input.protocol_version = "0.1.0";
  assert.equal(decodeControlRequest(Buffer.from(JSON.stringify(input)), 0).protocol_version, "0.1.0");
  input.protocol_version = "999.0.0";
  assert.throws(() => decodeControlRequest(Buffer.from(JSON.stringify(input)), 0), /incompatible_protocol/);
});

test("frame, deadline, unknown method and idempotency violations are deterministic", () => {
  assert.throws(() => decodeControlRequest(new Uint8Array(MAX_FRAME_BYTES + 1), 0), /frame_too_large/);
  const input = JSON.parse(fixture.toString("utf8"));
  input.context.deadline_unix_ms = 1;
  assert.throws(() => decodeControlRequest(Buffer.from(JSON.stringify(input)), 2), /deadline_exceeded/);
  input.context.deadline_unix_ms = 10;
  input.method = "run.destroy";
  assert.throws(() => decodeControlRequest(Buffer.from(JSON.stringify(input)), 2), /unknown_method/);
  input.method = "run.cancel";
  delete input.context.idempotency_key;
  assert.throws(() => decodeControlRequest(Buffer.from(JSON.stringify(input)), 2), ProtocolViolation);
  input.context.idempotency_key = "";
  assert.throws(() => decodeControlRequest(Buffer.from(JSON.stringify(input)), 2), /idempotency_required/);
});

test("malformed UTF-8 and schema-invalid context values fail closed", () => {
  assert.throws(
    () => decodeControlRequest(Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]), 0),
    /invalid_json/,
  );
  const input = JSON.parse(fixture.toString("utf8"));
  input.context.deadline_unix_ms = 1.5;
  assert.throws(() => decodeControlRequest(Buffer.from(JSON.stringify(input)), 0), /invalid_request/);
  input.context.deadline_unix_ms = 10;
  input.context.causation_id = 7;
  assert.throws(() => decodeControlRequest(Buffer.from(JSON.stringify(input)), 0), /invalid_request/);
});
