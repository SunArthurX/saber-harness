/**
 * S33-WP01/WP02 — import wizard and lineage tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const wizard = await src("importWizard.js");
const lineage = await src("lineageBrowser.js");

const codex = JSON.parse(readFileSync(join(root, "fixtures/exports/codex-sample.json"), "utf8"));
const claude = JSON.parse(readFileSync(join(root, "fixtures/exports/claude-sample.json"), "utf8"));

function source(document, format, overrides = {}) {
  return { format, sizeBytes: 1024, mediaType: "application/json", document, ...overrides };
}

test("S33-WP01 both source formats import idempotently and recompute", () => {
  for (const [format, document] of [
    ["codex-export", codex],
    ["claude-export", claude],
  ]) {
    const first = wizard.canonicalize(source(document, format));
    const second = wizard.canonicalize(source(document, format));
    assert.equal(first.length, 1, format);
    assert.deepEqual(first, second, `${format} recompute is deterministic`);
    assert.ok(first[0].messages.length >= 2);
    assert.equal(first[0].parserVersion, wizard.ADAPTERS[format].parserVersion);
  }
});

test("S33-WP01 unsupported fields remain visible, never dropped", () => {
  const records = wizard.canonicalize(source(codex, "codex-export"));
  assert.ok(records[0].unsupportedFields.includes("unsupported_field"));
});

test("S33-WP01 validation fails closed on size, media, schema, version, malware", () => {
  assert.ok(
    wizard
      .validateImport(source(codex, "codex-export", { sizeBytes: 10 * 1024 * 1024 * 1024 }))
      .failures.includes("size-over-limit"),
  );
  assert.ok(
    wizard
      .validateImport(source(codex, "codex-export", { mediaType: "application/zip" }))
      .failures.includes("media-mismatch"),
  );
  assert.ok(
    wizard.validateImport(source({ nope: 1 }, "codex-export")).failures.includes("schema-missing:conversations"),
  );
  assert.ok(
    wizard
      .validateImport(source({ ...codex, format_version: 99 }, "codex-export"))
      .failures.includes("parser-version-mismatch"),
  );
  const malicious = source(
    { ...codex, conversations: [{ ...codex.conversations[0], attachment: "data:application/x-executable,..." }] },
    "codex-export",
  );
  assert.ok(wizard.validateImport(malicious).failures.includes("malicious-attachment-content"));
  assert.deepEqual(wizard.validateImport(source(codex, "unknown-format")).failures, ["unsupported-format"]);
});

test("S33-WP01 consent precedes reading; cancellation leaves nothing authoritative", () => {
  const manifest = wizard.consentManifest({
    sourceKind: "official-export",
    format: "codex-export",
    files: ["export.json"],
  });
  assert.equal(manifest.processing, "local-only");
  assert.equal(manifest.cloudPlaintext, false);
  assert.deepEqual([...manifest.expectedDataClasses], ["conversation-text", "timestamps", "model-metadata"]);

  const session = wizard.importSession();
  session.consent();
  session.validated(wizard.canonicalize(source(codex, "codex-export")));
  session.pause();
  session.resume();
  session.cancel();
  assert.equal(session.state, "cancelled");
  assert.equal(session.records().length, 0, "no half-authoritative records survive cancellation");
  assert.throws(() => wizard.importSession().finish(), /invalid_transition/);
});

test("S33-WP02 lineage layers are separately visible with recompute status", () => {
  assert.deepEqual(
    [...lineage.LINEAGE_LAYERS],
    ["raw-encrypted-object", "canonical-events", "derived-summary", "lineage-edges"],
  );
  const record = lineage.lineageRecord({
    id: "raw-1",
    parser: "codex-export",
    parserVersion: 1,
    digest: "abc",
    recomputed: true,
    dependents: ["derived-1"],
    trusted: false,
  });
  assert.equal(record.trust, "untrusted");
  assert.equal(record.recomputeStatus, "verified");
});

test("S33-WP02 untrusted imports never auto-promote to Memory", () => {
  const gate = lineage.promotionGate({ trust: "untrusted", recomputeStatus: "verified" });
  assert.equal(gate.canPromote, false);
  assert.equal(gate.autoPromotion, false);
  assert.equal(gate.reason, "untrusted-source");
  const trusted = lineage.promotionGate({ trust: "trusted", recomputeStatus: "verified" });
  assert.equal(trusted.canPromote, true);
});

test("S33-WP02 deleting raw data propagates to dependents per policy", () => {
  const invalidate = lineage.deletionPropagation({ dependents: ["d1", "d2"] });
  assert.deepEqual(
    invalidate.effects.map((effect) => effect.effect),
    ["invalidated", "invalidated"],
  );
  const destructive = lineage.deletionPropagation({ dependents: ["d1"] }, { policy: "delete-dependent" });
  assert.deepEqual(
    destructive.effects.map((effect) => effect.effect),
    ["deleted"],
  );
  assert.equal(invalidate.recall.futureRecall, "blocked");
});
