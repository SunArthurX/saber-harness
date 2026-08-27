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

verify("scripts/verify-s21.mjs");
verify("scripts/verify-remote-s20.mjs", process.argv.slice(2));
console.log(
  "S21 remote verification passed: enterprise control contracts plus same-SHA hosted gates are authoritative.",
);
