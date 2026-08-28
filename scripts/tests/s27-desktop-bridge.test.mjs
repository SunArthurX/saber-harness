import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const bridgePath = join(root, "apps/desktop-codeoss/extensions/saber-agent/src/bridge.js");
const bridgeSource = readFileSync(bridgePath, "utf8");
// A Windows absolute path is not a valid ESM specifier; always use a file URL.
const bridge = await import(pathToFileURL(bridgePath).href);

test("S27 bridge exposes exactly the frozen supervision allowlist", () => {
  assert.deepEqual(
    [...bridge.BRIDGE_METHODS],
    ["saber.core.initialize", "saber.core.health", "saber.events.subscribe", "saber.workbench.status"],
  );
  assert.ok(Object.isFrozen(bridge.BRIDGE_METHODS), "the allowlist must be frozen");
});

test("S27 bridge rejects unknown methods and oversized payloads before forwarding", async () => {
  const forwarded = [];
  const saber = bridge.createSaberBridge(async (method, payload) => {
    forwarded.push({ method, payload });
    return { ok: true };
  });
  await saber("saber.core.health", {});
  assert.equal(forwarded.length, 1);
  await assert.rejects(saber("shell.exec", { command: "rm -rf /" }), /unknown_bridge_method/);
  await assert.rejects(saber("fs.read", {}), /unknown_bridge_method/);
  await assert.rejects(saber("net.connect", {}), /unknown_bridge_method/);
  await assert.rejects(saber("ipc.generic", {}), /unknown_bridge_method/);
  await assert.rejects(saber("saber.core.health", { blob: "x".repeat(1024 * 1024 + 10) }), /bridge_payload_too_large/);
  assert.equal(forwarded.length, 1, "no rejected intent may reach the channel");
});

test("S27 bridge source stays dependency-free with no host capability", () => {
  assert.equal(bridgeSource.includes("require("), false, "bridge must not require host modules");
  assert.equal(bridgeSource.includes("child_process"), false);
  assert.equal(bridgeSource.includes("node:fs"), false);
  assert.equal(bridgeSource.includes("node:net"), false);
  assert.equal(bridgeSource.includes("process."), false);
  assert.equal(bridgeSource.includes("ipcRenderer"), false, "no raw Electron surface");
});

test("S27 extension manifest still contributes no webview and only saber.* commands", () => {
  const manifest = JSON.parse(
    readFileSync(join(root, "apps/desktop-codeoss/extensions/saber-agent/package.json"), "utf8"),
  );
  assert.equal(JSON.stringify(manifest).includes('"webview"'), false);
  for (const command of manifest.contributes.commands) {
    assert.ok(command.command.startsWith("saber."));
  }
});
