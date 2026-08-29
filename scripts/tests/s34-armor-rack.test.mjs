/**
 * S34-WP01 — Armor Rack tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const armor = await src("armorRack.js");

function sampleManifest(overrides = {}) {
  return armor.signManifest({
    kind: "mcp",
    signer: "saber-official",
    version: "1.2.0",
    sourceDigest: "sha256-abc",
    publisher: "Saber Labs",
    capabilities: ["fs.read", "net.request"],
    secrets: [],
    egress: ["api.example.com"],
    ...overrides,
  });
}

test("S34-WP01 one manifest describes every armor kind and each fails closed when malformed", () => {
  assert.equal(armor.ARMOR_KINDS.length, 6);
  assert.throws(() => armor.verifyManifest(undefined), /manifest_missing/);
  assert.throws(
    () => armor.verifyManifest({ kind: "rootkit", signer: "saber-official", signature: "x" }),
    /unknown_armor_kind:rootkit/,
  );
  assert.throws(
    () => armor.verifyManifest({ kind: "mcp", signer: "attacker", signature: "x" }),
    /untrusted_signer:attacker/,
  );
  const { signature: _omitSig, ...unsigned } = sampleManifest();
  assert.throws(() => armor.verifyManifest(unsigned), /unsigned_manifest/);
  const { sourceDigest: _omitDigest, ...noDigest } = sampleManifest();
  assert.throws(() => armor.verifyManifest(noDigest), /missing_source_digest/);
  const tampered = {
    ...sampleManifest(),
    capabilities: ["fs.read", "net.request", "shell.exec"],
  };
  assert.throws(() => armor.verifyManifest(tampered), /signature_mismatch/);
});

test("S34-WP01 the rack card shows the full review surface", () => {
  const card = armor.armorCard({
    id: "armor-1",
    manifest: sampleManifest(),
    runtimeLocation: "utility-process",
    dataScope: "workspace",
    health: "healthy",
    cost: { model: "flat" },
    dependents: ["workflow-a"],
  });
  assert.equal(card.kind, "mcp");
  assert.equal(card.signer, "saber-official");
  assert.equal(card.sourceDigest, "sha256-abc");
  assert.equal(card.version, "1.2.0");
  assert.equal(card.runtimeLocation, "utility-process");
  assert.deepEqual([...card.capabilities], ["fs.read", "net.request"]);
  assert.deepEqual([...card.egress], ["api.example.com"]);
  assert.equal(card.health, "healthy");
  assert.deepEqual([...card.uninstallImpact.dependentWorkflows], ["workflow-a"]);
  assert.equal(card.uninstallImpact.auditHistoryPreserved, true);
});

test("S34-WP01 install/update grants no capability beyond the reviewed manifest", () => {
  const manifest = sampleManifest();
  const exact = armor.installGrant(manifest, ["fs.read", "net.request"]);
  assert.deepEqual([...exact.granted], ["fs.read", "net.request"]);
  assert.equal(exact.grantsBeyondManifest, false);
  const widened = armor.installGrant(manifest, ["fs.read", "shell.exec"]);
  assert.deepEqual([...widened.granted], ["fs.read"]);
  assert.deepEqual([...widened.denied], ["shell.exec"]);
  assert.equal(widened.grantsBeyondManifest, true);
});

test("S34-WP01 load/unload is reversible and immune roots stay privileged", () => {
  const loaded = armor.reversibleLoad({ id: "armor-1", immuneRoot: true, lastKnownGoodProfile: "profile-7" }, "load");
  assert.equal(loaded.reversible, true);
  assert.equal(loaded.recoveryProfile, "profile-7");
  assert.equal(loaded.immuneRootStaysPrivileged, true);
  const unloaded = armor.reversibleLoad({ id: "armor-1" }, "unload");
  assert.equal(unloaded.recoveryProfile, "retained");
  assert.throws(() => armor.reversibleLoad({ id: "armor-1" }, "hot-swap"), /unknown_load_action:hot-swap/);
});

test("S34-WP01 revocation immediately removes authorization and marks dependents", () => {
  const manifest = sampleManifest();
  const rack = [{ id: "armor-1", manifest, dependents: ["workflow-a", "workflow-b"] }];
  const revoked = armor.revokeArmor(rack, "armor-1");
  assert.equal(revoked.authorizationRemoved, true);
  assert.deepEqual(
    revoked.dependentWorkflowsMarked.map((entry) => entry.marked),
    ["armor-revoked", "armor-revoked"],
  );
  assert.deepEqual([...revoked.capabilitiesPurged], ["fs.read", "net.request"]);
  assert.equal(revoked.auditHistoryPreserved, true);
  assert.throws(() => armor.revokeArmor(rack, "armor-missing"), /unknown_armor:armor-missing/);
});
