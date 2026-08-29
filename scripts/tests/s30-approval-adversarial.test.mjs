/**
 * S30-WP03 — approval card and adversarial gate tests (projection side;
 * the Core re-verifies every rule before executing).
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const approvalGate = await src("approvalGate.js");

const CARD = {
  approvalId: "appr-edit-1000",
  stepId: "edit",
  runId: "run-1",
  planVersion: 1,
  action: "file.edit",
  resource: "notes.md",
  argv: ["node", "scripts/check.mjs", "--full"],
  reason: "record outcome",
  boundary: "worktree:/tmp/wt",
  network: "none",
  secretRefs: [],
  expiresAtMs: 301_000,
  scope: "one-shot",
  digest: "a".repeat(64),
  alternatives: ["deny", "edit-manually"],
};

test("S30-WP03 the card shows every required field", () => {
  const completeness = approvalGate.cardCompleteness(CARD);
  assert.equal(completeness.complete, true);
  assert.equal(approvalGate.CARD_FIELDS.length, 12);
  const broken = approvalGate.cardCompleteness({ ...CARD, argv: undefined, digest: undefined });
  assert.deepEqual([...broken.missing], ["argv", "digest"]);
});

test("S30-WP03 deny is always offered; approve needs a complete card", () => {
  assert.deepEqual(approvalGate.offeredDecisions(CARD), ["deny", "approve"]);
  assert.deepEqual(approvalGate.offeredDecisions({ ...CARD, resource: undefined }), ["deny"]);
});

test("S30-WP03 narrowing can only remove trailing argv, never broaden", () => {
  assert.equal(approvalGate.narrowsScope(["node", "a.js", "--full"], ["node", "a.js"]), true);
  assert.equal(approvalGate.narrowsScope(["node", "a.js"], ["node", "a.js"]), true);
  assert.equal(approvalGate.narrowsScope(["node", "a.js"], ["node", "a.js", "--more"]), false);
  assert.equal(approvalGate.narrowsScope(["node", "a.js"], ["node", "b.js"]), false);
  assert.equal(approvalGate.narrowsScope(["node", "--x", "a.js"], ["node", "a.js"]), false);
});

test("S30-WP03 expired, replayed, changed-resource and changed-plan resolutions fail closed", () => {
  const base = { approvalId: CARD.approvalId, decision: "approve", digest: CARD.digest, planVersion: 1 };
  assert.equal(approvalGate.preflightResolution(CARD, base, 300_000).allowed, true);

  const expired = approvalGate.preflightResolution(CARD, base, 301_000);
  assert.equal(expired.allowed, false);
  assert.ok(expired.failures.includes("approval-expired"));

  const forged = approvalGate.preflightResolution(CARD, { ...base, digest: "f".repeat(64) }, 1000);
  assert.ok(forged.failures.includes("approval-digest-mismatch"));

  const wrongCard = approvalGate.preflightResolution(CARD, { ...base, approvalId: "appr-other" }, 1000);
  assert.ok(wrongCard.failures.includes("approval-unknown-for-run"));

  const changedPlan = approvalGate.preflightResolution(CARD, { ...base, planVersion: 2 }, 1000);
  assert.ok(changedPlan.failures.includes("approval-plan-changed"));

  const broadened = approvalGate.preflightResolution(
    CARD,
    { ...base, scope: { argv: ["node", "scripts/check.mjs", "--full", "--danger"] } },
    1000,
  );
  assert.ok(broadened.failures.includes("approval-scope-broadened"));

  const narrowed = approvalGate.preflightResolution(
    CARD,
    { ...base, scope: { argv: ["node", "scripts/check.mjs"] } },
    1000,
  );
  assert.equal(narrowed.allowed, true, "honest narrowing is fine");
});

test("S30-WP03 invalid decisions are rejected preflight", () => {
  const result = approvalGate.preflightResolution(
    CARD,
    { approvalId: CARD.approvalId, decision: "approve-always", digest: CARD.digest },
    1000,
  );
  assert.ok(result.failures.includes("invalid-decision"));
});
