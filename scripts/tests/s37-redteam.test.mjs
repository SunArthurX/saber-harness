/**
 * S37-WP04 — security red team tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const redteam = await src("securityRedteam.js");

const EVIDENCE = Object.fromEntries(redteam.THREATS.map((threat) => [threat.id, `repro-${threat.id}`]));

test("S37-WP04 thirteen threats each carry id, exploit evidence and control", () => {
  assert.equal(redteam.THREATS.length, 13);
  const names = redteam.THREATS.map((threat) => threat.name);
  for (const expected of [
    "prompt-injection",
    "malicious-repository",
    "terminal-escape",
    "webview-xss",
    "renderer-extension-compromise",
    "ipc-spoof",
    "secret-theft",
    "egress-bypass",
    "mcp-plugin-supply-chain",
    "update-tamper",
    "cross-tenant-access",
    "resource-exhaustion",
    "audit-tamper",
  ]) {
    assert.ok(names.includes(expected), expected);
  }
  assert.throws(() => redteam.redteamFinding("T99", "x"), /unknown_threat:T99/);
  assert.throws(() => redteam.redteamFinding("T01", ""), /exploit_evidence_missing:T01/);
  const finding = redteam.redteamFinding("T07", "repro-T07");
  assert.equal(finding.contained, true);
  assert.ok(finding.control.length > 0);
});

test("S37-WP04 the full campaign contains every threat", () => {
  const campaign = redteam.redteamCampaign(EVIDENCE);
  assert.equal(campaign.threatCoverage, 1);
  assert.equal(campaign.uncontained.length, 0);
  assert.equal(campaign.verdict, "redteam-contained");
});

test("S37 PJ-negative rule: brain and reflex cannot touch immune containment", () => {
  for (const actor of ["brain", "reflex", "model", "hook"]) {
    for (const action of ["suppress-containment", "replace-containment", "exit-containment"]) {
      const attempt = redteam.pjNegativeRule(actor, action);
      assert.equal(attempt.allowed, false, `${actor}:${action}`);
    }
  }
  assert.equal(redteam.pjNegativeRule("supervisor", "exit-containment").allowed, true);
  assert.equal(redteam.pjNegativeRule("external-human-authority", "suppress-containment").allowed, true);
  assert.throws(() => redteam.pjNegativeRule("brain", "increase-containment"), /unknown_containment_action/);
  assert.throws(() => redteam.pjNegativeRule("intern", "exit-containment"), /unknown_actor/);
});

test("S37-WP04 remote dispatch attacks stay contained with global Stop reachable", () => {
  for (const scenario of [
    "forged-device-intent",
    "replayed-approval",
    "disconnected-ui",
    "phone-authority-enlargement",
  ]) {
    const attack = redteam.remoteDispatchAttack(scenario);
    assert.equal(attack.contained, true, scenario);
    assert.equal(attack.globalStopReachable, true, scenario);
  }
  assert.throws(() => redteam.remoteDispatchAttack("quantum-hack"), /unknown_remote_scenario/);
});

test("S37 solo-versus-team is measured as a Saber contract, not a parity claim", () => {
  const solo = redteam.teamValueMeasurement("solo", {
    quality: 0.8,
    latencyMs: 1000,
    tokenCost: 5000,
    verifierIndependence: true,
  });
  assert.equal(solo.fixedRepositories, true);
  assert.equal(solo.parityClaim, false);
  assert.equal(solo.verifierIndependence, true);
  const team = redteam.teamValueMeasurement("team", {
    quality: 0.92,
    latencyMs: 1400,
    tokenCost: 9000,
    retryAmplification: 1.4,
    verifierIndependence: true,
  });
  assert.equal(team.retryAmplification, 1.4);
  assert.throws(() => redteam.teamValueMeasurement("mob", {}), /unknown_mode:mob/);
});

test("S37 runtime images rebuild from locked provenance and reject drift", () => {
  const image = { id: "img-1", digest: "d1", provenanceLocked: true };
  assert.equal(redteam.runtimeImageCheck(image, "d1").accepted, true);
  assert.equal(redteam.runtimeImageCheck(image, "d2").reason, "drifted-rebuild");
  assert.equal(
    redteam.runtimeImageCheck({ id: "img-2", digest: "d", provenanceLocked: false }, "d").reason,
    "provenance-not-locked",
  );
});
