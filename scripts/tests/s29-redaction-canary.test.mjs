/**
 * S29-WP05 — privacy controls: exclusion evidence, honest revocation,
 * canary containment and draft storage policy.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const privacy = await src("privacyControls.js");
const receipts = await src("contextReceipt.js");
const conversation = await src("conversationModel.js");

const SECRET_CANARY = { kind: "secret", value: "CANARY-SECRET-a1b2c3", marker: "secret-canary" };
const SENSITIVE_CANARY = { kind: "sensitive-data", value: "CANARY-PII-99887766", marker: "pii-canary" };
const CANARIES = [SECRET_CANARY, SENSITIVE_CANARY];

function fragment(overrides = {}) {
  return {
    sourceId: "notes/todo.md",
    sourceType: "file",
    revision: "rev-1",
    reason: "user-pinned",
    trust: "medium",
    sensitivity: "internal",
    tokenEstimate: 50,
    transformation: "none",
    destinationProvider: "cloud-a",
    retentionPolicy: "request-only",
    ...overrides,
  };
}

test("S29-WP05 excluded content and secret canaries are absent from provider fixtures", () => {
  const fragments = [
    fragment(),
    fragment({ sourceId: "notes/secret-env.md", sensitivity: "confidential", tokenEstimate: 20 }),
  ];
  const { remainingFragments, evidence } = privacy.excludeBeforeDispatch(fragments, "notes/secret-env.md", 10);
  assert.equal(remainingFragments.length, 1);
  assert.equal(evidence.kind, "context.fragment_excluded");
  // The provider fixture is exactly the remaining fragments — no excluded
  // text, no canaries.
  const fixture =
    JSON.stringify(remainingFragments) + JSON.stringify({ note: `user asked to keep ${SECRET_CANARY.value} private` });
  const scan = privacy.canaryScan(fixture, CANARIES);
  assert.equal(scan.clean, false, "planted canary must be detected");
  assert.equal(scan.hits.length, 1);
  const cleanScan = privacy.canaryScan(JSON.stringify(remainingFragments), CANARIES);
  assert.equal(cleanScan.clean, true);
  assert.deepEqual(cleanScan.hits, []);
});

test("S29-WP05 canary scan validates its canary inputs", () => {
  assert.throws(() => privacy.canaryScan("body", [{ kind: "not-a-kind", value: "x" }]), /invalid_canary/);
  assert.throws(() => privacy.canaryScan("body", [{ kind: "secret" }]), /invalid_canary/);
  assert.deepEqual([...privacy.CANARY_KINDS], ["secret", "sensitive-data"]);
});

test("S29-WP05 revoke blocks future retrieval and never lies about contacted providers", () => {
  const untouched = privacy.revoke({ recordId: "mem-1" }, { alreadyContactedProviders: [] });
  assert.equal(untouched.futureRetrieval, "blocked");
  assert.match(untouched.honestNotice, /revocation is complete/);
  const contacted = privacy.revoke(
    { recordId: "mem-2" },
    { alreadyContactedProviders: ["cloud-a", "cloud-a", "cloud-b"] },
  );
  assert.deepEqual([...contacted.alreadyContactedProviders], ["cloud-a", "cloud-b"]);
  assert.match(contacted.honestNotice, /CANNOT claim deletion/);
  assert.match(contacted.honestNotice, /cloud-a, cloud-b/);
  assert.equal(contacted.derivedRecords, "cascaded");
});

test("S29-WP05 local drafts live only in approved, encrypted, crash-excluded storage", () => {
  const compliant = privacy.assertDraftStorage({
    storage: "approved-profile-storage",
    encryption: "profile-key",
    includedInCrashDumps: false,
    syncedRemotely: false,
  });
  assert.equal(compliant.compliant, true);
  const violations = privacy.assertDraftStorage({
    storage: "desktop-folder",
    encryption: "none",
    includedInCrashDumps: true,
    syncedRemotely: true,
  });
  assert.equal(violations.compliant, false);
  assert.deepEqual(
    [...violations.violations],
    ["storage-not-approved", "encryption-missing", "crash-dump-inclusion", "remote-sync-not-allowed"],
  );
  assert.equal(privacy.DRAFT_STORAGE_POLICY.includedInCrashDumps, false);
});

test("S29-WP05 redaction in copied conversation text keeps canaries out", () => {
  const stream = new conversation.ConversationStream();
  stream.ingest([
    {
      eventId: "e1",
      kind: "user",
      atMs: 1,
      payload: { text: `my key is {"apiKey": "${SENSITIVE_CANARY.value}"} ok?` },
    },
  ]);
  const copied = stream.copyText();
  const scan = privacy.canaryScan(copied, CANARIES);
  assert.equal(scan.clean, true, "copied output carries markers, not values");
  assert.ok(copied.includes(conversation.REDACTION_MARKER));
});

test("S29-WP05 preview exclusion and dispatch exclusion agree on evidence shape", () => {
  const preview = new receipts.ContextPreview();
  preview.add(fragment({ sourceId: "notes/scratch.md" }));
  const previewEvidence = preview.exclude("notes/scratch.md", 5);
  const dispatchEvidence = privacy.excludeBeforeDispatch(
    [fragment({ sourceId: "notes/scratch.md" })],
    "notes/scratch.md",
    7,
  ).evidence;
  assert.equal(previewEvidence.kind, dispatchEvidence.kind);
  assert.equal(previewEvidence.sourceId, dispatchEvidence.sourceId);
  assert.equal(previewEvidence.wouldHaveGoneTo, dispatchEvidence.wouldHaveGoneTo);
});
