/**
 * S36-WP05/S36-WP06 — install/update recovery matrix and offline /
 * enterprise distribution tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const recovery = await src("updateRecovery.js");

test("S36-WP05 every kill phase recovers without silent corruption or unsigned execution", () => {
  assert.deepEqual([...recovery.KILL_PHASES], ["download", "verify", "unpack", "swap", "migration", "first-launch"]);
  for (const phase of recovery.KILL_PHASES) {
    const outcome = recovery.killRecovery(phase);
    assert.equal(outcome.corruption, false, phase);
    assert.equal(outcome.unsignedExecution, false, phase);
    assert.ok(outcome.outcome.length > 0, phase);
  }
  assert.throws(() => recovery.killRecovery("mid-vibe-check"), /unknown_kill_phase/);
});

test("S36-WP05 environmental faults are contained explicitly", () => {
  assert.equal(recovery.FAULT_CONDITIONS.length, 6);
  for (const condition of recovery.FAULT_CONDITIONS) {
    const outcome = recovery.faultContainment(condition);
    assert.equal(outcome.contained, true, condition);
    assert.ok(outcome.mechanism.length > 0, condition);
  }
  assert.throws(() => recovery.faultContainment("solar-flare"), /unknown_fault_condition/);
});

test("S36-WP05 the full matrix passes", () => {
  const matrix = recovery.recoveryMatrix();
  assert.equal(matrix.kills.length, 6);
  assert.equal(matrix.faults.length, 6);
  assert.equal(matrix.silentCorruption, false);
  assert.equal(matrix.unsignedExecution, false);
  assert.equal(matrix.verdict, "matrix-passed");
});

test("S36-WP06 offline bundles must be complete", () => {
  assert.deepEqual(
    [...recovery.OFFLINE_BUNDLE_CONTENTS],
    ["package", "signature", "trust-metadata", "sbom", "notices", "verification-tool", "verification-instructions"],
  );
  const complete = recovery.offlineBundle([
    "package",
    "signature",
    "trust-metadata",
    "sbom",
    "notices",
    "verification-tool",
    "verification-instructions",
  ]);
  assert.equal(complete.complete, true);
  const missing = recovery.offlineBundle(["package", "signature"]);
  assert.equal(missing.complete, false);
  assert.ok(missing.missing.includes("sbom"));
});

test("S36-WP06 enterprise silent install accepts documented non-secret options only", () => {
  assert.equal(recovery.silentInstallOption("update-channel", "stable").accepted, true);
  assert.equal(recovery.silentInstallOption("install-mode", "per-user").policyControlled, true);
  assert.equal(recovery.silentInstallOption("undocumented-flag", "x").accepted, false);
  const secret = recovery.silentInstallOption("api-secret", "hunter2");
  assert.equal(secret.accepted, false);
  assert.equal(secret.reason, "not-a-documented-option");
});

test("S36-WP06 proxy, mirror and air-gap are signed-policy controlled", () => {
  const accepted = recovery.networkDistributionPolicy({ proxy: "corp-proxy", airGap: true }, true);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.signedPolicy, true);
  const refused = recovery.networkDistributionPolicy({ mirror: "https://mirror.example" }, false);
  assert.equal(refused.accepted, false);
  assert.equal(refused.reason, "unsigned_distribution_policy");
});

test("S36-WP06 uninstall asks about encrypted data and protects it by default", () => {
  const flow = recovery.uninstallFlow(undefined);
  assert.equal(flow.choice, "default");
  assert.equal(flow.dataRetained, true);
  assert.equal(flow.asks, true);
  const erase = recovery.uninstallFlow("erase");
  assert.equal(erase.dataRetained, false);
  assert.match(erase.secureEraseNote, /documented with OS limitations/);
  assert.throws(() => recovery.uninstallFlow("shred"), /unknown_uninstall_choice/);
});
