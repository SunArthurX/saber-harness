#!/usr/bin/env node
/**
 * S38 design-partner acceptance driver — evaluates the frozen fixed
 * benchmark from committed immutable fixtures: category coverage,
 * production thresholds, route comparison and the DJ-14..DJ-32
 * journey catalog. Exits non-zero when thresholds are missed or
 * coverage is incomplete.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { categoryCoverage, evaluateBenchmark, freezeTask, recordRun, routeComparison } = require(
  join(root, "apps/desktop-codeoss/extensions/saber-agent/src/taskBenchmark.js"),
);

const benchmark = JSON.parse(readFileSync(join(root, "fixtures/design-partner/benchmark.json"), "utf8"));
const catalog = JSON.parse(readFileSync(join(root, "fixtures/design-partner/journeys.json"), "utf8"));

if (benchmark.frozen !== true) {
  throw new Error("benchmark_not_frozen");
}

const frozenTasks = benchmark.tasks.map((task) => freezeTask(task));
const coverage = categoryCoverage(frozenTasks);
const runs = frozenTasks.map((task, index) => recordRun(task, benchmark.tasks[index].outcome));
const evaluation = evaluateBenchmark(runs);

const routes = {};
for (const run of runs) {
  routes[run.route] = [...(routes[run.route] ?? []), run];
}
const routeTable = routeComparison(routes);

const journeyIds = catalog.journeys.map((entry) => entry.split(" ")[0]);
const expected = Array.from({ length: 19 }, (_, i) => `DJ-${14 + i}`);
const missingJourneys = expected.filter((id) => !journeyIds.includes(id));

console.log(
  JSON.stringify(
    {
      frozen: true,
      tasks: evaluation.tasks,
      coverageComplete: coverage.complete,
      missingCategories: coverage.missing,
      thresholds: {
        completionRate: evaluation.completionRate,
        acceptanceRate: evaluation.acceptanceRate,
        regressionRate: evaluation.regressionRate,
        humanCorrectionAvg: evaluation.humanCorrectionAvg,
        memoryPrecision: evaluation.memoryPrecision,
      },
      verdict: evaluation.verdict,
      findings: evaluation.findings,
      routes: routeTable.routes.map((route) => ({
        route: route.route,
        tasks: route.tasks,
        swappable: route.swappable,
      })),
      journeyCatalog: { total: journeyIds.length, missing: missingJourneys },
    },
    null,
    2,
  ),
);

if (!coverage.complete || missingJourneys.length > 0 || evaluation.verdict !== "thresholds-met") {
  console.error("design-partner acceptance: FAILED");
  process.exit(1);
}
console.log("design-partner acceptance: thresholds met across all twelve categories with the full DJ journey catalog");
