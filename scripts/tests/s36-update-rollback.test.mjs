/**
 * S36-WP01/WP02/WP03 — package definitions, provenance and update
 * channel tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const pkg = await src("packageDefinition.js");
const channels = await src("updateChannels.js");

test("S36-WP01 three platform definitions carry the full install surface", () => {
  assert.deepEqual(Object.keys(pkg.PLATFORMS).sort(), ["linux", "macos", "windows"]);
  assert.equal(pkg.APP_ID, "com.saber.studio");
  for (const def of Object.values(pkg.PLATFORMS)) {
    assert.equal(def.urlScheme, "saber");
    assert.ok(def.installLocation.length > 0);
    assert.ok(def.dataLocation.length > 0);
    assert.ok(def.cacheLocation.length > 0);
    assert.ok(def.logLocation.length > 0);
    assert.ok(def.uninstallRetention.includes("asks"));
  }
  assert.deepEqual([...pkg.PLATFORMS.macos.formats], ["dmg", "zip"]);
  assert.match(pkg.PLATFORMS.macos.signing, /hardened-runtime\+notarization/);
  assert.match(pkg.PLATFORMS.windows.signing, /authenticode/);
  assert.match(pkg.PLATFORMS.windows.installLocation, /per-user default/);
  assert.deepEqual([...pkg.PLATFORMS.linux.formats], ["deb", "archive"]);
  assert.ok(pkg.PLATFORMS.linux.optionalNote.includes("never advertised silently"));
});

test("S36-WP01 platform parity gaps are explicit product states", () => {
  const supported = pkg.parityState("macos", "arm64");
  assert.equal(supported.state, "supported");
  assert.equal(supported.advertised, true);
  const unsupported = pkg.parityState("macos", "riscv");
  assert.equal(unsupported.state, "explicit-unsupported");
  assert.equal(unsupported.advertised, false);
  assert.match(unsupported.reason, /no unsupported architecture is advertised/);
  assert.throws(() => pkg.parityState("plan9", "x64"), /unknown_platform/);
});

test("S36-WP02 signing keys live only in CI secrets, KMS or HSM", () => {
  for (const location of ["ci-secret", "kms", "hsm"]) {
    assert.equal(pkg.signingKeyLocation(location).repositoryKeys, false);
  }
  assert.throws(() => pkg.signingKeyLocation("repo-file"), /signing_key_location_prohibited:repo-file/);
  assert.throws(() => pkg.signingKeyLocation("developer-script"), /signing_key_location_prohibited/);
  assert.notEqual(pkg.CHANNELS.development.identity, pkg.CHANNELS.production.identity);
  assert.notEqual(pkg.CHANNELS.development.endpoint, pkg.CHANNELS.production.endpoint);
});

test("S36-WP02 provenance requires the full record and verifies offline", () => {
  const base = {
    name: "macos/1.0.0",
    version: "1.0.0",
    sha256: "a".repeat(64),
    sbomDigest: "b".repeat(64),
    sourceCommit: "c0ffee",
    lockCommit: "c0ffee",
    patchManifest: "patches/series",
    signer: "saber-release-signing",
    channelIdentity: "saber-release-signing",
  };
  const record = pkg.provenance(base);
  assert.equal(record.signer, "saber-release-signing");
  assert.match(record.statement, /verified on a clean offline machine/);
  assert.equal(pkg.verifyProvenance({ ...record, version: "1.0.0" }).valid, true);
  assert.equal(pkg.verifyProvenance({ ...record, version: "1.0.0", signature: "forged" }).valid, false);
  assert.throws(() => pkg.provenance({ ...base, sha256: "short" }), /artifact_digest_missing/);
  assert.throws(() => pkg.provenance({ ...base, sbomDigest: undefined }), /provenance_incomplete/);
});

test("S36-WP03 update targets are monotonic and channel-ringed", () => {
  assert.deepEqual(channels.CHANNEL_RING, { internal: 0, canary: 1, beta: 2, stable: 3 });
  const target = channels.updateTarget("1.1.0", 10, "beta", "macos", 5000, "2.0");
  assert.equal(target.ring, 2);
  assert.equal(target.monotonic, true);
  assert.throws(() => channels.updateTarget("1.1.0", 10, "nightly", "macos", 5000, "2.0"), /unknown_channel:nightly/);
  assert.throws(() => channels.updateTarget("1.1.0", NaN, "beta", "macos", 5000, "2.0"), /sequence_required/);
});

test("S36-WP03 the client rejects freeze, rollback, wrong channel/platform and expired metadata", () => {
  const current = { sequence: 10 };
  const target = (overrides = {}) => ({
    version: "1.1.0",
    sequence: 11,
    channel: "beta",
    platform: "macos",
    expiresAtMs: 5000,
    ...overrides,
  });
  const context = { channel: "beta", platform: "macos", nowMs: 1000 };
  assert.equal(channels.verifyTargetChain(current, target(), context).accepted, true);
  assert.match(channels.verifyTargetChain(current, target({ sequence: 10 }), context).reason, /rollback_or_freeze/);
  assert.match(channels.verifyTargetChain(current, target({ sequence: 9 }), context).reason, /rollback_or_freeze/);
  assert.match(channels.verifyTargetChain(current, target({ channel: "stable" }), context).reason, /wrong_channel/);
  assert.match(channels.verifyTargetChain(current, target({ platform: "windows" }), context).reason, /wrong_platform/);
  assert.match(channels.verifyTargetChain(current, target({ expiresAtMs: 900 }), context).reason, /expired_metadata/);
});

test("S36-WP03 rollback/demotion never silently downgrades data compatibility", () => {
  const compatible = channels.rollbackRing("2.1", { version: "1.0.0", dataSchema: "2.0" });
  assert.equal(compatible.dataCompatible, true);
  assert.equal(compatible.path, "in-place");
  const incompatible = channels.rollbackRing("3.1", { version: "1.0.0", dataSchema: "2.0" });
  assert.equal(incompatible.dataCompatible, false);
  assert.equal(incompatible.path, "approved-export-path-required");
  assert.equal(incompatible.silentDataDowngrade, false);
});

test("S36-WP03 update UI shows version, urgency, size, restart and rollback risk", () => {
  const presentation = channels.updatePresentation({
    version: "1.1.0",
    securityUrgency: "high",
    sizeMb: 120,
    restartRequired: true,
    rollbackRisk: "last-known-good-retained",
  });
  assert.equal(presentation.securityUrgency, "high");
  assert.equal(presentation.sizeMb, 120);
  assert.equal(presentation.restartRequired, true);
});

test("S36-WP03 updates never orphan or silently terminate active runs (CUR-04)", () => {
  const none = channels.reconcileActiveRuns([], { dataSchema: "2.0" });
  assert.equal(none.policy, "proceed");
  const active = channels.reconcileActiveRuns(
    [
      { id: "run-1", dataSchema: "2.0" },
      { id: "run-2", dataSchema: "3.0" },
    ],
    { dataSchema: "2.0" },
  );
  assert.equal(active.policy, "defer-swap-until-checkpoint-or-takeover");
  assert.equal(active.orphaned, false);
  assert.equal(active.silentlyTerminated, false);
  assert.equal(active.perRun[0].compatibility, "compatible");
  assert.equal(active.perRun[1].compatibility, "migration-required");
});

test("S36 updater trust is E7-governed against the active agent", () => {
  for (const actor of ["agent", "renderer", "extension", "remote-content"]) {
    const attempt = channels.updaterTrustMutation(actor);
    assert.equal(attempt.allowed, false, actor);
    assert.match(attempt.reason, /E7-governed/);
  }
  assert.equal(channels.updaterTrustMutation("release-engineering-with-review").allowed, true);
  assert.throws(() => channels.updaterTrustMutation("nobody"), /unknown_actor/);
});
