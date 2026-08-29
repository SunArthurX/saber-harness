/**
 * S38-WP02 — Fixed task benchmark.
 *
 * Twelve categories with frozen acceptance and starting commit before
 * execution; completion, human correction, regression, latency, cost,
 * approval interruption, Memory precision and rollback recorded;
 * models/providers compared as replaceable routes, not product
 * identities (MMX adoption traced to observed user outcomes).
 */

const TASK_CATEGORIES = Object.freeze([
  "understand",
  "fix",
  "refactor",
  "test",
  "dependency",
  "documentation",
  "multi-file",
  "long-running",
  "multi-agent",
  "resume",
  "recovery",
  "denial",
]);

/** Freeze acceptance and starting commit before execution (KIR-01). */
function freezeTask(task) {
  if (!TASK_CATEGORIES.includes(task.category)) {
    throw new Error(`unknown_category:${task.category}`);
  }
  if (!task.acceptance || !task.startingCommit) {
    throw new Error("acceptance_and_starting_commit_required");
  }
  return Object.freeze({
    id: task.id,
    category: task.category,
    acceptance: Object.freeze({ ...task.acceptance }),
    startingCommit: task.startingCommit,
    frozen: true,
  });
}

/** Record one task run with the full measurement surface. */
function recordRun(frozenTask, outcome) {
  return Object.freeze({
    taskId: frozenTask.id,
    category: frozenTask.category,
    completed: outcome.completed === true,
    acceptanceMet: outcome.acceptanceMet === true,
    humanCorrections: outcome.humanCorrections ?? 0,
    regression: outcome.regression === true,
    latencyMs: outcome.latencyMs ?? 0,
    costUsd: outcome.costUsd ?? 0,
    approvalInterruptions: outcome.approvalInterruptions ?? 0,
    memoryPrecision: outcome.memoryPrecision ?? 1,
    rolledBack: outcome.rolledBack === true,
    route: outcome.route ?? "route-default",
  });
}

/** Aggregates evaluate against published production thresholds. */
const PRODUCTION_THRESHOLDS = Object.freeze({
  completionRate: 0.8,
  acceptanceRate: 0.85,
  maxRegressionRate: 0.05,
  maxHumanCorrectionAvg: 1.5,
  minMemoryPrecision: 0.75,
});

function evaluateBenchmark(runs) {
  const total = runs.length;
  const completed = runs.filter((run) => run.completed).length;
  const accepted = runs.filter((run) => run.acceptanceMet).length;
  const regressions = runs.filter((run) => run.regression).length;
  const corrections = total === 0 ? 0 : runs.reduce((sum, run) => sum + run.humanCorrections, 0) / total;
  const memoryPrecision = total === 0 ? 0 : runs.reduce((sum, run) => sum + run.memoryPrecision, 0) / total;
  const completionRate = total === 0 ? 0 : completed / total;
  const acceptanceRate = total === 0 ? 0 : accepted / total;
  const regressionRate = total === 0 ? 0 : regressions / total;
  const t = PRODUCTION_THRESHOLDS;
  const findings = [];
  if (completionRate < t.completionRate) {
    findings.push("KPI-completion-rate");
  }
  if (acceptanceRate < t.acceptanceRate) {
    findings.push("KPI-acceptance-rate");
  }
  if (regressionRate > t.maxRegressionRate) {
    findings.push("KPI-regression-rate");
  }
  if (corrections > t.maxHumanCorrectionAvg) {
    findings.push("KPI-human-corrections");
  }
  if (memoryPrecision < t.minMemoryPrecision) {
    findings.push("KPI-memory-precision");
  }
  return Object.freeze({
    tasks: total,
    completionRate,
    acceptanceRate,
    regressionRate,
    humanCorrectionAvg: corrections,
    memoryPrecision,
    findings: Object.freeze(findings),
    verdict: findings.length === 0 ? "thresholds-met" : "thresholds-missed",
  });
}

/** Category coverage must span all twelve categories. */
function categoryCoverage(frozenTasks) {
  const covered = new Set(frozenTasks.map((task) => task.category));
  const missing = TASK_CATEGORIES.filter((category) => !covered.has(category));
  return Object.freeze({
    covered: Object.freeze(TASK_CATEGORIES.filter((category) => covered.has(category))),
    missing: Object.freeze(missing),
    complete: missing.length === 0,
  });
}

/** Models/providers are replaceable routes, never product identities. */
function routeComparison(runsByRoute) {
  const routes = Object.entries(runsByRoute).map(([route, runs]) => {
    const evaluation = evaluateBenchmark(runs);
    return Object.freeze({
      route,
      tasks: evaluation.tasks,
      completionRate: evaluation.completionRate,
      costUsd: runs.reduce((sum, run) => sum + run.costUsd, 0),
      swappable: true,
      productIdentityClaim: false,
    });
  });
  return Object.freeze({ routes: Object.freeze(routes), routesAreReplaceable: true });
}

module.exports = {
  PRODUCTION_THRESHOLDS,
  TASK_CATEGORIES,
  categoryCoverage,
  evaluateBenchmark,
  freezeTask,
  recordRun,
  routeComparison,
};
