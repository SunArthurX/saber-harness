#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function verify(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

verify("scripts/verify-s03.mjs");
verify("scripts/verify-remote-s02.mjs", process.argv.slice(2));
console.log("S03 remote verification passed: local contract and same-SHA hosted gates are authoritative.");
