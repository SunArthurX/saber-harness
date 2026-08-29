import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalCardViolation,
  approvalCardFor,
  approvalResolveIntent,
  ContextPanelViolation,
  contextPanelFor,
  encodeRequest,
  excludeIntent,
  IdeClient,
  MAX_FRAME_BYTES,
  ProtocolViolation,
  REDACTED_MARKER,
  RunView,
  replayPresentation,
  revokeIntent,
} from "../dist/index.js";

class RecordingTransport {
  frames = [];

  send(frame) {
    this.frames.push(frame);
  }
}

class FakeEventSource {
  constructor(events) {
    this.events = events;
  }

  readAfter(cursor, limit) {
    return this.events.filter((event) => event.sequence > cursor).slice(0, limit);
  }
}

test("renderer crash mid-run leaves run state untouched and replay identical", () => {
  const events = Array.from({ length: 5 }, (_, index) => ({
    sequence: index + 1,
    type: index % 2 === 0 ? "run.state_changed" : "tool.intent_recorded",
    payload: { step: index },
  }));
  const core = new FakeEventSource(events);

  const first = new RunView(core);
  first.refresh();
  assert.equal(first.state.cursor, 5);
  const seenBeforeCrash = first.state;

  // "Crash": drop the view entirely. The core keeps its events.
  const restarted = new RunView(core, 0);
  const replayed = replayPresentation(core, 0);
  restarted.refresh();
  assert.deepEqual(restarted.state, seenBeforeCrash, "replay reconstructs the identical view");
  assert.deepEqual(
    replayed.map((event) => event.sequence),
    [1, 2, 3, 4, 5],
  );

  // Mid-run growth after the crash replays for the next client.
  const grown = new FakeEventSource([...events, { sequence: 6, type: "run.state_changed", payload: { step: 5 } }]);
  const late = new RunView(grown, 3);
  const fresh = late.refresh();
  assert.deepEqual(
    fresh.map((event) => event.sequence),
    [4, 5, 6],
  );
});

test("version, method, frame-size, deadline and identity violations fail closed pre-send", () => {
  const transport = new RecordingTransport();
  const client = new IdeClient(transport, { renderer_id: "renderer_01", workspace_id: "ws_01" });

  assert.throws(
    () => encodeRequest("run.cancel", { renderer_id: "r", workspace_id: "w" }, "req", {}, 0, 10, "999.0.0"),
    /incompatible_protocol/,
  );
  assert.throws(
    () => encodeRequest("run.destroy", { renderer_id: "r", workspace_id: "w" }, "req", {}, 0, 10),
    /unknown_method/,
  );
  assert.throws(
    () => encodeRequest("run.cancel", { renderer_id: "", workspace_id: "w" }, "req", {}, 0, 10),
    /invalid_actor/,
  );
  assert.throws(
    () => encodeRequest("run.cancel", { renderer_id: "r", workspace_id: "w" }, "req", {}, 10, 10),
    /deadline_exceeded/,
  );
  const huge = { blob: "x".repeat(MAX_FRAME_BYTES) };
  assert.throws(
    () => encodeRequest("run.cancel", { renderer_id: "r", workspace_id: "w" }, "req", huge, 0, 10),
    /frame_too_large/,
  );
  // Mutations require their context idempotency key once the frame is legal.
  assert.throws(
    () => encodeRequest("run.cancel", { renderer_id: "r", workspace_id: "w" }, "req", {}, 0, 10),
    /idempotency_required/,
  );
  assert.equal(transport.frames.length, 0, "nothing was sent for any violation");

  // The happy path sends exactly one validated frame.
  client.request("run.cancel", { reason: "user" }, 0, 10_000, "idem-happy-1");
  assert.equal(transport.frames.length, 1);
  const decoded = JSON.parse(new TextDecoder().decode(transport.frames[0].bytes));
  assert.equal(decoded.method, "run.cancel");
  assert.equal(decoded.context.actor_id, "renderer_01");
});

