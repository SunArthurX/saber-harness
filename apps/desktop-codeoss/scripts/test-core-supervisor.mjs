#!/usr/bin/env node
/**
 * S27-WP01 supervisor verification — a standalone assertion script (the
 * same style as smoke.mjs) instead of node:test: supervised child
 * processes interact badly with the node:test runner's IPC teardown in
 * this environment, while a plain process exits deterministically.
 *
 * Exercises the real supervision contract: spawn the real Core, capture
 * the one-time stdout token, crash it, verify bounded-backoff respawn
 * with a fresh token, then graceful shutdown inside the deadline.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { resolveCoreBinary, superviseCore, SUPERVISOR_DEFAULTS } = await import(
  new URL("./core-supervisor.mjs", import.meta.url).href
);

const failures = [];
const check = (condition, name) => {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}`);
  if (!condition) failures.push(name);
};

const unixOnly = process.platform === "darwin" || process.platform === "linux";
if (!unixOnly) {
  console.log("SKIP supervisor verification requires the unix transport");
  process.exit(0);
}

// 1. Real Core: token capture and graceful stop.
{
  const core = resolveCoreBinary();
  check(core !== null, "core binary resolved");
  const store = mkdtempSync(join(tmpdir(), "s27-sup-"));
  const supervisor = superviseCore({ core, store, workspace: "s27sup" });
  try {
    const token = await supervisor.token();
    check(/^[0-9a-f]{64}$/.test(token), "one-time token captured from piped stdout");
    check(supervisor.state.status === "ready", "status ready after token capture");
    check(supervisor.state.restarts === 0, "no restarts for a healthy Core");
    const outcome = await supervisor.stop();
    check(outcome.forced === false, "graceful stop inside the deadline");
    check(supervisor.state.status === "stopped", "status stopped after stop()");
  } finally {
    await supervisor.stop().catch(() => {});
    rmSync(store, { recursive: true, force: true });
    rmSync("/tmp/saber-s27sup.sock", { force: true });
  }
}

// 2. Crash + bounded-backoff respawn with a fresh token (deterministic
//    fake Core so socket state cannot interfere).
{
  const dir = mkdtempSync(join(tmpdir(), "s27-sup-restart-"));
  const script = join(dir, "fake-core.cjs");
  writeFileSync(
    script,
    [
      'const crypto = require("node:crypto");',
      'process.stdout.write("bootstrap-token " + crypto.randomBytes(32).toString("hex") + "\\n");',
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"),
  );
  const supervisor = superviseCore({
    core: process.execPath,
    coreArgs: [script],
    store: dir,
    workspace: "s27fake",
    policy: { restartBackoffMs: [50, 100], maxRestarts: 5, tokenTimeoutMs: 8_000 },
  });
  try {
    const firstToken = await supervisor.token();
    check(/^[0-9a-f]{64}$/.test(firstToken), "fake core token captured");
    check(supervisor.signal("SIGKILL") === true, "crash signal delivered");
    const deadline = Date.now() + 15_000;
    while (!(supervisor.state.restarts >= 1 && supervisor.state.status === "ready") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    check(supervisor.state.status === "ready", "supervisor recovered after the crash");
    check(supervisor.state.restarts >= 1, "crash counted as a restart");
    check(supervisor.state.token !== firstToken, "respawn minted a fresh one-time token");
    const outcome = await supervisor.stop();
    check(outcome.forced === false, "restarted core stopped gracefully");
  } finally {
    await supervisor.stop().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

// 3. Policy defaults.
check(Object.isFrozen(SUPERVISOR_DEFAULTS), "policy defaults frozen");
check(
  SUPERVISOR_DEFAULTS.shutdownGraceMs > 0 && SUPERVISOR_DEFAULTS.shutdownGraceMs <= 10_000,
  "shutdown deadline bounded",
);
check(SUPERVISOR_DEFAULTS.maxRestarts > 0 && SUPERVISOR_DEFAULTS.maxRestarts <= 10, "restart budget bounded");
check(
  SUPERVISOR_DEFAULTS.restartBackoffMs.every((ms) => ms > 0),
  "backoff schedule positive",
);

if (failures.length > 0) {
  console.error(`supervisor verification failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("supervisor verification passed");
process.exit(0);
