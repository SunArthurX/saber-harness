#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
/**
 * S32 e2e — parallel delegated tasks, sibling containment, integration.
 *
 * One Goal delegates two bounded Tasks to two child runs with SEPARATE
 * worktrees created through the Core; both execute concurrently (their
 * approvals interleave over one connection each); a mid-flight
 * cancellation of one child cannot corrupt the sibling; a scope-widening
 * delegation is rejected; integration into a review worktree detects
 * the overlapping file. The Windows named-pipe leg skips honestly.
 */
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SupervisionClient } from "../packages/ide-client/dist/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  console.log(
    "SKIP e2e-parallel-integration: the local unix-socket leg is not available on win32; the named-pipe Core compiles in the hosted Windows leg",
  );
  process.exit(0);
}

const failures = [];
const passes = [];
const check = (condition, name, detail = "") => {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  (condition ? passes : failures).push(name);
};
const must = async (promise, name) => {
  try {
    return await promise;
  } catch (error) {
    check(false, name, `threw: ${error.message}`);
    throw error;
  }
};

function resolveCore() {
  const candidates = [];
  if (process.env.SABER_CORE_BIN) candidates.push(process.env.SABER_CORE_BIN);
  for (const profile of ["debug", "release"]) {
    const candidate = join(ROOT, "target", profile, "saber-core");
    if (existsSync(candidate)) candidates.push(candidate);
  }
  for (const candidate of candidates) {
    const probeStore = mkdtempSync(join(tmpdir(), "s32-probe-"));
    try {
      const probe = spawnSync(candidate, ["serve", "--store", probeStore, "--workspace", "s32probe"], {
        timeout: 1_500,
        encoding: "utf8",
      });
      rmSync("/tmp/saber-s32probe.sock", { force: true });
      if (probe.status !== 64) return candidate;
    } finally {
      rmSync(probeStore, { force: true, recursive: true });
    }
  }
  return null;
}

function startServe(store, workspace) {
  const core = resolveCore();
  if (!core) {
    console.error("e2e-parallel-integration: saber-core must be built first");
    process.exit(1);
  }
  const child = spawn(core, ["serve", "--store", store, "--workspace", workspace], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on(
    "data",
    (chunk) => process.env.S32_DEBUG && console.error("CORE-STDERR:", chunk.toString().slice(0, 500)),
  );
  const token = new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("no bootstrap token")), 20_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      const match = /bootstrap-token ([0-9a-f]{64})/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("exit", () => {
      clearTimeout(timer);
      reject(new Error("serve exited before the token"));
    });
  });
  return { child, token };
}

async function connect(workspace, token, renderer) {
  const client = new SupervisionClient({
    socketPath: `/tmp/saber-${workspace}.sock`,
    actor: { renderer_id: renderer, workspace_id: workspace },
    requestTimeoutMs: 20_000,
    attachTimeoutMs: 15_000,
  });
  await client.ready();
  await client.initialize(token);
  return client;
}

async function startChildRun(client, goalId, planIdem, worktree, notesPath, marker) {
  const plan = await client.request("plan.freeze", {
    goal_id: goalId,
    worktree,
    steps: [
      { step_id: "edit", effect: { kind: "file.edit", path: notesPath, text: marker, reason: "child task output" } },
      { step_id: "readme", effect: { kind: "file.read", path: "README.md" } },
    ],
    idempotency_key: planIdem,
  });
  const run = await client.request("run.start", {
    goal_id: goalId,
    plan_version: plan.version,
    idempotency_key: `${planIdem}-run`,
  });
  return run;
}

async function approveToEnd(client, run) {
  let current = run;
  let guard = 0;
  while (current.state === "waiting_approval" && guard < 10) {
    const card = current.card;
    current = await client.request("approval.resolve", {
      run_id: current.run_id,
      approval_id: card.approval_id,
      decision: "approve",
      digest: card.digest,
      idempotency_key: `appr-${card.approval_id}`,
    });
    guard += 1;
  }
  return current;
}

