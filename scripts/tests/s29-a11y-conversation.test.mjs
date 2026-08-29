/**
 * S29-WP06 — conversation journey accessibility tests: rate-limited
 * summarized streaming announcements, keyboard-operable context chips,
 * and failure behavior that retains drafts and explains recovery.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const composer = await src("composerState.js");
const conversation = await src("conversationModel.js");
const receipts = await src("contextReceipt.js");

const manifestPath = join(root, "apps/desktop-codeoss/extensions/saber-agent/package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

test("S29-WP06 streaming announcements are rate-limited and summarized", () => {
  const limiter = new composer.AnnouncementLimiter(5000);
  assert.equal(limiter.allow(0), true, "first announcement passes");
  assert.equal(limiter.allow(1000), false, "burst announcements are suppressed");
  assert.equal(limiter.allow(4999), false);
  assert.equal(limiter.allow(5000), true, "the next window passes");
  const stream = new conversation.ConversationStream();
  stream.ingest([
    { eventId: "a", kind: "agent-summary", atMs: 1, payload: { text: "one" } },
    { eventId: "b", kind: "artifact", atMs: 2, payload: { text: "two" } },
  ]);
  const announcement = conversation.ConversationStream.announcementFor(stream.messages(), 0, 2);
  assert.equal(announcement.spokenPerMessage, false);
  assert.equal(announcement.politeness, "polite");
});

test("S29-WP06 context chips are fully keyboard operable", () => {
  const preview = new receipts.ContextPreview();
  const chip = preview.add({
    sourceId: "src/panel.ts",
    sourceType: "file-selection",
    revision: "rev-1",
    reason: "user-pinned",
    trust: "high",
    sensitivity: "internal",
    tokenEstimate: 40,
    transformation: "none",
    destinationProvider: "cloud-a",
    retentionPolicy: "request-only",
  });
  assert.equal(chip.keyboardRemovable, true);
  assert.equal(typeof chip.removeAction, "string");
  const commands = manifest.contributes.commands.map((command) => command.command);
  assert.ok(commands.includes(chip.removeAction), "the chip removal action is a contributed command");
});

test("S29-WP06 failures retain the draft and explain recovery", () => {
  const box = new composer.Composer();
  box.type("half-written question");
  box.ready();
  box.sending();
  for (const reason of ["provider-timeout", "partial-stream", "offline-transition"]) {
    const outcome = box.fail(reason);
    assert.equal(outcome.draftRetained, true, reason);
    assert.ok(outcome.recovery.length > 0, `${reason} explains recovery`);
    box.ready();
    box.sending();
  }
  assert.equal(box.draft, "half-written question");
});

test("S29-WP06 conversation journey is keyboard-reachable in the manifest", () => {
  const commands = manifest.contributes.commands.map((command) => command.command);
  for (const command of [
    "saber.conversation.focus",
    "saber.conversation.retry",
    "saber.conversation.previewContext",
    "saber.conversation.excludeFragment",
  ]) {
    assert.ok(commands.includes(command), `conversation command ${command}`);
  }
  const keybindings = manifest.contributes.keybindings;
  assert.ok(
    keybindings.some((binding) => binding.command === "saber.conversation.focus"),
    "focus is keybound",
  );
});
