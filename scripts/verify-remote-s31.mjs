#!/usr/bin/env node
/**
 * S31 remote verification — production-grade strict remote gate.
 * Chains the local S31 contract verification and the previous segment's
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

verify("scripts/verify-s31.mjs");
verify("scripts/verify-remote-s30.mjs", process.argv.slice(2));
console.log("S31 remote verification passed: local contracts plus same-SHA hosted gates are authoritative.");
