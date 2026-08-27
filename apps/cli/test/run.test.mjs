import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createBanner, createUsage, resolveCoreBinary } from "../dist/index.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function cli(args, env = {}) {
  return spawnSync(process.execPath, ["dist/index.js", ...args], {
    cwd: packageRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("CLI banner identifies the model-neutral runtime", () => {
  assert.equal(createBanner(), "saber-cli using saber-agent-runtime/0.1.0");
  assert.ok(createUsage().startsWith("usage: saber run"));
});

test("core binary resolution prefers the explicit override", () => {
  const previous = process.env.SABER_CORE_BIN;
  process.env.SABER_CORE_BIN = "/tmp/saber-core-override";
  try {
    assert.equal(resolveCoreBinary(), "/tmp/saber-core-override");
  } finally {
    if (previous === undefined) {
      delete process.env.SABER_CORE_BIN;
    } else {
      process.env.SABER_CORE_BIN = previous;
    }
  }
});

test("run reports a missing core binary without crashing", () => {
  const result = cli(["run", "--store", join(tmpdir(), "saber-missing"), "--", "/bin/true"], {
    SABER_CORE_BIN: "/nonexistent/saber-core",
  });
  assert.equal(result.status, 64);
  assert.ok(result.stderr.includes("trusted core"));
});

test("run drives the real core end to end and fails closed without a permit", () => {
  const core = resolveCoreBinary();
  assert.notEqual(core, null, "saber-core must be built (cargo test builds it) before cli tests");
  // Requesting the core binary itself without --allow: the deterministic
  // default-deny policy refuses before any sandbox is needed, on every
  // platform, and the refusal is audited.
  const store = join(tmpdir(), `saber-cli-bridge-${process.pid}`);
  const denied = cli(["run", "--store", store, "--", core, "-c", "echo must-not-run"]);
  assert.equal(denied.status, 2, `stdout: ${denied.stdout} stderr: ${denied.stderr}`);
  assert.ok(denied.stdout.includes("denied"));
  assert.ok(denied.stdout.includes("hash_chain_verified=true"));

  if (process.platform === "darwin") {
    // On macOS the wrapper backend is real: an allowlisted, approved
    // command executes under seatbelt confinement through the CLI.
    const allowed = cli([
      "run",
      "--store",
      store,
      "--allow",
      "sh",
      "--approve",
      "--",
      "/bin/sh",
      "-c",
      "echo saber-bridge-ok",
    ]);
    assert.equal(allowed.status, 0, `stdout: ${allowed.stdout} stderr: ${allowed.stderr}`);
    assert.ok(allowed.stdout.includes("saber-bridge-ok"));
    assert.ok(allowed.stdout.includes("hash_chain_verified=true"));
  }
});
