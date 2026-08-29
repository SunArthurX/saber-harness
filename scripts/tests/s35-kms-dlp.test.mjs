/**
 * S35-WP03 — KMS, Secret Broker and DLP tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const kms = await src("kmsDlp.js");

const adapter = {
  wrap: (keyId, bytes) => `wrapped(${keyId}):${bytes.length}`,
};

test("S35-WP03 envelope wrapping keeps plaintext only in approved process memory", () => {
  const envelope = kms.envelopeWrap("datakey-bytes", adapter, "kms-key-1");
  assert.equal(envelope.plaintextKeyInEnvelope, false);
  assert.deepEqual([...envelope.plaintextLocations], ["approved-process-memory"]);
  assert.match(envelope.wrappedDataKey, /wrapped\(kms-key-1\)/);
});

test("S35-WP03 key rotation is resumable, rollback-safe and old wraps survive until completion", () => {
  const items = [
    { id: "a", plaintextDataKey: "k1" },
    { id: "b", plaintextDataKey: "k2" },
  ];
  const rotation = kms.rotateKey(items, "kms-key-1", "kms-key-2", adapter);
  assert.equal(rotation.rotated, 2);
  assert.equal(rotation.resumable, true);
  assert.equal(rotation.rollbackSafe, true);
  assert.equal(rotation.checkpointAfter, "each-item");
  assert.equal(rotation.oldWrappingsValidUntil, "all-items-rewrapped");
  const empty = kms.rotateKey([], "kms-key-1", "kms-key-2", adapter);
  assert.equal(empty.completed, true);
});

test("S35-WP03 revoked device keys become undecryptable and that is testable", () => {
  const envelopes = [
    { id: "a", keyId: "kms-key-1" },
    { id: "b", keyId: "kms-key-2" },
  ];
  const after = kms.revokeDeviceKey(envelopes, "kms-key-1");
  assert.equal(after[0].decryptable, false);
  assert.equal(after[1].decryptable, true);
});

test("S35-WP03 policy carries named secret references only; values fail closed", () => {
  const ref = kms.secretReference({ reference: "secret://prod/api-key" });
  assert.equal(ref.valueExposed, false);
  assert.equal(ref.redactedInView, "********");
  assert.throws(
    () => kms.secretReference({ reference: "secret://prod/api-key", value: "AKIAXXXX" }),
    /secret_value_in_policy_prohibited/,
  );
  assert.throws(() => kms.secretReference({ reference: "https://evil/steal" }), /invalid_secret_reference/);
});

test("S35-WP03 plaintext never reaches logs, models, policy or crash dumps", () => {
  assert.deepEqual([...kms.APPROVED_PLAINTEXT_SINKS], ["approved-process-memory"]);
  const clean = kms.plaintextAudit({ name: "sign-request", sinks: ["approved-process-memory"] });
  assert.equal(clean.clean, true);
  const dirty = kms.plaintextAudit({ name: "debug-log", sinks: ["logs", "model-context"] });
  assert.equal(dirty.clean, false);
  assert.deepEqual([...dirty.sinkVViolations], ["logs", "model-context"]);
});

test("S35-WP03 DLP rules expose classification, destination, transformation and block evidence", () => {
  const rule = {
    id: "dlp-1",
    classification: "secret",
    destination: "external",
    action: "block",
    transformation: "redact",
  };
  const blocked = kms.dlpEvaluate(rule, { classification: "secret", sample: "s3cret" });
  assert.equal(blocked.matched, true);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.destination, "external");
  assert.equal(blocked.transformation, "redact");
  assert.match(blocked.blockEvidence.rule, /dlp-1/);
  assert.match(blocked.blockEvidence.contentDigest, /digest:6/);
  const passed = kms.dlpEvaluate(rule, { classification: "public", sample: "hello" });
  assert.equal(passed.blocked, false);
  assert.equal(passed.blockEvidence, null);
});
