#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const startedAt = Date.now();
const limitSeconds = 30 * 60;
const commands = [
  ["node", ["scripts/bootstrap.mjs", "--check"]],
  ["pnpm", ["install", "--frozen-lockfile"]],
  ["cargo", ["fmt", "--all", "--", "--check"]],
  ["cargo", ["clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"]],
  ["cargo", ["test", "--workspace", "--locked"]],
  ["pnpm", ["verify"]],
];

for (const [command, args] of commands) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const elapsedSeconds = Math.ceil((Date.now() - startedAt) / 1000);
if (elapsedSeconds > limitSeconds) {
  console.error(`Acceptance exceeded ${limitSeconds} seconds: ${elapsedSeconds}`);
  process.exit(1);
}
console.log(`\nNew-machine acceptance passed in ${elapsedSeconds} seconds (limit: ${limitSeconds}).`);
