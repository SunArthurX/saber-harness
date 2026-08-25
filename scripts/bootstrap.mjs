#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { executableName } from "./lib/executable.mjs";

const root = process.cwd();
const versions = JSON.parse(readFileSync(join(root, "tools/versions.json"), "utf8"));
const install = process.argv.includes("--install");
const checkOnly = process.argv.includes("--check");

if (!install && !checkOnly) {
  console.error("Usage: node scripts/bootstrap.mjs --check|--install");
  process.exit(2);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (install) {
  run(executableName("corepack"), ["install", "--global", `pnpm@${versions.runtime.pnpm}`]);
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
    return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    console.error(`Unable to run ${command}: ${error.message}`);
    process.exit(1);
  }
}

const actual = {
  node: process.versions.node,
  pnpm: output(executableName("pnpm"), ["--version"]),
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
