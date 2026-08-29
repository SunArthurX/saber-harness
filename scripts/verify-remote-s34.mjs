#!/usr/bin/env node
/**
 * S34 remote verification — production-grade strict remote gate.
 * Chains the local S34 contract verification and the previous segment's
 * strict remote verification so each Segment stands on every prior gate.
 */
import { spawnSync } from "node:child_process";

function verify(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

verify("scripts/verify-s34.mjs");
verify("scripts/verify-remote-s33.mjs", process.argv.slice(2));
console.log("S34 remote verification passed: local contracts plus same-SHA hosted gates are authoritative.");
