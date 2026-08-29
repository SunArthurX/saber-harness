/**
 * S38-WP01/WP02 — cohort/consent and the fixed task benchmark tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const cohort = await src("partnerCohort.js");
const benchmark = await src("taskBenchmark.js");

function projects(n = 6, overrides = {}) {
  return Array.from({ length: n }, (_, i) => ({
    language: ["ts", "rust", "python", "go", "java", "kotlin"][i % 6],
    sizeClass: i % 2 === 0 ? "mid" : "large",
    oses: i % 2 === 0 ? ["macos", "linux"] : ["windows"],
    privacyProfile: i % 2 === 0 ? "strict-local" : "enterprise-cloud",
    teamType: i % 2 === 0 ? "solo" : "team",
    ...overrides,
  }));
}

test("S38-WP01 written consent covers all eight clauses with no defaults", () => {
  assert.equal(cohort.CONSENT_CLAUSES.length, 8);
  const complete = cohort.consent([...cohort.CONSENT_CLAUSES]);
  assert.equal(complete.complete, true);
  assert.equal(complete.optInOnly, true);
  assert.equal(complete.defaultsAssumed, false);
  const partial = cohort.consent(["code-access", "telemetry"]);
  assert.equal(partial.complete, false);
  assert.ok(partial.missing.includes("exit"));
});

test("S38-WP01 cohort diversity is verified and cherry-picking rejected", () => {
  const representative = cohort.cohortSelection(projects());
  assert.equal(representative.verdict, "representative");
  assert.equal(representative.cherryPicked, false);
  assert.ok(representative.languages.length >= 3);
  const easy = cohort.cohortSelection(
    projects(6, { language: "ts", sizeClass: "small", oses: ["macos"], privacyProfile: "casual", teamType: "solo" }),
  );
  assert.equal(easy.verdict, "rejected-cherry-picked");
  assert.equal(easy.cherryPicked, true);
  assert.throws(() => cohort.cohortSelection(projects(3)), /cohort_too_small/);
});

test("S38-WP01 partner workspaces are isolated with named owners", () => {
  const ws = cohort.partnerWorkspace({ tenantId: "tenant-p1", workspaceKey: "ws-key-1", owner: "partner-owner" });
  assert.equal(ws.isolatedKeys, true);
  assert.equal(ws.sharedAcrossPartners, false);
  assert.throws(() => cohort.partnerWorkspace({ tenantId: "t" }), /partner_identity_incomplete/);
});

test("S38-WP01 research never asks users to reproduce private data", () => {
  const compliant = cohort.researchProtocol({ requestsPrivateData: false, requiresPrivateRepoReproduction: false });
  assert.equal(compliant.compliant, true);
  assert.equal(compliant.comparesAgainstCurrentWorkflow, true);
  const dirty = cohort.researchProtocol({ requestsPrivateData: true });
  assert.equal(dirty.compliant, false);
  assert.deepEqual([...dirty.violations], ["requests-private-data"]);
});

test("S38-WP02 benchmark tasks freeze acceptance and starting commit", () => {
  const frozen = benchmark.freezeTask({
    id: "DJ-1",
    category: "fix",
    acceptance: { kind: "file_contains" },
    startingCommit: "abc",
  });
  assert.equal(frozen.frozen, true);
  assert.throws(
    () => benchmark.freezeTask({ id: "x", category: "vibe", acceptance: {}, startingCommit: "a" }),
    /unknown_category:vibe/,
  );
  assert.throws(
    () => benchmark.freezeTask({ id: "x", category: "fix", startingCommit: "a" }),
    /acceptance_and_starting_commit_required/,
  );
});

test("S38-WP02 twelve categories must be covered", () => {
  assert.equal(benchmark.TASK_CATEGORIES.length, 12);
  const all = benchmark.TASK_CATEGORIES.map((category, i) =>
    benchmark.freezeTask({ id: `t${i}`, category, acceptance: { kind: "k" }, startingCommit: "c" }),
  );
  assert.equal(benchmark.categoryCoverage(all).complete, true);
  const partial = all.slice(0, 10);
  assert.equal(benchmark.categoryCoverage(partial).complete, false);
  assert.ok(benchmark.categoryCoverage(partial).missing.includes("denial"));
});

test("S38-WP02 production thresholds evaluate honestly", () => {
  assert.equal(benchmark.PRODUCTION_THRESHOLDS.completionRate, 0.8);
  const good = benchmark.evaluateBenchmark(
    Array.from({ length: 10 }, () => ({
      completed: true,
      acceptanceMet: true,
      regression: false,
      humanCorrections: 0,
      memoryPrecision: 0.95,
    })),
  );
  assert.equal(good.verdict, "thresholds-met");
  assert.equal(good.findings.length, 0);
  const bad = benchmark.evaluateBenchmark(
    Array.from({ length: 10 }, (_, i) => ({
      completed: i < 5,
      acceptanceMet: i < 6,
      regression: i < 2,
      humanCorrections: 3,
      memoryPrecision: 0.5,
    })),
  );
  assert.equal(bad.verdict, "thresholds-missed");
  assert.ok(bad.findings.includes("KPI-completion-rate"));
  assert.ok(bad.findings.includes("KPI-human-corrections"));
});

test("S38-WP02 models are replaceable routes, not product identities", () => {
  const runs = [
    { completed: true, acceptanceMet: true, costUsd: 1 },
    { completed: true, acceptanceMet: true, costUsd: 2 },
  ];
  const table = benchmark.routeComparison({ "route-a": runs, "route-b": runs });
  assert.equal(table.routesAreReplaceable, true);
  for (const route of table.routes) {
    assert.equal(route.swappable, true);
    assert.equal(route.productIdentityClaim, false);
  }
});