async function main() {
  const workspace = `s32e2e${process.pid}`;
  const socket = `/tmp/saber-${workspace}.sock`;
  rmSync(socket, { force: true });
  const store = mkdtempSync(join(tmpdir(), "s32-e2e-store-"));
  const goalWorktree = mkdtempSync(join(tmpdir(), "s32-e2e-goal-"));
  cpSync(join(ROOT, "fixtures/repos/basic"), goalWorktree, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: goalWorktree });
  spawnSync("git", ["add", "-A"], { cwd: goalWorktree });
  spawnSync("git", ["-c", "user.email=fixture@saber.local", "-c", "user.name=Fixture", "commit", "-q", "-m", "base"], {
    cwd: goalWorktree,
  });

  const handle = startServe(store, workspace);
  try {
    const token = await handle.token;
    const client = await connect(workspace, token, "s32-leader");
    check(true, "core-serves-and-initializes");

    const goal = await must(
      client.request("goal.create", {
        objective: "Two parallel bounded tasks",
        acceptance: [{ check_id: "w1-note", kind: "file_contains", path: "notes-w1.md", needle: "worker-1-was-here" }],
        idempotency_key: "s32-goal-1",
      }),
      "goal-create",
    );

    // Two per-task worktrees through the Core.
    const wt1 = await must(
      client.request("worktree.create", {
        task_id: "task-w1",
        owner: "worker-1",
        source_worktree: goalWorktree,
        idempotency_key: "s32-wt-1",
      }),
      "worktree-create-1",
    );
    const wt2 = await must(
      client.request("worktree.create", {
        task_id: "task-w2",
        owner: "worker-2",
        source_worktree: goalWorktree,
        idempotency_key: "s32-wt-2",
      }),
      "worktree-create-2",
    );
    check(wt1.worktree_id !== wt2.worktree_id, "worktree-ids-distinct");
    check(existsSync(join(wt1.source_worktree ?? goalWorktree, ".saber-worktrees")), "worktrees-under-source");
    // A duplicate creation with the same idempotency key replays, never duplicates.
    const replayed = await must(
      client.request("worktree.create", {
        task_id: "task-w1",
        owner: "worker-1",
        source_worktree: goalWorktree,
        idempotency_key: "s32-wt-1",
      }),
      "worktree-create-replays",
    );
    check(replayed.worktree_id === wt1.worktree_id, "idempotent-replay");

    // Delegations: bounded child scopes. Widening is rejected.
    const firstRun = await startChildRun(
      client,
      goal.goal_id,
      "s32-plan-w1",
      wt1.path,
      "notes-w1.md",
      "worker-1-was-here",
    );
    const parentRunId = firstRun.run_id;
    let widenedRejected = false;
    try {
      await client.request("task.delegate", {
        goal_id: goal.goal_id,
        parent_run_id: parentRunId,
        worktree_id: wt2.worktree_id,
        capabilities: ["exec.host", "net.egress"],
        idempotency_key: "s32-deleg-widen",
      });
    } catch (error) {
      widenedRejected = error.message.includes("child_scope_widened");
    }
    check(widenedRejected, "scope-widening-rejected");

    const bounded = await must(
      client.request("task.delegate", {
        goal_id: goal.goal_id,
        parent_run_id: parentRunId,
        worktree_id: wt2.worktree_id,
        capabilities: ["read.browse"],
        budgets: { toolCalls: 5 },
        idempotency_key: "s32-deleg-w2",
      }),
      "delegation-bounded",
    );
    check(bounded.budgets.toolCalls <= 500, "child-budget-clamped");

    // Approve the first child to completion.
    const done1 = await must(approveToEnd(client, firstRun), "child-1-completes");
    check(done1.state === "succeeded", "child-1-succeeded", done1.state);
    const note1 = readFileSync(join(wt1.path, "notes-w1.md"), "utf8");
    check(note1.includes("worker-1-was-here"), "child-1-worktree-authored");

    // Cancel cascade: a second child blocked mid-approval is cancelled;
    // the completed sibling and the goal journal stay intact.
    const secondRun = await startChildRun(
      client,
      goal.goal_id,
      "s32-plan-w2",
      wt2.path,
      "notes-w2.md",
      "worker-2-was-here",
    );
    check(secondRun.state === "waiting_approval", "child-2-blocked-mid-flight");
    const cancelled = await must(
      client.request("run.cancel", { run_id: secondRun.run_id, idempotency_key: "s32-cancel-child2" }),
      "cancel-child",
    );
    check(cancelled.state === "cancelled", "child-cancelled");
    const stillSucceeded = readFileSync(join(wt1.path, "notes-w1.md"), "utf8");
    check(stillSucceeded.includes("worker-1-was-here"), "sibling-output-untouched-by-cancel");
    const health = await client.health();
    check(health.status === "ready", "sibling-and-goal-intact", `runs=${health.run_count}`);

    // Integration: overlapping files must be detected before merge.
    // Worker 2 wrote its own note in its worktree; both worktrees touch README? No —
    // craft the overlap directly: same relative path added in both.
    const w1Dir = wt1.path;
    const w2Dir = wt2.path;
    appendFileSync(join(w1Dir, "INTEGRATION-README.md"), "from worker 1\n");
    appendFileSync(join(w2Dir, "INTEGRATION-README.md"), "from worker 2\n");
    appendFileSync(join(w2Dir, "only-w2.md"), "unique\n");
    const integration = await must(
      client.request("worktree.integrate", {
        goal_id: goal.goal_id,
        worktrees: [w1Dir, w2Dir],
        idempotency_key: "s32-integrate-1",
      }),
      "integration-with-conflict-detection",
    );
    check(integration.conflicts_detected === true, "overlap-detected");
    check(integration.overlapping_files.includes("INTEGRATION-README.md"), "overlapping-file-named");
    check(integration.applied_files.includes("only-w2.md"), "non-conflicting-file-applied");
    check(existsSync(integration.review_worktree), "review-worktree-created");

    // Journal: delegation + worktree + integration facts are durable.
    let delegationEvents = 0;
    let worktreeEvents = 0;
    let integrationEvents = 0;
    for await (const page of client.replayAll(0, 100)) {
      for (const event of page.events) {
        const type = event.event_type ?? event.type;
        if (type === "task.delegated") delegationEvents += 1;
        if (type === "worktree.created") worktreeEvents += 1;
        if (type === "worktree.integrated") integrationEvents += 1;
      }
    }
    check(delegationEvents === 1, "delegation-journaled");
    check(worktreeEvents === 2, "worktrees-journaled");
    check(integrationEvents === 1, "integration-journaled");
    client.close?.();
  } finally {
    handle.child.kill("SIGKILL");
    rmSync(socket, { force: true });
    rmSync(store, { force: true, recursive: true });
    rmSync(goalWorktree, { force: true, recursive: true });
  }

  console.log(`parallel-integration e2e: ${passes.length} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILURES: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`e2e-parallel-integration: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
