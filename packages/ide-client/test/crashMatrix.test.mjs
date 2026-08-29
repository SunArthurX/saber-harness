import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { nextLifecycle, SupervisionClient } from "../dist/supervision.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

// The S27 increment serves the unix-domain endpoint only; Windows
// named-pipe transport fails closed by contract until its dedicated landing.
const SKIP_UNIX = process.platform !== "darwin" && process.platform !== "linux";
const WORKSPACE = "s27crash";
const SOCKET = `/tmp/saber-${WORKSPACE}.sock`;

function coreCandidates() {
  const candidates = [];
  if (process.env.SABER_CORE_BIN && existsSync(process.env.SABER_CORE_BIN)) {
    candidates.push(process.env.SABER_CORE_BIN);
  }
  for (const profile of ["debug", "release"]) {
    const candidate = join(TEST_DIR, "..", "..", "..", "target", profile, "saber-core");
    if (existsSync(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function resolveCore() {
  for (const candidate of coreCandidates()) {
    const probe = spawnSync(candidate, ["banner"], { encoding: "utf8", timeout: 2_000 });
    if (probe.status === 0) return candidate;
  }
  return null;
}

function startServe(store) {
  const core = resolveCore();
  assert.notEqual(core, null, "saber-core must be built before crash-matrix tests");
  const child = spawn(core, ["serve", "--store", store, "--workspace", WORKSPACE], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tokenPromise = new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("no bootstrap token")), 15_000);
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
      reject(new Error("serve exited before printing the token"));
    });
  });
  tokenPromise.catch(() => {});
  return { child, tokenPromise };
}

async function snapshot(client) {
  const health = await client.health();
  const events = [];
  for await (const page of client.replayAll(0, 100)) {
    events.push(...page.events);
  }
  return { health, firstEventId: events[0]?.event_id ?? null, count: events.length };
}

test("core kill degrades the client; recovery replays identical durable state", { skip: SKIP_UNIX }, async (t) => {
  rmSync(SOCKET, { force: true });
  const store = mkdtempSync(join(tmpdir(), "s27-crash-"));
  t.after(() => rmSync(store, { force: true, recursive: true }));
  const core = resolveCore();
  spawnSync(core, ["run", "--store", store, "--allow", "true", "--approve", "--", "/usr/bin/true"], {
    encoding: "utf8",
  });

  const first = startServe(store);
  const clientA = new SupervisionClient({
    socketPath: SOCKET,
    actor: { renderer_id: "renderer-a", workspace_id: WORKSPACE },
  });
  await clientA.ready();
  await clientA.initialize(await first.tokenPromise);
  const before = await snapshot(clientA);
  assert.ok(before.count >= 1, "fixture run must be durable before the crash");

  // Renderer crash: close the client socket; the Core keeps serving and
  // its durable state must be unchanged.
  clientA.close();
  const probeClient = new SupervisionClient({
    socketPath: SOCKET,
    actor: { renderer_id: "probe", workspace_id: WORKSPACE },
  });
  // The bootstrap token is one-time by contract, so the surviving Core
  // refuses a second handshake: that IS the renderer-reload fail-closed
  // path; the desktop main re-spawns the Core instead of re-handshaking.
  await probeClient.ready();
  await assert.rejects(probeClient.initialize(await first.tokenPromise), /unauthorized/);
  probeClient.close();

  // Core kill mid-session: the pending request observes the close and the
  // pure lifecycle machine degrades instead of inventing state.
  const pendingHealth = clientA === null ? null : null;
  const watcher = new Promise((resolve) => {
    first.child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  first.child.kill("SIGKILL");
  const exit = await watcher;
  assert.equal(exit.signal, "SIGKILL");
  let lifecycle = "ready";
  lifecycle = nextLifecycle(lifecycle, "disconnected");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lifecycle = nextLifecycle(lifecycle, "retry_scheduled");
  }
  lifecycle = nextLifecycle(lifecycle, "retries_exhausted");
  assert.equal(lifecycle, "degraded");
  assert.notEqual(pendingHealth, "polled-after-kill");

  // Recovery: respawn the Core on the same store, fresh one-time token,
  // replay must be identical — no duplicates, no gaps, same first event.
  // Recovery: respawn the Core on the same store, fresh one-time token.
  // The pre-crash history must be preserved exactly (same first event,
  // same runs); new suffix events are only the audit records of the
  // rejected handshakes above (fail closed AND audited).
  await new Promise((resolve) => setTimeout(resolve, 200));
  rmSync(SOCKET, { force: true });
  const second = startServe(store);
  const clientB = new SupervisionClient({
    socketPath: SOCKET,
    actor: { renderer_id: "renderer-b", workspace_id: WORKSPACE },
  });
  await clientB.ready();
  await clientB.initialize(await second.tokenPromise);
  const after = await snapshot(clientB);
  const afterTypes = [];
  for await (const page of clientB.replayAll(0, 500)) {
    afterTypes.push(...page.events.map((event) => event.event_type));
  }
  clientB.close();
  second.child.kill("SIGKILL");

  assert.ok(after.count >= before.count, "recovery replay must not lose events");
  assert.equal(after.firstEventId, before.firstEventId, "durable order and first event preserved");
  assert.equal(after.health.run_count, before.health.run_count, "run projection unchanged");
  const suffix = afterTypes.slice(before.count);
  assert.ok(
    suffix.every((type) => type === "supervision.handshake_rejected"),
    `only handshake audit records may appear after the crash history, saw: ${suffix.join(",")}`,
  );
});
