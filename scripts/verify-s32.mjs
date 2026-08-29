#!/usr/bin/env node
/**
 * S32 focused verifier — multi-agent and worktree contracts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const extensionRoot = "apps/desktop-codeoss/extensions/saber-agent";
const requiredFiles = [
  "crates/saber-core/src/multi_agent.rs",
  "schemas/control/v1/protocol.schema.json",
  `${extensionRoot}/src/goalDag.js`,
  `${extensionRoot}/src/worktreeLifecycle.js`,
  `${extensionRoot}/src/delegationPolicy.js`,
  "scripts/tests/s32-goal-dag.test.mjs",
  "scripts/tests/s32-worktree-lifecycle.test.mjs",
  "scripts/tests/s32-multiagent-faults.test.mjs",
  "scripts/e2e-parallel-integration.mjs",
  "scripts/verify-s32.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s32-required-file", file);
}

const schema = text("schemas/control/v1/protocol.schema.json");
for (const method of ['"task.delegate"', '"worktree.create"', '"worktree.integrate"']) {
  check(schema.includes(method), "s32-protocol-schema", method);
}
check(
  text("crates/core-protocol/src/lib.rs").includes('"task.delegate"') &&
    text("crates/core-protocol/src/lib.rs").includes('"worktree.integrate"'),
  "s32-protocol-decode",
  "decoder accepts the multi-agent methods",
);
check(
  text("packages/ide-client/src/protocol.ts").includes('"task.delegate"'),
  "s32-client-registry",
  "ide-client mirrors the multi-agent surface",
);

const core = text("crates/saber-core/src/multi_agent.rs");
for (const contract of [
  "create_worktree",
  "delegate_task",
  "child_scope_widened",
  "worktree.created",
  "task.delegated",
  "worktree.integrated",
  "quarantine_worktree",
  "worktree.quarantined",
  "cleanup_blocked_unreviewed_changes",
  "worktree_path_collision",
  "worktree_missing_after_replay",
  "dirty_base",
  "integration_needs_two_worktrees",
  "overlapping_files",
]) {
  check(core.includes(contract), "s32-core-contract", contract);
}
check(
  core.includes("Replayed") && core.includes("Deterministic seed"),
  "s32-core-contract",
  "worktree creation replays idempotently",
);
check(
  core.includes("never a half") || core.includes("Never leave a half-created directory"),
  "s32-core-contract",
  "failed git worktrees leave nothing behind",
);
check(
  text("crates/saber-core/src/run_dispatch.rs").includes("TaskDelegate") &&
    text("crates/saber-core/src/run_dispatch.rs").includes("WorktreeIntegrate"),
  "s32-core-contract",
  "dispatch wires the multi-agent methods",
);

check(
  text(`${extensionRoot}/src/goalDag.js`).includes("missing-dependency") &&
    text(`${extensionRoot}/src/goalDag.js`).includes("cycle") &&
    text(`${extensionRoot}/src/goalDag.js`).includes("criticalPath"),
  "s32-projection-dag",
  "DAG validation, cycles and critical path",
);
for (const contract of ["dirty-base", "quarantine", "takeOver", "moveBoundary", "followFilter", "queuedMessage"]) {
  check(text(`${extensionRoot}/src/worktreeLifecycle.js`).includes(contract), "s32-projection-lifecycle", contract);
}
for (const contract of [
  "validateDelegation",
  "clampBudgets",
  "budgetExhaustion",
  "teamValueDecision",
  "detectConflicts",
  "containFault",
  "crossTaskMessage",
  "grantsCompletion",
]) {
  check(text(`${extensionRoot}/src/delegationPolicy.js`).includes(contract), "s32-projection-delegation", contract);
}

const e2e = text("scripts/e2e-parallel-integration.mjs");
for (const contract of [
  "worktree.create",
  "task.delegate",
  "worktree.integrate",
  "scope-widening-rejected",
  "child-cancelled",
  "sibling-output-untouched-by-cancel",
  "overlap-detected",
  "idempotent-replay",
  "SKIP e2e-parallel-integration",
]) {
  check(e2e.includes(contract), "s32-e2e-contract", contract);
}

const packageJson = text("package.json");
for (const script of [
  "desktop:test:goal-dag",
  "desktop:test:worktree-lifecycle",
  "desktop:test:multiagent-faults",
  "desktop:e2e:parallel-integration",
]) {
  check(packageJson.includes(`"${script}"`), "s32-wiring-scripts", script);
}
check(packageJson.includes("verify-s32.mjs"), "s32-wiring-verify", "verify-s32 chained into the repository gate");
check(
  text(".github/workflows/repository-verification.yml").includes("Verify S32 multi-agent worktrees"),
  "s32-wiring-hosted",
  "hosted verification runs verify-s32",
);
check(
  text(".github/workflows/monorepo-ci.yml").includes("desktop:e2e:parallel-integration"),
  "s32-wiring-hosted",
  "monorepo CI runs the parallel-integration e2e",
);

console.log(`S32 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S32 verification passed.");
