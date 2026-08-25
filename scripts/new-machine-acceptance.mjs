#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { commandSpec } from "./lib/executable.mjs";
import { environmentForNode, resolvePinnedNode } from "./lib/toolchain.mjs";

const root = process.cwd();
const versions = JSON.parse(readFileSync(join(root, "tools/versions.json"), "utf8"));
const pinnedNode = resolvePinnedNode(versions.runtime.node);
if (!pinnedNode) {
  console.error(
    `Unable to find Node.js ${versions.runtime.node}. Install the version from .node-version or set SABER_NODE_PATH to its executable.`,
  );
  process.exit(1);
}
const toolchainEnvironment = environmentForNode(pinnedNode);
const startedAt = Date.now();
const limitSeconds = 30 * 60;
const commands = [
  [pinnedNode, ["scripts/bootstrap.mjs", "--check"]],
  ["pnpm", ["install", "--frozen-lockfile"]],
  ["cargo", ["fmt", "--all", "--", "--check"]],
  ["cargo", ["clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"]],
  ["cargo", ["test", "--workspace", "--locked"]],
  ["pnpm", ["verify"]],
];

for (const [command, args] of commands) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const invocation = commandSpec(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env: toolchainEnvironment,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const elapsedSeconds = Math.ceil((Date.now() - startedAt) / 1000);
if (elapsedSeconds > limitSeconds) {
  console.error(`Acceptance exceeded ${limitSeconds} seconds: ${elapsedSeconds}`);
  process.exit(1);
}
console.log(`\nNew-machine acceptance passed in ${elapsedSeconds} seconds (limit: ${limitSeconds}).`);
