#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { commandSpec } from "./lib/executable.mjs";

const root = process.cwd();
const failures = [];
const allowedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT OR Apache-2.0",
  "Unicode-3.0",
]);

function fail(message) {
  failures.push(message);
}

for (const path of ["package.json", "apps/cli/package.json", "packages/agent-runtime/package.json"]) {
  const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
  if (manifest.private !== true) fail(`${path} must remain private`);
  if (manifest.license !== "UNLICENSED") fail(`${path} must remain UNLICENSED`);
}

let licenses;
try {
  const invocation = commandSpec("pnpm", ["licenses", "list", "--json"]);
  licenses = JSON.parse(execFileSync(invocation.command, invocation.args, { cwd: root, encoding: "utf8" }));
} catch (error) {
  fail(`pnpm license inventory failed: ${error.message}`);
}

for (const [license, packages] of Object.entries(licenses ?? {})) {
  if (!allowedLicenses.has(license)) {
    const names = Array.isArray(packages)
      ? packages
          .map((item) => item.name)
          .filter(Boolean)
          .join(", ")
      : "unknown";
    fail(`dependency license ${license} is not allowlisted (${names})`);
  }
}

try {
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--locked", "--no-deps", "--format-version", "1"], {
      cwd: root,
      encoding: "utf8",
    }),
  );
  for (const packageInfo of metadata.packages) {
    if (!Array.isArray(packageInfo.publish) || packageInfo.publish.length !== 0) {
      fail(`${packageInfo.name} must set publish = false`);
    }
    for (const dependency of packageInfo.dependencies) {
      if (dependency.source?.startsWith("git+")) fail(`${packageInfo.name} has a Git dependency: ${dependency.name}`);
    }
  }
} catch (error) {
  fail(`Cargo license metadata failed: ${error.message}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`License policy passed; ${Object.keys(licenses ?? {}).length} dependency license groups inspected.`);
