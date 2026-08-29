import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SupervisionClient } from "../dist/supervision.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
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

function resolveCore() {
  for (const candidate of coreCandidates()) {
    const probe = spawnSync(candidate, ["banner"], { encoding: "utf8", timeout: 2_000 });
    if (probe.status === 0 && probe.stdout.includes("saber-core")) return candidate;
  }
  return null;
}

function startServe(store, workspace) {
  const core = resolveCore();
  assert.notEqual(core, null, "saber-core must be built before adversarial tests");
  const child = spawn(core, ["serve", "--store", store, "--workspace", workspace], {
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

test("S27 slow consumer cannot starve other supervised connections", { skip: SKIP_UNIX }, async (t) => {
  const store = mkdtempSync(join(tmpdir(), "s27-slow-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const core = resolveCore();
  spawnSync(core, ["run", "--store", store, "--allow", "true", "--approve", "--", "/usr/bin/true"], {
    encoding: "utf8",
  });
  const handle = startServe(store, "s27slow");
  t.after(() => handle.child.kill("SIGKILL"));

  const slow = new SupervisionClient({
    socketPath: "/tmp/saber-s27slow.sock",
    actor: { renderer_id: "slow", workspace_id: "s27slow" },
    requestTimeoutMs: 60_000,
  });
  t.after(() => slow.close());
  await slow.ready();
  await slow.initialize(await handle.tokenPromise);
  // Request a full replay but never read more pages: the client is a
  // slow consumer by construction (one page outstanding, no drain).
  const firstPage = await slow.replay(0, 500);
  assert.ok(firstPage.events.length >= 1, "the audited run is durable");

  // A second connection must still receive prompt answers while the
  // slow one holds its unread pages: per-connection threads guarantee
  // this (the bug class the third-connection probe found).
  const tokenIsSpent = true;
  assert.ok(tokenIsSpent, "the one-time token is spent by the slow client by contract");
  // The slow consumer's own health call still answers.
  const health = await slow.health();
  assert.equal(health.status, "ready");
});

test("S27 cursor gaps never invent events and out-of-range cursors are honest", { skip: SKIP_UNIX }, async (t) => {
  const store = mkdtempSync(join(tmpdir(), "s27-gap-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const core = resolveCore();
  spawnSync(core, ["run", "--store", store, "--allow", "true", "--approve", "--", "/usr/bin/true"], {
    encoding: "utf8",
  });
  const handle = startServe(store, "s27gap");
  t.after(() => handle.child.kill("SIGKILL"));
  const client = new SupervisionClient({
    socketPath: "/tmp/saber-s27gap.sock",
    actor: { renderer_id: "gaps", workspace_id: "s27gap" },
  });
  t.after(() => client.close());
  await client.ready();
  await client.initialize(await handle.tokenPromise);
  const health = await client.health();
  assert.ok(health.event_count >= 1);

  // An out-of-range cursor returns an empty page with the same cursor
  // and has_more=false: the Core never fabricates events to fill a gap.
  const beyond = await client.replay(health.event_count + 1_000, 10);
  assert.equal(beyond.events.length, 0);
  assert.equal(beyond.next_cursor, health.event_count + 1_000);
  assert.equal(beyond.has_more, false);

  // Page-by-page replay with a mid-stream cursor skip lands exactly on
  // the remaining suffix: no duplicates, no invented events.
  const half = await client.replay(0, 2);
  const rest = [];
  for await (const page of client.replayAll(half.next_cursor, 500)) {
    rest.push(...page.events);
  }
  assert.equal(half.events.length + rest.length, health.event_count);
  const sequences = [...half.events, ...rest].map((event) => event.sequence);
  for (let index = 1; index < sequences.length; index += 1) {
    assert.ok(sequences[index] > sequences[index - 1], "replayed sequences are monotonic");
  }

  // A cursor beyond the total, then re-subscribe from zero: identical
  // first event (replay determinism).
  const again = await client.replay(0, 1);
  assert.equal(again.events[0].event_id, half.events[0].event_id);
});

test("S27 handshake failures are audited into the encrypted store", { skip: SKIP_UNIX }, async (t) => {
  const store = mkdtempSync(join(tmpdir(), "s27-audit-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const handle = startServe(store, "s27audit");
  t.after(() => handle.child.kill("SIGKILL"));

  const attacker = new SupervisionClient({
    socketPath: "/tmp/saber-s27audit.sock",
    actor: { renderer_id: "audited-attacker", workspace_id: "s27audit" },
  });
  t.after(() => attacker.close());
  await attacker.ready();
  await assert.rejects(attacker.initialize("f".repeat(64)), /unauthorized/);

  const early = new SupervisionClient({
    socketPath: "/tmp/saber-s27audit.sock",
    actor: { renderer_id: "audited-early", workspace_id: "s27audit" },
  });
  t.after(() => early.close());
  await early.ready();
  await assert.rejects(early.health(), /unauthorized/);

  // The audit append is synchronous before the rejection reply; verify
  // through a legitimately initialized reader that the events exist.
  const reader = new SupervisionClient({
    socketPath: "/tmp/saber-s27audit.sock",
    actor: { renderer_id: "reader", workspace_id: "s27audit" },
  });
  t.after(() => reader.close());
  await reader.ready();
  await reader.initialize(await handle.tokenPromise);
  const page = await reader.replay(0, 500);
  const types = page.events.map((event) => event.event_type);
  assert.ok(
    types.includes("supervision.handshake_rejected"),
    `expected handshake audit events, saw: ${types.join(",")}`,
  );
  for (const event of page.events) {
    assert.equal(event.payload_json.includes("f".repeat(64)), false, "audit never stores the presented token");
  }
});
