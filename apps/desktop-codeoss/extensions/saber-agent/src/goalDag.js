/**
 * S32-WP01 — Goal DAG projection.
 *
 * Task nodes carry dependency, acceptance, agent, model, Realm,
 * Worktree, budget, status and evidence gate; cycles, missing
 * dependencies and impossible budgets fail BEFORE dispatch; the
 * critical path and waiting reasons are computed from durable state —
 * never a vague percentage without a calculable plan.
 */

/** Task node states in the DAG. */
const TASK_STATES = Object.freeze([
  "blocked",
  "ready",
  "running",
  "waiting-approval",
  "verifying",
  "done",
  "failed",
  "cancelled",
]);

/** Validate a DAG before dispatch; returns every failure. */
function validateDag(tasks) {
  const failures = [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const dep of task.dependsOn ?? []) {
      if (!byId.has(dep)) {
        failures.push(`missing-dependency:${task.id}:${dep}`);
      }
    }
    const budget = task.budget ?? {};
    if (Object.values(budget).some((value) => value < 0)) {
      failures.push(`impossible-budget:${task.id}`);
    }
    if (!task.acceptance || task.acceptance.length === 0) {
      failures.push(`missing-acceptance:${task.id}`);
    }
  }
  // Cycle detection via depth-first coloring.
  const color = new Map();
  const visit = (id, stack) => {
    color.set(id, 1);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (color.get(dep) === 1) {
        failures.push(`cycle:${[...stack, dep].join("->")}`);
      } else if (!color.has(dep)) {
        visit(dep, [...stack, dep]);
      }
    }
    color.set(id, 2);
  };
  for (const task of tasks) {
    if (!color.has(task.id)) {
      visit(task.id, [task.id]);
    }
  }
  return Object.freeze({ valid: failures.length === 0, failures: Object.freeze(failures) });
}

/** Compute readiness and waiting reasons from durable state. */
function schedulingView(tasks, states = {}) {
  return tasks.map((task) => {
    const state = states[task.id] ?? "blocked";
    const waitingOn = (task.dependsOn ?? []).filter((dep) => (states[dep] ?? "blocked") !== "done");
    return Object.freeze({
      id: task.id,
      state: waitingOn.length > 0 && state === "blocked" ? "blocked" : state,
      waitingReasons: Object.freeze(waitingOn.map((dep) => `dependency:${dep}`)),
      worktree: task.worktree ?? null,
      agent: task.agent ?? null,
      model: task.model ?? null,
      realm: task.realm ?? null,
      budget: Object.freeze(task.budget ?? {}),
      evidenceGate: Object.freeze(task.acceptance ?? []),
    });
  });
}

/** Critical path (longest dependency chain) — no percentages. */
function criticalPath(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map();
  const longest = (id) => {
    if (memo.has(id)) {
      return memo.get(id);
    }
    const task = byId.get(id);
    if (!task) {
      return [];
    }
    let best = [];
    for (const dep of task.dependsOn ?? []) {
      const chain = longest(dep);
      if (chain.length > best.length) {
        best = chain;
      }
    }
    const result = [...best, id];
    memo.set(id, result);
    return result;
  };
  let path = [];
  for (const task of tasks) {
    const chain = longest(task.id);
    if (chain.length > path.length) {
      path = chain;
    }
  }
  return Object.freeze(path);
}

module.exports = { TASK_STATES, criticalPath, schedulingView, validateDag };
