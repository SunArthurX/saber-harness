/**
 * S31-WP01/WP05 — change set projection and boundary diff tests.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const changeSet = await src("changeSetProjection.js");
const boundary = await src("boundaryDiff.js");
changeSet.useSha256((text) => createHash("sha256").update(text).digest("hex"));

const BASELINE = {
  "README.md": { sha256: "a", size: 10 },
  "src/hello.ts": { sha256: "b", size: 40 },
};
const CURRENT = {
  "README.md": { sha256: "a", size: 10 },
  "src/hello.ts": { sha256: "c", size: 60 },
  "notes.md": { sha256: "d", size: 20 },
  "dist/app.min.js": { sha256: "e", size: 900_000, binary: true },
};

test("S31-WP01 the change set classifies added, modified, deleted and flags", () => {
  const set = changeSet.buildChangeSet("run-1", BASELINE, CURRENT);
  assert.deepEqual(
    set.files.map((file) => `${file.path}:${file.change}`),
    ["dist/app.min.js:added", "notes.md:added", "src/hello.ts:modified"],
  );
  assert.equal(set.counts.added, 2);
  assert.equal(set.counts.modified, 1);
  assert.equal(set.counts.binary, 1);
  assert.equal(set.counts.generated, 1);
  const binary = set.files.find((file) => file.binary);
  assert.equal(binary.presentation, "metadata-and-approved-preview");
  assert.equal(set.files.find((file) => file.path === "notes.md").presentation, "diff");
});

test("S31-WP01 deletion is a first-class change", () => {
  const set = changeSet.buildChangeSet("run-1", { "gone.md": { sha256: "x", size: 1 } }, {});
  assert.deepEqual(set.counts, { added: 0, modified: 0, deleted: 1, binary: 0, generated: 0 });
});

test("S31-WP04/WP06 stale applies are blocked by digest mismatch", () => {
  const set = changeSet.buildChangeSet("run-1", BASELINE, CURRENT);
  const fresh = changeSet.applyPreflight(set, set.treeDigest, CURRENT);
  assert.equal(fresh.allowed, true);
  const externallyEdited = { ...CURRENT, "README.md": { sha256: "tampered", size: 99 } };
  const blocked = changeSet.applyPreflight(set, set.treeDigest, externallyEdited);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.failures.includes("stale-apply-blocked"));
  const wrongExpectation = changeSet.applyPreflight(set, "0".repeat(64), CURRENT);
  assert.ok(wrongExpectation.failures.includes("changeset-digest-mismatch"));
});

test("S31-WP04 rollback proof requires every hash to match the baseline", () => {
  const clean = changeSet.rollbackProof(BASELINE, { ...BASELINE, extra: { sha256: "z", size: 1 } });
  assert.equal(clean.restored, false);
  assert.deepEqual([...clean.mismatches], ["extra:unexpected"]);
  const partial = changeSet.rollbackProof(BASELINE, { "README.md": { sha256: "wrong", size: 10 } });
  assert.equal(partial.restored, false);
  assert.deepEqual([...partial.mismatches].sort(), ["README.md", "src/hello.ts"]);
  const exact = changeSet.rollbackProof(BASELINE, BASELINE);
  assert.equal(exact.restored, true);
  assert.deepEqual(exact.mismatches, []);
});

test("S31-WP01 review decisions are intents, not mutations", () => {
  assert.deepEqual([...changeSet.REVIEW_DECISIONS].slice(0, 4), ["comment", "request-revision", "accept", "reject"]);
});

test("S31-WP05 boundary changes cannot hide inside ordinary review", () => {
  const diff = boundary.boundaryDiff(
    ["src/app.ts", "package.json"],
    ["src/app.ts", "package.json", "migrations/0001.sql", "policy/default.policy.json", ".env.local"],
  );
  assert.equal(diff.boundaryChanged, true);
  assert.ok(diff.categories.migrations.requiresExplicitReview);
  assert.ok(diff.categories["policy-files"].requiresExplicitReview);
  assert.ok(diff.categories.secrets.requiresExplicitReview);
  assert.ok(diff.acknowledgmentRequired.includes("migrations"));
  const plain = boundary.boundaryDiff(["src/a.ts"], ["src/a.ts", "src/b.ts"]);
  assert.equal(plain.plainCodeReviewOnly, true);
  assert.equal(boundary.BOUNDARY_CATEGORIES.length, 9);
});
