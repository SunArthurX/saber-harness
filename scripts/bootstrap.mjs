#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { commandSpec } from "./lib/executable.mjs";
import { environmentForNode, resolvePinnedNode } from "./lib/toolchain.mjs";

const root = process.cwd();
const versions = JSON.parse(readFileSync(join(root, "tools/versions.json"), "utf8"));
const install = process.argv.includes("--install");
const checkOnly = process.argv.includes("--check");

if (!install && !checkOnly) {
  console.error("Usage: node scripts/bootstrap.mjs --check|--install");
  process.exit(2);
}

const pinnedNode = resolvePinnedNode(versions.runtime.node);
if (!pinnedNode) {
  console.error(
    `Unable to find Node.js ${versions.runtime.node}. Install the version from .node-version with NVM, Volta, mise, asdf, fnm or nodenv, or set SABER_NODE_PATH to its executable.`,
  );
  process.exit(1);
}
const toolchainEnvironment = environmentForNode(pinnedNode);

if (process.versions.node !== versions.runtime.node) {
  if (process.env.SABER_BOOTSTRAP_REEXEC === "1") {
    console.error(`Unable to activate Node.js ${versions.runtime.node} from ${pinnedNode}.`);
    process.exit(1);
  }
  console.log(`Switching Node.js ${process.versions.node} -> ${versions.runtime.node} (${pinnedNode})`);
  const result = spawnSync(pinnedNode, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: root,
    env: { ...toolchainEnvironment, SABER_BOOTSTRAP_REEXEC: "1" },
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

function run(command, args) {
  const invocation = commandSpec(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: "utf8",
    env: toolchainEnvironment,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (install) {
  run("corepack", ["install", "--global", `pnpm@${versions.runtime.pnpm}`]);
  run("rustup", [
    "toolchain",
    "install",
    versions.runtime.rust,
    "--profile",
    "minimal",
    "--component",
    "rustfmt",
    "--component",
    "clippy",
  ]);
}

function output(command, args) {
  try {
    const invocation = commandSpec(command, args);
    return execFileSync(invocation.command, invocation.args, {
      cwd: root,
      encoding: "utf8",
      env: toolchainEnvironment,
    }).trim();
  } catch (error) {
    console.error(`Unable to run ${command}: ${error.message}`);
    process.exit(1);
  }
}

const actual = {
  node: process.versions.node,
  pnpm: output("pnpm", ["--version"]),
  rust: output("rustc", ["--version"]).match(/^rustc ([^ ]+)/)?.[1],
  cargo: output("cargo", ["--version"]).match(/^cargo ([^ ]+)/)?.[1],
};
const expected = {
  node: versions.runtime.node,
  pnpm: versions.runtime.pnpm,
  rust: versions.runtime.rust,
  cargo: versions.runtime.rust,
};

let failed = false;
for (const [tool, expectedVersion] of Object.entries(expected)) {
  const actualVersion = actual[tool];
  if (actualVersion !== expectedVersion) {
    failed = true;
    console.error(`FAIL ${tool}: expected ${expectedVersion}, got ${actualVersion ?? "unavailable"}`);
  } else {
    console.log(`PASS ${tool}: ${actualVersion}`);
  }
}

if (failed) process.exit(1);
console.log("Pinned toolchain is ready.");
