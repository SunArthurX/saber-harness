#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
/**
 * S30-WP06 — real-repository governed-run vertical (unix socket leg).
 *
 * Drives the REAL saber-core binary over the REAL supervision transport
 * through one owned fixture task that requires read, edit, command,
 * test and a denied network attempt: exact approval, event persistence,
 * interruption (pause/resume), steer, cancel, fork, evidence linkage and
 * a Core restart that preserves the run. No private repository is ever
 * used. The Windows named-pipe leg is hosted-CI compile evidence and
 * skips here honestly.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SupervisionClient } from "../packages/ide-client/dist/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  console.log(
    "SKIP e2e-governed-run: the local unix-socket leg is not available on win32; the named-pipe Core compiles in the hosted Windows leg",
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
    const probeStore = mkdtempSync(join(tmpdir(), "s30-probe-"));
    try {
      const probe = spawnSync(candidate, ["serve", "--store", probeStore, "--workspace", "s30probe"], {
        timeout: 1_500,
        encoding: "utf8",
      });
      rmSync("/tmp/saber-s30probe.sock", { force: true });
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
    console.error("e2e-governed-run: saber-core must be built first (cargo build -p saber-core)");
    process.exit(1);
  }
  const child = spawn(core, ["serve", "--store", store, "--workspace", workspace], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on(
    "data",
    (chunk) => process.env.S30_DEBUG && console.error("CORE-STDERR:", chunk.toString().slice(0, 500)),
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

async function connect(workspace, token) {
  const client = new SupervisionClient({
    socketPath: `/tmp/saber-${workspace}.sock`,
    actor: { renderer_id: "s30-e2e", workspace_id: workspace },
    requestTimeoutMs: 15_000,
    attachTimeoutMs: 15_000,
  });
  await client.ready();
  await client.initialize(token);
  return client;
}

async function collectEvents(client) {
  const all = [];
  for await (const page of client.replayAll(0, 100)) {
    for (const event of page.events) {
      all.push({
        sequence: event.sequence,
        type: event.event_type ?? event.type,
        payload: JSON.parse(event.payload_json ?? "{}"),
      });
    }
  }
  return all;
}

async function main() {
  const workspace = `s30e2e${process.pid}`;
  const socket = `/tmp/saber-${workspace}.sock`;
  rmSync(socket, { force: true });
  const store = mkdtempSync(join(tmpdir(), "s30-e2e-store-"));
  const worktree = mkdtempSync(join(tmpdir(), "s30-e2e-wt-"));
  cpSync(join(ROOT, "fixtures/repos/basic"), worktree, { recursive: true });

  const handle = startServe(store, workspace);
  try {
    const token = await handle.token;
    const client = await connect(workspace, token);
    check(true, "core-serves-and-initializes");

    const goal = await must(
      client.request("goal.create", {
        objective: "Fixture: read, edit, verify, and stay offline",
        acceptance: [
          { check_id: "notes-edited", kind: "file_contains", path: "notes.md", needle: "saber-was-here" },
          {
            check_id: "check-passes",
            kind: "command_succeeds",
            path: "scripts/check.mjs",
            argv: ["node", "scripts/check.mjs"],
          },
        ],
        constraints: ["no-network"],
        budget: { toolCalls: 10 },
        owner: "e2e",
        evidence_requirements: ["run.acceptance_checked"],
        idempotency_key: "e2e-goal-1",
      }),
      "goal-create",
    );
    const goalId = goal.goal_id;
    check(typeof goalId === "string" && goalId.length > 0, "goal-created", goalId);

    const plan = await must(
      client.request("plan.freeze", {
        goal_id: goalId,
        worktree,
        steps: [
          { step_id: "read", effect: { kind: "file.read", path: "README.md" } },
          {
            step_id: "edit",
            effect: { kind: "file.edit", path: "notes.md", text: "saber-was-here", reason: "record outcome" },
          },
          {
            step_id: "check",
            effect: { kind: "command.test", argv: ["node", "scripts/check.mjs"], reason: "verify the edit" },
          },
          { step_id: "net", effect: { kind: "net.request", url: "https://example.invalid" } },
        ],
        idempotency_key: "e2e-plan-1",
      }),
      "plan-freeze",
    );
    check(plan.version === 1, "plan-frozen-v1");

    let run = await must(
      client.request("run.start", {
        goal_id: goalId,
        plan_version: 1,
        model_route: "fixture-deterministic",
        realm: "local",
        worktree,
        idempotency_key: "e2e-run-1",
      }),
      "run-start",
    );
    check(run.state === "waiting_approval", "run-blocks-on-edit-approval", run.state);
    const editCard = run.card;
    check(
      editCard.action === "file.edit" && editCard.network === "none" && editCard.scope === "one-shot",
      "edit-card-complete",
    );
    check(Array.isArray(editCard.alternatives) && editCard.alternatives.includes("deny"), "card-offers-deny");

    // Adversarial: a forged digest must fail closed.
    let forgedRejected = false;
    try {
      await client.request("approval.resolve", {
        run_id: run.run_id,
        approval_id: editCard.approval_id,
        decision: "approve",
        digest: "0".repeat(64),
        idempotency_key: "e2e-forged-1",
      });
    } catch (error) {
      forgedRejected = error.message.includes("digest");
    }
    check(forgedRejected, "forged-digest-fails-closed");

    // Steer while blocked applies now.
    const steer = await must(
      client.request("run.steer", {
        run_id: run.run_id,
        text: "keep the notes concise",
        idempotency_key: "e2e-steer-1",
      }),
      "run-steer",
    );
    check(steer.boundary === "now", "steer-applies-now-when-blocked");

    // Pause at the safe boundary, then resume (revalidated).
    const paused = await must(
      client.request("run.pause", { run_id: run.run_id, idempotency_key: "e2e-pause-1" }),
      "run-pause",
    );
    check(paused.paused_at === "edit", "pause-boundary-is-next-step", paused.paused_at);
    run = await must(
      client.request("run.resume", { run_id: run.run_id, idempotency_key: "e2e-resume-1" }),
      "run-resume",
    );
    check(run.state === "waiting_approval", "resume-returns-to-approval");

    // Resume re-blocks with a fresh card; approve exactly what is displayed now.
    const liveEditCard = run.card;
    check(liveEditCard.action === "file.edit", "resume-reissues-fresh-card");
    run = await must(
      client.request("approval.resolve", {
        run_id: run.run_id,
        approval_id: liveEditCard.approval_id,
        decision: "approve",
        digest: liveEditCard.digest,
        idempotency_key: "e2e-approve-edit-1",
      }),
      "edit-approval-exact",
    );
    check(run.state === "waiting_approval" && run.card.action === "command.test", "command-approval-next");
    const commandCard = run.card;
    check(
      JSON.stringify(commandCard.argv) === JSON.stringify(["node", "scripts/check.mjs"]),
      "command-card-shows-exact-argv",
    );

    run = await must(
      client.request("approval.resolve", {
        run_id: run.run_id,
        approval_id: commandCard.approval_id,
        decision: "approve",
        digest: commandCard.digest,
        idempotency_key: "e2e-approve-command-1",
      }),
      "command-approval-exact",
    );
    check(run.state === "succeeded", "run-succeeds-with-verdict", `${run.state}/${run.verdict}`);
    check(Array.isArray(run.evidence) && run.evidence.length === 2, "acceptance-evidence-bound");
    const notes = readFileSync(join(worktree, "notes.md"), "utf8");
    check(notes.includes("saber-was-here"), "real-file-edited-in-worktree");

    // Replay the durable journal and audit causality.
    const events = await collectEvents(client);
    const types = events.map((event) => event.type ?? "");
    const approvalIndex = types.indexOf("run.approval_resolved");
    const editCompletedIndex = events.findIndex(
      (event) => event.type === "run.effect_completed" && event.payload?.step_id === "edit",
    );
    check(approvalIndex !== -1 && editCompletedIndex > approvalIndex, "approval-precedes-effect");
    const denied = events.find((event) => event.type === "run.effect_denied_by_policy");
    check(denied?.payload?.reason === "network_egress_denied", "network-denied-before-attempt");
    check(!types.includes("net-attempt"), "no-network-attempt-ever-recorded");
    const steerEvent = events.find((event) => event.type === "run.steered");
    check(steerEvent?.payload?.boundary === "now", "steer-is-causal-control-event");
    const terminal = events.find((event) => event.type === "run.state_changed" && event.payload?.to === "succeeded");
    check(
      Array.isArray(terminal?.payload?.acceptance_evidence) && terminal.payload.acceptance_evidence.length === 2,
      "terminal-state-carries-evidence",
    );

    // Replay is idempotent (renderer restart keeps the same truth).
    const eventsAgain = await collectEvents(client);
    check(eventsAgain.length === events.length, "replay-dedup-on-restart");

    // Fork → new lineage run; cancel it terminally.
    const fork = await must(
      client.request("run.fork", { run_id: run.run_id, idempotency_key: "e2e-fork-1" }),
      "run-fork",
    );
    check(fork.state === "waiting_approval", "fork-reexecutes-plan");
    const forkRunId = fork.run_id;
    const cancelled = await must(
      client.request("run.cancel", { run_id: forkRunId, idempotency_key: "e2e-cancel-1" }),
      "run-cancel",
    );
    check(cancelled.state === "cancelled", "cancel-is-terminal");
    let terminalLocked = false;
    try {
      await client.request("run.cancel", { run_id: forkRunId, idempotency_key: "e2e-cancel-2" });
    } catch (error) {
      terminalLocked = error.message.includes("terminal");
    }
    check(terminalLocked, "terminal-runs-cannot-be-retouched");
    client.close?.();

    // Core restart: a fresh process rebuilds from the same encrypted store.
    handle.child.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 300));
    rmSync(socket, { force: true });
    const second = startServe(store, workspace);
    try {
      const token2 = await second.token;
      const client2 = await connect(workspace, token2);
      const events2 = await collectEvents(client2);
      check(events2.length >= events.length, "core-restart-preserves-journal", `${events2.length} events`);
      const states2 = events2.filter((event) => event.type === "run.state_changed").map((event) => event.payload.to);
      check(states2.includes("succeeded") && states2.includes("cancelled"), "run-states-survive-restart");
      client2.close?.();
    } finally {
      second.child.kill("SIGKILL");
    }
  } finally {
    handle.child.kill("SIGKILL");
    rmSync(socket, { force: true });
    rmSync(store, { force: true, recursive: true });
    rmSync(worktree, { force: true, recursive: true });
  }

  console.log(`governed-run e2e: ${passes.length} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILURES: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`e2e-governed-run: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
