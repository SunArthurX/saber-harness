/**
 * S31-WP02/WP03/WP06 — review comments, evidence, adversarial completion.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const comments = await src("reviewComments.js");
const evidence = await src("verificationEvidence.js");

test("S31-WP02 comments bind path, side, fingerprint and revision", () => {
  const comment = new comments.ReviewComment({
    id: "c1",
    path: "src/hello.ts",
    side: "new",
    line: 3,
    hunkFingerprint: "hunk-9",
    revision: "rev-1",
    body: "rename greet",
  });
  assert.equal(comment.author, "user");
  assert.throws(
    () => new comments.ReviewComment({ id: "c2", path: "a", side: "middle", hunkFingerprint: "h", revision: "r" }),
    /invalid_comment_binding/,
  );
  assert.deepEqual([...comments.SIDES], ["old", "new"]);
});

test("S31-WP02 stale comments are marked, never silently relocated", () => {
  const thread = new comments.CommentThread();
  thread.add({ id: "c1", path: "a.ts", side: "new", hunkFingerprint: "h1", revision: "r1", body: "x" });
  thread.add({ id: "c2", path: "b.ts", side: "old", hunkFingerprint: "h2", revision: "r1", body: "y" });
  const afterMove = thread.reconcile(["h1", "h2-moved"]);
  assert.deepEqual([...afterMove.stale], ["c2"]);
  assert.equal(thread.list().length, 2, "stale comments survive, marked");
});

test("S31-WP02 keep/reject hunks create review intents, not mutations", () => {
  const intent = comments.hunkIntent("reject", "a.ts", "h1", "rev-1");
  assert.equal(intent.kind, "review.hunk_intent");
  assert.equal(intent.mutatesFiles, false);
  assert.throws(() => comments.hunkIntent("delete-file", "a.ts", "h1", "r"), /invalid_hunk_action/);
  assert.equal(comments.KEYBOARD_NAVIGATION.length, 4);
  assert.ok(comments.KEYBOARD_NAVIGATION.every((step) => step.key.length > 0));
});

test("S31-WP03 evidence states distinguish seven outcomes with full metadata", () => {
  assert.deepEqual(
    [...evidence.EVIDENCE_STATES],
    ["not-run", "running", "passed", "failed", "flaky", "cancelled", "stale"],
  );
  const passed = evidence.observation({
    kind: "test",
    command: "node scripts/check.mjs",
    environment: "node 24",
    exitCode: 0,
    durationMs: 120,
    stdoutDigest: "dd",
    stderrDigest: "de",
    testCounts: { passed: 3, failed: 0 },
    artifactLinks: ["run-1#3"],
    treeDigest: "tree-1",
  });
  assert.equal(passed.state, "passed");
  assert.equal(passed.owner, "tester");
  assert.equal(evidence.observation({ kind: "test", command: "x", environment: "e", exitCode: 75 }).state, "flaky");
  assert.equal(
    evidence.observation({ kind: "test", command: "x", environment: "e", exitCode: 130 }).state,
    "cancelled",
  );
  assert.equal(evidence.observation({ kind: "test", command: "x", environment: "e" }).state, "not-run");
  assert.throws(
    () => evidence.observation({ kind: "deploy", command: "x", environment: "e" }),
    /unknown_evidence_kind/,
  );
});

test("S31-WP03 security checks carry separate severity and ownership", () => {
  const security = evidence.observation({ kind: "security", command: "audit", environment: "e", exitCode: 1 });
  assert.equal(severityOf(security), "critical");
  assert.equal(security.owner, "security");
  assert.equal(security.separate, true);
  function severityOf(item) {
    return item.severity;
  }
});

test("S31-WP03 a changed tree invalidates affected evidence", () => {
  const items = [
    evidence.observation({ kind: "test", command: "a", environment: "e", exitCode: 0, treeDigest: "tree-1" }),
    evidence.observation({ kind: "lint", command: "b", environment: "e", exitCode: 0, treeDigest: "tree-2" }),
  ];
  const invalidated = evidence.invalidateOnTreeChange(items, "tree-1");
  assert.equal(invalidated[0].state, "passed");
  assert.equal(invalidated[1].state, "stale");
  assert.equal(invalidated[1].invalidatedBy, "tree-change");
});

test("S31-WP03 preview auto-verify: inconclusive is valid; screenshots never suffice", () => {
  const inconclusive = evidence.previewAutoVerify({ domAssertions: [], a11yAssertions: [], orderedActions: [] });
  assert.equal(inconclusive.outcome, "inconclusive");
  const verified = evidence.previewAutoVerify({
    serverIdentity: "127.0.0.1:4173",
    domAssertions: ["h1 renders"],
    a11yAssertions: ["focus visible"],
    orderedActions: ["click#save"],
    screenshots: ["shot-1.png"],
    testResults: [{ exitCode: 0 }],
  });
  assert.equal(verified.outcome, "verified");
  assert.equal(verified.screenshotsAloneSuffice, false);
});

test("S31-WP06 a model message alone never completes; producers cannot sole-sign", () => {
  const good = [
    evidence.observation({ kind: "test", command: "t", environment: "e", exitCode: 0 }),
    evidence.observation({ kind: "security", command: "s", environment: "e", exitCode: 0 }),
  ];
  const soloProducer = evidence.completionGate(good, { producer: "agent", signers: ["agent"] });
  assert.equal(soloProducer.completed, false);
  assert.ok(soloProducer.blockers.includes("no-independent-signer"));
  assert.ok(soloProducer.blockers.includes("producer-sole-signer"));
  const forged = evidence.completionGate([], { producer: "agent", signers: ["reviewer"] });
  assert.equal(forged.completed, false);
  assert.ok(forged.blockers.includes("missing-test-evidence"));
  assert.equal(forged.modelMessageAloneCompletes, false);
  const legitimate = evidence.completionGate(good, { producer: "agent", signers: ["agent", "reviewer"] });
  assert.equal(legitimate.completed, true);
  const failingSecurity = evidence.completionGate(
    [good[0], evidence.observation({ kind: "security", command: "s", environment: "e", exitCode: 2 })],
    { producer: "agent", signers: ["reviewer"] },
  );
  assert.equal(failingSecurity.completed, false);
  assert.ok(failingSecurity.blockers.includes("security-evidence-not-passing"));
});
