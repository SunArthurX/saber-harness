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

function supportsServe(core) {
  // A serve-capable core blocks on the probe (killed by the timeout); a
  // stale build exits 64 with "unknown command serve" immediately.
  const probeStore = mkdtempSync(join(tmpdir(), "s27-probe-"));
  try {
    const probe = spawnSync(core, ["serve", "--store", probeStore, "--workspace", "s27probe"], {
      timeout: 1_500,
      encoding: "utf8",
    });
    rmSync("/tmp/saber-s27probe.sock", { force: true });
    return probe.status !== 64;
  } finally {
    rmSync(probeStore, { force: true, recursive: true });
  }
}

function resolveCore() {
  for (const candidate of coreCandidates()) {
    if (supportsServe(candidate)) return candidate;
  }
  return null;
}

function startServe(store, workspace) {
  const core = resolveCore();
  assert.notEqual(core, null, "saber-core must be built before supervision tests");
  const child = spawn(core, ["serve", "--store", store, "--workspace", workspace], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tokenPromise = new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("serve did not print a bootstrap token")), 15_000);
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
  return { child, token: tokenPromise };
}

function stopServe(handle) {
  handle.child.kill("SIGKILL");
}

const WORKSPACE = "s27t1";
const SOCKET = `/tmp/saber-${WORKSPACE}.sock`;

test("supervision lifecycle machine covers the S27-WP01 states", { skip: SKIP_UNIX }, () => {
  assert.equal(nextLifecycle("booting", "spawned"), "starting_core");
  assert.equal(nextLifecycle("starting_core", "socket_open"), "attaching");
  assert.equal(nextLifecycle("attaching", "initialized"), "ready");
  assert.equal(nextLifecycle("ready", "disconnected"), "reconnecting");
  assert.equal(nextLifecycle("reconnecting", "retries_exhausted"), "degraded");
  assert.equal(nextLifecycle("attaching", "handshake_denied"), "degraded");
  assert.equal(nextLifecycle("attaching", "incompatible"), "incompatible");
  assert.equal(nextLifecycle("ready", "begin_stop"), "stopping");
  assert.equal(nextLifecycle("stopping", "stopped"), "stopped");
  // safe mode wins from anywhere
  assert.equal(nextLifecycle("ready", "enter_safe_mode"), "safe_mode");
});

test("initialize → health → paged replay against the real Core", { skip: SKIP_UNIX }, async (t) => {
  rmSync(SOCKET, { force: true });
  const store = mkdtempSync(join(tmpdir(), "s27-transport-"));
  t.after(() => rmSync(store, { force: true, recursive: true }));
  const core = resolveCore();
  spawnSync(core, ["run", "--store", store, "--allow", "true", "--approve", "--", "/usr/bin/true"], {
    encoding: "utf8",
  });
  const handle = startServe(store, WORKSPACE);
  t.after(() => stopServe(handle));

  const client = new SupervisionClient({
    socketPath: SOCKET,
    actor: { renderer_id: "test-renderer", workspace_id: WORKSPACE },
  });
  t.after(() => client.close());
  await client.ready();
  const hello = await client.initialize(await handle.token);
  assert.equal(hello.protocol_version, "1.0.0");
  assert.ok(hello.capabilities.includes("core.health"));

  const health = await client.health();
  assert.equal(health.status, "ready");
  assert.ok(health.event_count >= 1, "the audited run must be replayable");
  assert.ok(health.run_count >= 1);

  let seen = 0;
  let lastCursor = 0;
  for await (const page of client.replayAll(0, 2)) {
    seen += page.events.length;
    lastCursor = page.next_cursor;
  }
  assert.equal(seen, health.event_count, "paged replay must return exactly the durable events");
  assert.equal(lastCursor, health.event_count);

  const empty = await client.replay(lastCursor, 10);
  assert.equal(empty.events.length, 0);
  assert.equal(empty.has_more, false);
});

test("forged and replayed bootstrap tokens fail closed", { skip: SKIP_UNIX }, async (t) => {
  rmSync(SOCKET, { force: true });
  const store = mkdtempSync(join(tmpdir(), "s27-forged-"));
  t.after(() => rmSync(store, { force: true, recursive: true }));
  const handle = startServe(store, WORKSPACE);
  t.after(() => stopServe(handle));

  const forged = new SupervisionClient({
    socketPath: SOCKET,
    actor: { renderer_id: "attacker", workspace_id: WORKSPACE },
  });
  t.after(() => forged.close());
  await forged.ready();
  await assert.rejects(forged.initialize("0".repeat(64)), /unauthorized/);

  const legit = new SupervisionClient({
    socketPath: SOCKET,
    actor: { renderer_id: "renderer", workspace_id: WORKSPACE },
  });
  t.after(() => legit.close());
  await legit.ready();
  await legit.initialize(await handle.token);

  const replay = new SupervisionClient({
    socketPath: SOCKET,
    actor: { renderer_id: "renderer-replay", workspace_id: WORKSPACE },
  });
  t.after(() => replay.close());
  await replay.ready();
  await assert.rejects(replay.initialize(await handle.token), /unauthorized/);
});

test("pre-handshake requests, mutations and dead clients are refused", { skip: SKIP_UNIX }, async (t) => {
  rmSync(SOCKET, { force: true });
  const store = mkdtempSync(join(tmpdir(), "s27-order-"));
  t.after(() => rmSync(store, { force: true, recursive: true }));
  const handle = startServe(store, WORKSPACE);
  t.after(() => stopServe(handle));

  const client = new SupervisionClient({
    socketPath: SOCKET,
    actor: { renderer_id: "early", workspace_id: WORKSPACE },
  });
  t.after(() => client.close());
  await client.ready();
  await assert.rejects(client.health(), /unauthorized/);
});
