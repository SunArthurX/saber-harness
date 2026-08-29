/**
 * S33-WP06 — privacy, sync and deletion propagation tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const privacy = await src("privacyDeletion.js");

test("S33-WP06 local encryption and OS credential storage are mandatory", () => {
  assert.equal(privacy.STORAGE_POLICY.atRest, "encrypted");
  assert.equal(privacy.STORAGE_POLICY.credentials, "os-credential-store");
  assert.equal(privacy.STORAGE_POLICY.plaintextLocalCache, false);
});

test("S33-WP06 E2EE sync sends ciphertext with minimal allowed metadata", () => {
  const envelope = privacy.syncEnvelope("base64-ciphertext", {
    record_id: "r1",
    workspace_id: "ws1",
    version: 2,
    updated_at_ms: 1000,
  });
  assert.equal(envelope.plaintextLeak, false);
  assert.throws(
    () => privacy.syncEnvelope("ct", { record_id: "r1", preview_text: "secret" }),
    /metadata_not_allowed:preview_text/,
  );
});

test("S33-WP06 strict mode honestly reports unavailable plaintext search", () => {
  const capabilities = privacy.strictModeCapabilities();
  assert.equal(capabilities.serverSidePlaintextSearch, false);
  assert.match(capabilities.notice, /unavailable in strict E2EE mode/);
  assert.equal(capabilities.syncWorks, true);
});

test("S33-WP06 every deletion kind propagates through the verified graph", () => {
  assert.equal(privacy.DELETION_KINDS.length, 6);
  const account = privacy.deletionPropagation("account-deletion");
  assert.equal(account.canonical, 0);
  assert.equal(account.verifiedByGraph, true);
  const derived = privacy.deletionPropagation("derived-data-deletion", { canonical: 3, derived: 5, indexes: 7 });
  assert.equal(derived.canonicalSurvives, 3);
  assert.match(derived.phl08, /canonical sources survive index loss/);
  const hold = privacy.deletionPropagation("legal-hold", { canonical: 2 });
  assert.equal(hold.deletionDeferred, true);
  assert.equal(hold.retainedCanonical, 2);
  const device = privacy.deletionPropagation("device-removal", { syncedCopies: 2 });
  assert.equal(device.localCopies, 0);
  assert.equal(device.remoteCopies, 2);
  const rotation = privacy.deletionPropagation("key-rotation");
  assert.equal(rotation.reEncrypted, true);
  assert.equal(rotation.dataLoss, false);
  assert.match(privacy.deletionPropagation("export").warned, /decrypts data/);
  assert.throws(() => privacy.deletionPropagation("shred"), /unknown_deletion_kind/);
});

test("S33-WP06 client-key sync surfaces conflicts instead of hiding them", () => {
  const conflict = privacy.clientKeyContinuity(3, 4);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.conflictHidden, false);
  assert.equal(conflict.authorityMoved, false);
  assert.match(conflict.resolution, /user-must-choose/);
  assert.equal(privacy.clientKeyContinuity(3, 3).resolution, "fast-forward");
});
