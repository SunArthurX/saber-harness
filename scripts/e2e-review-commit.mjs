#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
/**
 * S31-WP04/WP06 — review, apply, rollback and commit over the real Core.
 *
 * Extends the S30 governed-run vertical with the change-set journey:
 * prepare (baseline-bound classification), stale-apply blocking (wrong
 * digest and external edits), exact apply, a REAL git commit with a
 * durably recorded message/authorship disclosure, rollback proven by
 * hashes, adversarial ordering checks and a Core restart preserving the
 * review journal. The Windows named-pipe leg skips honestly.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SupervisionClient } from "../packages/ide-client/dist/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  console.log(
    "SKIP e2e-review-commit: the local unix-socket leg is not available on win32; the named-pipe Core compiles in the hosted Windows leg",
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
    const probeStore = mkdtempSync(join(tmpdir(), "s31-probe-"));
    try {
      const probe = spawnSync(candidate, ["serve", "--store", probeStore, "--workspace", "s31probe"], {
        timeout: 1_500,
        encoding: "utf8",
      });
      rmSync("/tmp/saber-s31probe.sock", { force: true });
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
    console.error("e2e-review-commit: saber-core must be built first (cargo build -p saber-core)");
    process.exit(1);
  }
  const child = spawn(core, ["serve", "--store", store, "--workspace", workspace], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Saber Fixture",
      GIT_AUTHOR_EMAIL: "fixture@saber.local",
      GIT_COMMITTER_NAME: "Saber Fixture",
      GIT_COMMITTER_EMAIL: "fixture@saber.local",
    },
  });
  child.stderr.on(
    "data",
    (chunk) => process.env.S31_DEBUG && console.error("CORE-STDERR:", chunk.toString().slice(0, 500)),
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
    actor: { renderer_id: "s31-e2e", workspace_id: workspace },
    requestTimeoutMs: 20_000,
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

async function driveRunToSuccess(client, worktree) {
  const goal = await must(
    client.request("goal.create", {
      objective: "Fixture review journey",
      acceptance: [
        { check_id: "notes-edited", kind: "file_contains", path: "notes.md", needle: "saber-was-here" },
        {
          check_id: "check-passes",
          kind: "command_succeeds",
          path: "scripts/check.mjs",
          argv: ["node", "scripts/check.mjs"],
        },
      ],
      idempotency_key: "s31-goal-1",
    }),
    "goal-create",
  );
  await must(
    client.request("plan.freeze", {
      goal_id: goal.goal_id,
      worktree,
      steps: [
        {
          step_id: "edit",
          effect: { kind: "file.edit", path: "notes.md", text: "saber-was-here", reason: "record outcome" },
        },
        { step_id: "net", effect: { kind: "net.request", url: "https://example.invalid" } },
      ],
      idempotency_key: "s31-plan-1",
    }),
    "plan-freeze",
  );
  let run = await must(
    client.request("run.start", {
      goal_id: goal.goal_id,
      plan_version: 1,
      idempotency_key: "s31-run-1",
    }),
    "run-start",
  );
  while (run.state === "waiting_approval") {
    const card = run.card;
    run = await must(
      client.request("approval.resolve", {
        run_id: run.run_id,
        approval_id: card.approval_id,
        decision: "approve",
        digest: card.digest,
        idempotency_key: `s31-approve-${card.step_id}`,
      }),
      `approve-${card.step_id}`,
    );
  }
  return { runId: run.run_id, state: run.state };
}

async function main() {
  const workspace = `s31e2e${process.pid}`;
  const socket = `/tmp/saber-${workspace}.sock`;
  rmSync(socket, { force: true });
  const store = mkdtempSync(join(tmpdir(), "s31-e2e-store-"));
  const worktree = mkdtempSync(join(tmpdir(), "s31-e2e-wt-"));
  cpSync(join(ROOT, "fixtures/repos/basic"), worktree, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: worktree });

  const handle = startServe(store, workspace);
  try {
    const token = await handle.token;
    const client = await connect(workspace, token);
    check(true, "core-serves-and-initializes");

    const { runId, state } = await driveRunToSuccess(client, worktree);
    check(state === "succeeded", "run-succeeded", state);

    // Prepare: baseline-bound classification of the run's changes.
    const prepared = await must(
      client.request("changeset.prepare", { run_id: runId, idempotency_key: "s31-prepare-1" }),
      "changeset-prepare",
    );
    const changed = prepared.files.filter((file) => file.change !== "unchanged");
    check(
      changed.some((file) => file.path === "notes.md" && file.change === "added"),
      "notes-md-classified-added",
    );
    check(Array.isArray(prepared.external_edits) && prepared.external_edits.length === 0, "no-external-edits-detected");
    check(typeof prepared.tree_digest === "string" && prepared.tree_digest.length >= 16, "tree-digest-bound");

    // Adversarial: applying with a wrong expected digest is blocked.
    let staleBlocked = false;
    try {
      await client.request("changeset.apply", {
        run_id: runId,
        expected_tree_digest: "0".repeat(64),
        idempotency_key: "s31-apply-wrong",
      });
    } catch (error) {
      staleBlocked = error.message.includes("stale_apply_blocked");
    }
    check(staleBlocked, "wrong-digest-apply-blocked");

    // Exact apply succeeds.
    const applied = await must(
      client.request("changeset.apply", {
        run_id: runId,
        expected_tree_digest: prepared.tree_digest,
        accepted_paths: ["notes.md"],
        idempotency_key: "s31-apply-1",
      }),
      "changeset-apply-exact",
    );
    check(applied.applied_tree_digest === prepared.tree_digest, "applied-digest-matches-prepare");

    // External edit after approval: the old digest is now stale.
    const { appendFileSync } = await import("node:fs");
    appendFileSync(join(worktree, "README.md"), "\nexternal tamper\n");
    let externalBlocked = false;
    try {
      await client.request("changeset.apply", {
        run_id: runId,
        expected_tree_digest: prepared.tree_digest,
        idempotency_key: "s31-apply-stale",
      });
    } catch (error) {
      externalBlocked = error.message.includes("stale_apply_blocked");
    }
    check(externalBlocked, "external-edit-blocks-stale-apply");

    // Commit: message + authorship disclosure are recorded before git runs.
    const committed = await must(
      client.request("changeset.commit", {
        run_id: runId,
        message: "Add governed fixture note",
        authorship_disclosure: "agent-assisted (fixture run)",
        signing: "none",
        idempotency_key: "s31-commit-1",
      }),
      "changeset-commit",
    );
    check(/^[0-9a-f]{40}$/.test(committed.commit ?? ""), "real-git-commit-created", committed.commit ?? "none");
    const gitLog = spawnSync("git", ["log", "--oneline", "-1"], { cwd: worktree, encoding: "utf8" });
    check(gitLog.status === 0 && gitLog.stdout.includes("Add governed fixture note"), "commit-visible-in-git");

    // Rollback: restore the baseline and PROVE it by hashes.
    const rolledBack = await must(
      client.request("changeset.rollback", { run_id: runId, idempotency_key: "s31-rollback-1" }),
      "changeset-rollback",
    );
    check(rolledBack.restored === true, "rollback-proof-passes");
    check(!existsSync(join(worktree, "notes.md")), "rollback-removed-run-added-file");
    const readmeRestored = readFileSync(join(worktree, "README.md"), "utf8");
    check(!readmeRestored.includes("external tamper"), "rollback-restored-externally-edited-file");

    // Journal audit: every changeset fact is durable and ordered.
    const events = await collectEvents(client);
    const types = events.map((event) => event.type);
    for (const type of [
      "run.baseline_snapshot",
      "changeset.prepared",
      "changeset.applied",
      "changeset.commit_disclosed",
      "changeset.committed",
      "changeset.rolled_back",
    ]) {
      check(types.includes(type), `journal-has-${type}`);
    }
    const disclosedIndex = types.indexOf("changeset.commit_disclosed");
    const committedIndex = types.indexOf("changeset.committed");
    check(disclosedIndex !== -1 && committedIndex > disclosedIndex, "disclosure-precedes-commit");
    const baseline = events.find((event) => event.type === "run.baseline_snapshot");
    check(typeof baseline?.payload?.tree_digest === "string", "baseline-digest-in-journal");

    // Core restart preserves the whole review journal.
    const before = events.length;
    handle.child.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 300));
    rmSync(socket, { force: true });
    const second = startServe(store, workspace);
    try {
      const token2 = await second.token;
      const client2 = await connect(workspace, token2);
      const events2 = await collectEvents(client2);
      check(events2.length === before, "core-restart-preserves-review-journal", `${events2.length} events`);
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

  console.log(`review-commit e2e: ${passes.length} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILURES: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`e2e-review-commit: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
