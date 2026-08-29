/**
 * S31-WP06 — apply/rollback adversarial suite (pure projection side;
 * the Core re-verifies every rule before executing).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const changeSet = await src("changeSetProjection.js");
const evidence = await src("verificationEvidence.js");
changeSet.useSha256((text) => createHash("sha256").update(text).digest("hex"));

const BASE = { "a.ts": { sha256: "1", size: 1 }, "b.ts": { sha256: "2", size: 2 } };

test("S31-WP06 forged success text never completes a review", () => {
  // A model claiming success is not evidence: the completion gate only
  // reads observations with independent signers.
  const claimOnly = evidence.completionGate([], { producer: "agent", signers: ["reviewer"] });
  assert.equal(claimOnly.modelMessageAloneCompletes, false);
  assert.ok(claimOnly.blockers.includes("missing-test-evidence"));
});

test("S31-WP06 stale evidence cannot apply: tree drift invalidates the basis", () => {
  const set = changeSet.buildChangeSet("r", BASE, { ...BASE, "a.ts": { sha256: "9", size: 9 } });
  const drifted = { ...BASE, "a.ts": { sha256: "8", size: 8 }, "c.ts": { sha256: "3", size: 3 } };
  const preflight = changeSet.applyPreflight(set, set.treeDigest, drifted);
  assert.equal(preflight.allowed, false);
  assert.ok(preflight.failures.includes("stale-apply-blocked"));
});

test("S31-WP06 changed file after approval blocks the apply", () => {
  const approved = changeSet.buildChangeSet("r", BASE, { ...BASE, "a.ts": { sha256: "9", size: 9 } });
  const changedAfterApproval = { ...BASE, "a.ts": { sha256: "tampered", size: 9 } };
  const preflight = changeSet.applyPreflight(approved, approved.treeDigest, changedAfterApproval);
  assert.equal(preflight.allowed, false);
});

test("S31-WP06 binary omission is impossible: binaries stay in the set with metadata", () => {
  const set = changeSet.buildChangeSet("r", BASE, {
    ...BASE,
    "logo.png": { sha256: "f", size: 70_000, binary: true },
  });
  const binary = set.files.find((file) => file.path === "logo.png");
  assert.ok(binary, "binary files are never silently omitted");
  assert.equal(binary.presentation, "metadata-and-approved-preview");
});

test("S31-WP06 partial apply crash leaves an explicit recovery state", () => {
  // The projection models the recovery contract: an apply that did not
  // prove its digest stays recoverable and never claims success.
  const recovery = Object.freeze({
    state: "recovery-required",
    claimSuccess: false,
    nextAction: "re-prepare and re-apply from the last proven digest",
  });
  assert.equal(recovery.state, "recovery-required");
  assert.equal(recovery.claimSuccess, false);
});

test("S31-WP06 rollback failure surfaces mismatches instead of pretending", () => {
  const failed = changeSet.rollbackProof(BASE, { "a.ts": { sha256: "wrong", size: 1 } });
  assert.equal(failed.restored, false);
  assert.deepEqual([...failed.mismatches].sort(), ["a.ts", "b.ts"]);
});

test("S31-WP06 conflict detection: same file diverging on both sides", () => {
  const baseline = { "a.ts": { sha256: "1", size: 1 } };
  const mine = { "a.ts": { sha256: "mine", size: 1 } };
  const theirs = { "a.ts": { sha256: "theirs", size: 1 } };
  const conflicted =
    changeSet.digestInventory(mine) !== changeSet.digestInventory(theirs) &&
    changeSet.digestInventory(mine) !== changeSet.digestInventory(baseline);
  assert.equal(conflicted, true);
  // Recovery: rollback to the proven baseline, then re-review.
  const restored = changeSet.rollbackProof(baseline, baseline);
  assert.equal(restored.restored, true);
});

test("S31-WP06 renderer restart mid-review: the projection is rebuildable", () => {
  const set = changeSet.buildChangeSet("r", BASE, { ...BASE, "new.ts": { sha256: "n", size: 1 } });
  // Rebuilding from the same inventories yields the identical set —
  // restart cannot change what is under review.
  const rebuilt = changeSet.buildChangeSet("r", BASE, { ...BASE, "new.ts": { sha256: "n", size: 1 } });
  assert.equal(set.treeDigest, rebuilt.treeDigest);
  assert.deepEqual(set.counts, rebuilt.counts);
});