test("client surface exposes no effect path outside the protocol", () => {
  const transport = new RecordingTransport();
  const client = new IdeClient(transport, { renderer_id: "renderer_01", workspace_id: "ws_01" });
  const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
  assert.deepEqual(
    surface.filter((name) => name !== "constructor"),
    ["request"],
    "the only renderer capability is issuing protocol requests",
  );
});

test("approval cards cannot outscope their request, outlive their TTL or hide deny", () => {
  const exact = { match: "exact", resource: "workspace://ws_01/repo/generated.bin" };
  const base = {
    request_id: "approval_01",
    action: "fs.delete",
    resource: "workspace://ws_01/repo/generated.bin",
    summary: "delete generated output",
    choices: ["approve this exact file once", "deny"],
    expires_at_ms: 2_000,
  };

  const card = approvalCardFor({ ...base, scope: exact }, 1_000);
  assert.equal(card.alive, true);
  assert.equal(card.displayedScope, "workspace://ws_01/repo/generated.bin");
  assert.deepEqual(approvalResolveIntent(card, "deny"), {
    method: "approval.resolve",
    params: { request_id: "approval_01", choice: "deny" },
  });

  // A workspace-wide display over an exact request is broader: rejected.
  assert.throws(
    () => approvalCardFor({ ...base, scope: exact }, 1_000, { match: "prefix", resource: "workspace://ws_01" }),
    /scope_broader_than_request/,
  );

  // A prefix-scoped request may display itself or something narrower.
  const repoScope = { match: "prefix", resource: "workspace://ws_01/repo" };
  const repoCard = approvalCardFor({ ...base, scope: repoScope }, 1_000);
  assert.equal(repoCard.displayedScope, "workspace://ws_01/repo/…");
  approvalCardFor({ ...base, scope: repoScope }, 1_000, {
    match: "exact",
    resource: "workspace://ws_01/repo/generated.bin",
  });
  // Widening back to the workspace is broader than the request: rejected.
  assert.throws(
    () => approvalCardFor({ ...base, scope: repoScope }, 1_000, { match: "prefix", resource: "workspace://ws_01" }),
    /scope_broader_than_request/,
  );

  // Missing deny alternative: dark pattern, rejected.
  assert.throws(
    () => approvalCardFor({ ...base, scope: exact, choices: ["approve everything"] }, 1_000),
    /missing_deny_alternative/,
  );

  // TTL death.
  assert.throws(() => approvalCardFor({ ...base, scope: exact }, 2_000), /expired/);

  // Choices not offered cannot be resolved.
  assert.throws(() => approvalResolveIntent(card, "approve all"), /choice_not_offered/);
});

test("explanations render markers only and intents stay protocol-bound", () => {
  const explanation = {
    selections: [
      {
        chunk_id: "chunk_1",
        reason: { kind: "keyword_match", term: "deploy" },
        origin: "doc://chunk_1",
        trust: "untrusted",
        sensitivity: "internal",
        redacted_fields: ["secret_detail"],
        fields: { summary: "deploy failure", secret_detail: REDACTED_MARKER },
      },
    ],
    exclusions: [{ chunk_id: "chunk_2", reason: "scope" }],
  };

  const panel = contextPanelFor(explanation);
  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].fields.secret_detail, REDACTED_MARKER);
  assert.equal(panel.items[0].headline, "keyword_match:deploy");
  assert.equal(panel.items[0].trust, "untrusted");

  // A raw value under a redacted path is a leak and fails closed.
  assert.throws(
    () =>
      contextPanelFor({
        ...explanation,
        selections: [
          {
            ...explanation.selections[0],
            fields: { summary: "deploy failure", secret_detail: "customer acme lost data" },
          },
        ],
      }),
    /redacted_field_leak/,
  );

  assert.deepEqual(excludeIntent("chunk_1"), {
    method: "context.exclude",
    params: { chunk_id: "chunk_1" },
  });
  assert.deepEqual(revokeIntent("chunk_1"), {
    method: "context.revoke",
    params: { chunk_id: "chunk_1" },
  });
  assert.throws(() => excludeIntent(""), /invalid_chunk/);
  assert.ok(ContextPanelViolation);
  assert.ok(ProtocolViolation);
});
