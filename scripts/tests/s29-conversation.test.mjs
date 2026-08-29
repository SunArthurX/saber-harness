/**
 * S29-WP01/WP02 — conversation model and composer tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const model = await src("conversationModel.js");
const composer = await src("composerState.js");

function fixtureEvents() {
  return [
    { eventId: "e1", kind: "user", atMs: 1, payload: { text: "Summarize the repo" } },
    { eventId: "e2", kind: "agent-summary", atMs: 2, payload: { text: "Three packages.", evidenceRef: "run-1#3" } },
    { eventId: "e3", kind: "tool-summary", atMs: 3, payload: { text: "read 4 files", evidenceRef: "run-1#2" } },
  ];
}

test("S29-WP01 all ten message kinds render distinctly", () => {
  assert.equal(model.MESSAGE_KINDS.length, 10);
  const roles = model.MESSAGE_KINDS.map((kind) => model.RENDER_CONTRACT[kind].role);
  assert.equal(new Set(roles).size, 10, "each kind has its own role label");
  const stream = new model.ConversationStream();
  stream.ingest(
    model.MESSAGE_KINDS.map((kind, index) => ({ eventId: `k${index}`, kind, atMs: index, payload: { text: kind } })),
  );
  for (const message of stream.messages()) {
    assert.ok(message.role.length > 0);
    assert.equal(typeof message.collapsedByDefault, "boolean");
  }
});

test("S29-WP01 tool detail collapses by default; evidence navigation survives", () => {
  const stream = new model.ConversationStream();
  stream.ingest(fixtureEvents());
  const tool = stream.messages().find((message) => message.kind === "tool-summary");
  assert.equal(tool.collapsedByDefault, true);
  assert.equal(tool.evidenceRef, "run-1#2");
  const summary = stream.messages().find((message) => message.kind === "agent-summary");
  assert.equal(summary.collapsedByDefault, false);
});

test("S29-WP01 reconnect replay deduplicates by event ID", () => {
  const stream = new model.ConversationStream();
  stream.ingest(fixtureEvents());
  const addedAgain = stream.ingest(fixtureEvents());
  assert.deepEqual(addedAgain, [], "replayed pages add nothing");
  assert.equal(stream.messages().length, 3);
  stream.ingest([{ eventId: "e4", kind: "user", atMs: 4, payload: { text: "more" } }]);
  assert.equal(stream.messages().length, 4);
});

test("S29-WP01 hidden chain-of-thought is never exposed", () => {
  const stream = new model.ConversationStream();
  stream.ingest([
    ...fixtureEvents(),
    {
      eventId: "hidden-1",
      kind: "agent-summary",
      atMs: 5,
      payload: { role: "chain-of-thought", text: "private reasoning" },
    },
    { eventId: "hidden-2", kind: "system-notice", atMs: 6, hidden: true, payload: { text: "internal" } },
  ]);
  assert.equal(stream.messages().length, 3);
  assert.equal(stream.withheldCount, 2);
  assert.equal(JSON.stringify(stream.messages()).includes("private reasoning"), false);
});

test("S29-WP01 retry appends a new causal event, never rewriting history", () => {
  const stream = new model.ConversationStream();
  stream.ingest(fixtureEvents());
  stream.retry("e2", "e2-retry", 9);
  const messages = stream.messages();
  assert.equal(messages.length, 4);
  const retry = messages.find((message) => message.eventId === "e2-retry");
  assert.equal(retry.retryOf, "e2");
  const original = messages.find((message) => message.eventId === "e2");
  assert.ok(original, "the original message still exists");
  assert.throws(() => stream.retry("missing", "x", 1), /unknown_message/);
});

test("S29-WP01 copy output carries redaction markers for sensitive fields", () => {
  const stream = new model.ConversationStream();
  stream.ingest([
    { eventId: "e1", kind: "user", atMs: 1, payload: { text: 'config says {"token": "abc123"} inline' } },
  ]);
  const copied = stream.copyText();
  assert.ok(copied.includes(model.REDACTION_MARKER));
  assert.equal(copied.includes("abc123"), false);
});

test("S29-WP01 streaming announcements are summarized, not per-message", () => {
  const announcement = model.ConversationStream.announcementFor(
    [{ kind: "agent-summary" }, { kind: "artifact" }],
    0,
    2,
  );
  assert.equal(announcement.politeness, "polite");
  assert.equal(announcement.spokenPerMessage, false);
  assert.match(announcement.summary, /2 new messages/);
  assert.equal(model.ConversationStream.announcementFor([], 0, 0), null);
});

test("S29-WP02 composer states and transitions are closed", () => {
  assert.equal(composer.COMPOSER_STATES.length, 10);
  assert.deepEqual(
    [...composer.COMPOSER_STATES].sort(),
    [
      "attachment-scanning",
      "context-over-budget",
      "dlp-blocked",
      "drafting",
      "empty",
      "failed",
      "offline-queued",
      "ready",
      "resolving-references",
      "sending",
    ].sort(),
  );
  const box = new composer.Composer();
  assert.throws(() => box.sending(), /invalid_transition:empty->sending/);
  box.type("hello");
  assert.equal(box.state, "drafting");
  box.ready();
  box.sending();
  assert.equal(box.state, "sending");
});

test("S29-WP02 token triggers resolve @ # / $ domains", () => {
  assert.deepEqual(composer.TOKEN_TRIGGERS["@"].resolves, ["file", "symbol", "artifact"]);
  assert.deepEqual(composer.TOKEN_TRIGGERS["#"].resolves, ["goal", "run", "conversation"]);
  assert.deepEqual(composer.TOKEN_TRIGGERS["/"].resolves, ["command", "workflow"]);
  assert.deepEqual(composer.TOKEN_TRIGGERS.$.resolves, ["governed-capability"]);
  const box = new composer.Composer();
  box.type("see @");
  assert.deepEqual(box.resolveToken("@"), ["file", "symbol", "artifact"]);
  assert.throws(() => box.resolveToken("!"), /unknown_trigger/);
});

test("S29-WP02 attachments pass media, size, malware and sensitivity checks", () => {
  const good = { media: "image/png", sizeBytes: 1024, malware: "clean", sensitivity: "internal" };
  assert.equal(composer.validateAttachment(good), null);
  assert.equal(composer.validateAttachment({ ...good, media: "application/x-msdownload" }), "media-not-allowed");
  assert.equal(composer.validateAttachment({ ...good, sizeBytes: 11 * 1024 * 1024 }), "size-over-limit");
  assert.equal(composer.validateAttachment({ ...good, malware: "unknown" }), "malware-scan-required");
  assert.equal(composer.validateAttachment({ ...good, sensitivity: "blocked" }), "sensitivity-blocked");
  const box = new composer.Composer();
  box.type("report +");
  const accepted = box.attach(good);
  assert.equal(accepted.accepted, true);
  assert.equal(box.attachments.length, 1);
  const rejected = box.attach({ ...good, sensitivity: "restricted" });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.draftRetained, true);
  assert.match(rejected.recovery, /Remove or fix/);
  assert.equal(box.state, "dlp-blocked");
});

test("S29-WP02 queue and steer are separate ops with visible boundaries", () => {
  const box = new composer.Composer();
  box.type("later");
  const queued = box.queue();
  assert.equal(queued.operation, "queue");
  assert.equal(queued.visibleBoundary, "queue-tail");
  const steered = box.steer(42);
  assert.equal(steered.operation, "steer");
  assert.equal(steered.visibleBoundary, 42);
  assert.notEqual(queued.operation, steered.operation);
  assert.throws(() => box.steer("not-a-cursor"), /steer_requires_event_cursor/);
});

test("S29-WP02 failure retains the draft and explains recovery", () => {
  const box = new composer.Composer();
  box.type("important text");
  box.ready();
  box.sending();
  const failure = box.fail("provider-timeout");
  assert.equal(failure.draftRetained, true);
  assert.equal(box.draft, "important text");
  assert.match(failure.recovery, /Draft preserved/);
  const overBudget = new composer.Composer();
  overBudget.type("x");
  overBudget.resolveToken("#");
  assert.match(overBudget.overBudget().recovery, /Exclude fragments/);
});
