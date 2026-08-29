/**
 * S33-WP04/WP05 — retrieval receipts and the memory ledger.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const retrieval = await src("retrievalContext.js");
const memory = await src("memoryLedger.js");

const NOW = 5000;

function frag(overrides = {}) {
  return retrieval.fragment(
    {
      id: "s1",
      text: "fixture",
      trust: "medium",
      sensitivity: "internal",
      scopes: [],
      revision: "r1",
      ...overrides.source,
    },
    { score: 0.9, channel: "lexical", rerankScore: 0.8, ...overrides.ranking },
  );
}

test("S33-WP04 retrieval filters secrets, revocations, TTL and scope", () => {
  const items = [
    frag(),
    frag({ source: { id: "s2", sensitivity: "secret" } }),
    frag({ source: { id: "s3", revokedAtMs: 100 } }),
    frag({ source: { id: "s4", expiresAtMs: 100 } }),
    frag({ source: { id: "s5", scopes: ["workspace:other"] } }),
  ];
  const { visible, filtered } = retrieval.retrievalFilter(items, "q", { workspaceId: "ws1", userId: "u1", nowMs: NOW });
  assert.deepEqual(
    visible.map((item) => item.sourceId),
    ["s1"],
  );
  assert.deepEqual(
    filtered.map((entry) => entry.reason),
    ["sensitivity-secret", "revoked", "expired-ttl", "scope"],
  );
});

test("S33-WP04 rerank blends scores with per-source budgets", () => {
  const many = [
    frag({ source: { id: "s1" }, ranking: { score: 0.9 } }),
    frag({ source: { id: "s1" }, ranking: { score: 0.8 } }),
    frag({ source: { id: "s1" }, ranking: { score: 0.7 } }),
    frag({ source: { id: "s1" }, ranking: { score: 0.6 } }),
    frag({ source: { id: "s2" }, ranking: { score: 0.5 } }),
  ];
  const ranked = retrieval.rerank(many, { perSourceBudget: 3 });
  assert.equal(ranked.length, 4);
  assert.equal(ranked.filter((item) => item.sourceId === "s1").length, 3);
  assert.ok(ranked[0].score >= ranked[ranked.length - 1].score);
});

test("S33-WP04 every returned fragment carries a Context Receipt", () => {
  const items = [frag(), frag({ source: { id: "s2", trust: "low" } })];
  const receipt = retrieval.contextReceipt(items, "fixture query");
  assert.equal(receipt.query, "fixture query");
  assert.equal(receipt.fragmentCount, 2);
  assert.deepEqual([...receipt.sources], ["s1", "s2"]);
  assert.deepEqual([...receipt.trustLevels].sort(), ["low", "medium"]);
  assert.equal(receipt.provenanceVerified, true);
});

test("S33-WP04 evaluation measures precision, staleness, duplicates, provenance", () => {
  const retrieved = [
    frag({ source: { id: "rel-1", revision: "r1" } }),
    frag({ source: { id: "rel-2", revision: "r1", stale: true } }),
    frag({ source: { id: "rel-1", revision: "r1" } }),
    frag({ source: { id: "noise", revision: null } }),
  ];
  const metrics = retrieval.evaluate(retrieved, {
    relevantSourceIds: ["rel-1", "rel-2"],
    expectedRevisions: { "rel-1": "r1", "rel-2": "r1" },
  });
  assert.equal(metrics.precision, 0.75);
  assert.equal(metrics.staleRate, 0.25);
  assert.equal(metrics.duplicateRate, 0.25);
  assert.equal(metrics.falseProvenanceRate, 0.25);
});

test("S33-WP05 the ledger actions all carry expected revisions", () => {
  const ledger = memory.memoryLedger();
  const record = ledger.propose({ id: "m1", type: "episodic", text: "learned", source: "run-1", atMs: 1 });
  assert.equal(record.revision, 1);
  assert.throws(() => ledger.act("m1", "edit", 99, { text: "x" }), /revision_conflict/);
  const edited = ledger.act("m1", "edit", 1, { text: "learned more", atMs: 2 });
  assert.equal(edited.revision, 2);
  assert.equal(edited.text, "learned more");
  assert.throws(() => ledger.act("m1", "teleport", 2), /invalid_action/);
  ledger.act("m1", "redact", 2, { atMs: 3 });
  assert.equal(ledger.get("m1").text, "[redacted memory]");
});

test("S33-WP05 recall respects status, TTL, revocation and scope", () => {
  const ledger = memory.memoryLedger();
  ledger.propose({ id: "m1", type: "curated", text: "a", scope: [], atMs: 1 });
  ledger.propose({ id: "m2", type: "curated", text: "b", scope: ["workspace:other"], atMs: 1 });
  ledger.propose({ id: "m3", type: "curated", text: "c", scope: [], atMs: 1 });
  ledger.propose({ id: "m4", type: "curated", text: "d", scope: [], atMs: 1 });
  ledger.act("m3", "revoke", 1, { atMs: 100 });
  ledger.act("m4", "expire", 1, { atMs: 1 });
  const recalled = ledger.recall({ workspaceId: "ws1", nowMs: NOW });
  assert.deepEqual(
    recalled.map((record) => record.id),
    ["m1"],
  );
  // Idempotent proposals never duplicate.
  const again = ledger.propose({ id: "m1", type: "curated", text: "different", source: "x", atMs: 9 });
  assert.equal(again.text, "a");
});

test("S33-WP05 workspace policy wins; recall output needs independent evidence", () => {
  const resolved = memory.conflictResolution([
    { id: "m1", scope: ["user:u1"], text: "user" },
    { id: "m1", scope: ["workspace:ws1"], text: "workspace" },
  ]);
  assert.equal(resolved.winners[0].text, "workspace");
  assert.equal(resolved.secretLastWriteWins, false);
  const gate = memory.recallPromotionGate({ independentEvidence: false });
  assert.equal(gate.promoted, false);
  assert.equal(gate.recallOutputAlone, false);
  assert.equal(memory.recallPromotionGate({ independentEvidence: true }).promoted, true);
  assert.throws(() => memory.memoryLedger().propose({ id: "x", type: "telepathic", text: "?" }), /invalid_type/);
});
