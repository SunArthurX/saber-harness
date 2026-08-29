#!/usr/bin/env node
/**
 * S30 focused verifier — governed agent run contracts.
 *
 * Deterministic and offline: it checks that the Core-side governed run
 * engine (goal/plan authoring, exact one-shot approvals, policy-denied
 * network, independent verifier, terminal non-regression, fork lineage)
 * and the renderer-side projections (plan versions, timeline, approval
 * gate, runtime controls) exist with their fail-closed contracts, that
 * the protocol surface stayed versioned and closed, and that the S30
 * suites and the real-Core e2e are chained into the repository gate.
 * The real-binary evidence itself runs in the e2e suite
 * (desktop:e2e:governed-run).
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
  "crates/saber-core/src/run_engine.rs",
  "crates/saber-core/src/run_dispatch.rs",
  "crates/event-store/src/lib.rs",
  "crates/core-protocol/src/lib.rs",
  "schemas/control/v1/protocol.schema.json",
  "packages/agent-runtime/src/control.ts",
  "packages/ide-client/src/protocol.ts",
  "packages/ide-client/src/supervision.ts",
  `${extensionRoot}/src/goalPlan.js`,
  `${extensionRoot}/src/runTimeline.js`,
  `${extensionRoot}/src/approvalGate.js`,
  `${extensionRoot}/src/runControls.js`,
  "scripts/tests/s30-goal-plan.test.mjs",
  "scripts/tests/s30-approval-adversarial.test.mjs",
  "scripts/tests/s30-run-controls.test.mjs",
  "scripts/e2e-governed-run.mjs",
  "fixtures/repos/basic/scripts/check.mjs",
  "scripts/verify-s30.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s30-required-file", file);
}

// Protocol parity: schema → generated Rust → generated TS → client registry.
const schema = text("schemas/control/v1/protocol.schema.json");
for (const method of [
  '"goal.create"',
  '"plan.freeze"',
  '"run.start"',
  '"run.pause"',
  '"run.resume"',
  '"approval.resolve"',
]) {
  check(schema.includes(method), "s30-protocol-schema", method);
}
const generatedRust = text("crates/core-protocol/src/generated.rs");
for (const variant of ["GoalCreate", "PlanFreeze", "RunStart", "RunPause", "RunResume", "ApprovalResolve"]) {
  check(generatedRust.includes(variant), "s30-generated-rust", variant);
}
check(
  text("crates/core-protocol/src/lib.rs").includes('"goal.create"') &&
    text("crates/core-protocol/src/lib.rs").includes('"approval.resolve"'),
  "s30-protocol-decode",
  "decoder accepts the governed-run methods",
);
const ideProtocol = text("packages/ide-client/src/protocol.ts");
for (const method of ["goal.create", "plan.freeze", "run.start", "run.pause", "run.resume"]) {
  check(ideProtocol.includes(`"${method}"`), "s30-client-registry", method);
}
check(ideProtocol.includes("idempotency_required"), "s30-client-registry", "mutations require context idempotency");
check(
  text("packages/agent-runtime/src/control.ts").includes('"goal.create"') &&
    text("packages/agent-runtime/src/control.ts").includes('"approval.resolve"'),
  "s30-runtime-registry",
  "agent-runtime mirrors the mutation surface",
);

// Core engine contracts.
const engine = text("crates/saber-core/src/run_engine.rs");
for (const contract of [
  "create_goal",
  "freeze_plan",
  "start_run",
  "pause_run",
  "resume_run",
  "cancel_run",
  "steer_run",
  "fork_run",
  "resolve_approval",
  "approval_expired",
  "approval_already_resolved",
  "approval_digest_mismatch",
  "approval_plan_changed",
  "approval_scope_broadened",
  "approval_resource_changed",
  "network_egress_denied",
  "run.acceptance_checked",
  "run.verdict",
  "independent-verifier",
  "run.forked",
  "rebuild",
]) {
  check(engine.includes(contract), "s30-engine-contract", contract);
}
check(
  engine.includes("fn rebuild") && engine.includes("disposable projection"),
  "s30-engine-contract",
  "engine index is a replayed disposable projection",
);
check(
  engine.includes("canonicalize") && engine.includes("path_outside_worktree"),
  "s30-engine-contract",
  "effects cannot escape the worktree",
);
check(
  engine.includes('program != "node" && program != "node.exe"'),
  "s30-engine-contract",
  "command effects run node-only exact argv",
);

// Dispatch shared by both transports; store keeps its guarantees.
check(
  text("crates/saber-core/src/run_dispatch.rs").includes("dispatch_run_method"),
  "s30-dispatch",
  "shared run-method dispatch",
);
for (const transport of ["crates/saber-core/src/serve.rs", "crates/saber-core/src/serve_windows.rs"]) {
  const source = text(transport);
  check(source.includes("dispatch_run_method"), "s30-dispatch", `${transport} dispatches run methods`);
  check(source.includes("goal.create"), "s30-dispatch", `${transport} advertises the run capability`);
}
const store = text("crates/event-store/src/lib.rs");
check(store.includes("append_core_event"), "s30-store-contract", "single generic engine append");
check(
  store.includes("pub fn append_core_event") && store.includes("idempotency"),
  "s30-store-contract",
  "engine appends keep idempotent replay",
);

// Projection contracts.
check(
  text(`${extensionRoot}/src/goalPlan.js`).includes("proposePlanEdit"),
  "s30-goal-plan",
  "immutable plan versions with diffs",
);
check(
  text(`${extensionRoot}/src/runTimeline.js`).includes("progressPercent") &&
    text(`${extensionRoot}/src/runTimeline.js`).includes("staleEvents"),
  "s30-timeline",
  "no invented progress; stale events cannot regress terminals",
);
for (const contract of [
  "approval-expired",
  "approval-digest-mismatch",
  "approval-plan-changed",
  "approval-scope-broadened",
  "narrowsScope",
]) {
  check(text(`${extensionRoot}/src/approvalGate.js`).includes(contract), "s30-approval-gate", contract);
}
for (const contract of [
  "pauseBoundary",
  "steerPlacement",
  "cancelPropagation",
  "resumeContract",
  "forkLineage",
  "projectSurfaces",
  "quitOptions",
]) {
  check(text(`${extensionRoot}/src/runControls.js`).includes(contract), "s30-run-controls", contract);
}
const manifest = JSON.parse(text(`${extensionRoot}/package.json`));
check(
  manifest.contributes.commands.some((command) => command.command === "saber.run.openTimeline"),
  "s30-wiring-extension",
  "run timeline command",
);
const english = JSON.parse(text(`${extensionRoot}/package.nls.json`));
const chinese = JSON.parse(text(`${extensionRoot}/package.nls.zh-cn.json`));
check(
  JSON.stringify(Object.keys(english).sort()) === JSON.stringify(Object.keys(chinese).sort()),
  "s30-wiring-nls",
  "zh/en parity",
);

// E2E: the fixture task must exercise read, edit, command, test and a
// denied network attempt, with approval/causality/restart assertions.
const e2e = text("scripts/e2e-governed-run.mjs");
for (const contract of [
  "goal.create",
  "plan.freeze",
  "run.start",
  "run.pause",
  "run.resume",
  "run.steer",
  "approval.resolve",
  "run.fork",
  "run.cancel",
  "forged-digest-fails-closed",
  "approval-precedes-effect",
  "network-denied-before-attempt",
  "core-restart-preserves-journal",
  "fixtures/repos/basic",
]) {
  check(e2e.includes(contract), "s30-e2e-contract", contract);
}
check(e2e.includes("SKIP e2e-governed-run"), "s30-e2e-contract", "windows leg skips honestly");

// Wiring: scripts, gate chain and hosted CI.
const packageJson = text("package.json");
for (const script of [
  "desktop:test:goal-plan",
  "desktop:test:approval-adversarial",
  "desktop:e2e:governed-run",
  "desktop:test:run-controls",
]) {
  check(packageJson.includes(`"${script}"`), "s30-wiring-scripts", script);
}
check(packageJson.includes("verify-s30.mjs"), "s30-wiring-verify", "verify-s30 chained into the repository gate");
const workflow = text(".github/workflows/repository-verification.yml");
check(workflow.includes("Verify S30 governed agent run"), "s30-wiring-hosted", "hosted verification runs verify-s30");

console.log(`S30 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S30 verification passed.");
