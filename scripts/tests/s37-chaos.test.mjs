/**
 * S37-WP05/WP06 — reliability/chaos and the deterministic readiness
 * gate tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const chaos = await src("chaosReliability.js");
const readiness = await src("readinessGate.js");

test("S37-WP05 all eleven chaos scenarios prove bounded, contained, evidence-preserving recovery", () => {
  assert.equal(chaos.CHAOS_SCENARIOS.length, 11);
  for (const scenario of chaos.CHAOS_SCENARIOS) {
    const result = chaos.runChaos(scenario);
    assert.equal(result.boundedRetries, true, scenario);
    assert.equal(result.evidenceRetained, true, scenario);
    assert.equal(result.silentDataLoss, false, scenario);
    assert.equal(result.unboundedRetry, false, scenario);
  }
  assert.throws(() => chaos.runChaos("asteroid"), /unknown_chaos_scenario/);
});

test("S37-WP05 the full chaos campaign passes with Safe Mode where expected", () => {
  const campaign = chaos.chaosCampaign();
  assert.equal(campaign.allBounded, true);
  assert.equal(campaign.allEvidenceRetained, true);
  assert.equal(campaign.safeModeWhereExpected, true);
  assert.equal(campaign.verdict, "chaos-passed");
});

test("S37-WP05 retries are bounded with backoff and a hard ceiling", () => {
  const bounded = chaos.retryPolicy(3, 5);
  assert.equal(bounded.state, "bounded-backoff");
  assert.equal(bounded.backoffMs, 800);
  assert.equal(bounded.furtherRetries, 2);
  const escalated = chaos.retryPolicy(6, 5);
  assert.equal(escalated.state, "escalate");
  assert.equal(escalated.furtherRetries, 0);
});

test("S37-WP05 chaos evidence is retained; wiping fails closed", () => {
  const retained = chaos.evidenceRetention([{ id: 1 }]);
  assert.equal(retained.retained, true);
  assert.equal(retained.appendOnly, true);
  assert.throws(() => chaos.evidenceRetention([], "wipe"), /chaos_evidence_is_retained/);
});

test("S37-WP06 the gate requires exactly eleven families", () => {
  assert.equal(readiness.REQUIRED_FAMILIES.length, 11);
  for (const family of [
    "DesktopTruth",
    "CoreBoundary",
    "FunctionalJourney",
    "CrossPlatform",
    "Accessibility",
    "Performance",
    "Privacy",
    "Recovery",
    "SupplyChain",
    "ThreatCoverage",
    "ReportHygiene",
  ]) {
    assert.ok(readiness.REQUIRED_FAMILIES.includes(family), family);
  }
  assert.throws(() => readiness.finding("f1", "MadeUpFamily", "P2", "x"), /unknown_family/);
  assert.throws(() => readiness.finding("f1", "Privacy", "P9", "x"), /unknown_severity/);
});

test("S37-WP06 ready requires all families run and zero P0/P1 findings", () => {
  const all = {};
  for (const family of readiness.REQUIRED_FAMILIES) {
    all[family] = { status: "pass", findings: [] };
  }
  const ready = readiness.evaluateGate(all);
  assert.equal(ready.verdict, "ready");
  assert.equal(ready.metadataOnly, true);
  assert.deepEqual([...ready.prohibitedContent], ["source", "prompt", "secret", "private-transcript"]);
  assert.notEqual(ready.digest, "");

  const blocked = readiness.evaluateGate({
    ...all,
    ThreatCoverage: { status: "pass", findings: [{ id: "T-X", severity: "P0", detail: "uncontained threat" }] },
  });
  assert.equal(blocked.verdict, "blocked");
  assert.equal(blocked.blockerFindings.length, 1);

  const incomplete = readiness.evaluateGate({ ...all, SupplyChain: undefined });
  assert.equal(incomplete.verdict, "incomplete");
  assert.deepEqual([...incomplete.missingFamilies], ["SupplyChain"]);
});

test("S37-WP06 evaluation is deterministic", () => {
  const all = {};
  for (const family of readiness.REQUIRED_FAMILIES) {
    all[family] = { status: "pass", findings: [] };
  }
  assert.equal(readiness.evaluateGate(all).digest, readiness.evaluateGate(all).digest);
  const withFinding = {
    ...all,
    Privacy: { status: "pass", findings: [{ id: "PR-1", severity: "P2", detail: "owner assigned" }] },
  };
  assert.notEqual(readiness.evaluateGate(withFinding).digest, readiness.evaluateGate(all).digest);
});

test("S37-WP06 report hygiene refuses prohibited content classes", () => {
  const clean = readiness.reportHygiene({ includes: {} });
  assert.equal(clean.clean, true);
  for (const kind of ["source", "prompt", "secret", "private-transcript"]) {
    const dirty = readiness.reportHygiene({ includes: { [kind]: true } });
    assert.equal(dirty.clean, false, kind);
    assert.deepEqual([...dirty.violations], [kind]);
  }
});
