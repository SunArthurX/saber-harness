/**
 * S33-WP03 — resumption capsule and drift tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const lineage = await src("lineageBrowser.js");

const CAPSULE_INPUT = {
  goalId: "g1",
  taskId: "t1",
  repositoryOrigin: "https://example.invalid/basic.git",
  commit: "abc123",
  branch: "main",
  dirtyHash: "dd-1",
  toolchain: "node-24",
  policySnapshot: "snap-1",
  model: "fixture-deterministic",
  capturedAtMs: 1000,
};

test("S33-WP03 the capsule captures the full continuation identity", () => {
  const capsule = lineage.captureCapsule(CAPSULE_INPUT);
  assert.equal(capsule.commit, "abc123");
  assert.deepEqual([...capsule.dependencies], []);
  assert.throws(() => lineage.captureCapsule({ ...CAPSULE_INPUT, commit: undefined }), /capsule_missing:.*commit/);
});

test("S33-WP03 revalidation distinguishes unchanged, diverged, missing, unknown", () => {
  const capsule = lineage.captureCapsule(CAPSULE_INPUT);
  const unchanged = lineage.revalidateCapsule(capsule, {
    commit: "abc123",
    branch: "main",
    dirtyHash: "dd-1",
    toolchain: "node-24",
    policySnapshot: "snap-1",
  });
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.requiresUserChoice, false);
  const diverged = lineage.revalidateCapsule(capsule, {
    commit: "def456",
    branch: "main",
    dirtyHash: "dd-1",
    toolchain: "node-24",
    policySnapshot: "snap-1",
  });
  assert.equal(diverged.status, "diverged");
  assert.equal(diverged.drift.commit, true);
  assert.equal(diverged.drift.branch, false);
  assert.equal(diverged.requiresUserChoice, true);
  const dirty = lineage.revalidateCapsule(capsule, {
    commit: "abc123",
    branch: "main",
    dirtyHash: "changed",
    toolchain: "node-24",
    policySnapshot: "snap-1",
  });
  assert.equal(dirty.status, "diverged");
  assert.deepEqual({ ...dirty.drift }, { dirtyHash: true });
  const missing = lineage.revalidateCapsule(capsule, { missing: true });
  assert.equal(missing.status, "missing");
  assert.equal(lineage.revalidateCapsule(capsule, {}).status, "unknown");
});

test("S33-WP03 continuation creates linked events; the source is never rewritten", () => {
  const capsule = lineage.captureCapsule(CAPSULE_INPUT);
  const continuation = lineage.continueFrom(capsule, { id: "e1", text: "continue", atMs: 2000 });
  assert.equal(continuation.kind, "continuation.created");
  assert.equal(continuation.linkedSource.goalId, "g1");
  assert.equal(continuation.rewritesSource, false);
  assert.equal(continuation.newEvent.createdAtMs, 2000);
});
