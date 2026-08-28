#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];

function check(condition, name, detail) {
  (condition ? passes : failures).push({ name, detail });
}

function text(path) {
  return readFileSync(join(root, path), "utf8");
}

function json(path) {
  return JSON.parse(text(path));
}

const requiredDirectories = ["apps", "crates", "packages", "schemas", "evals", "tools"];
for (const directory of requiredDirectories) check(existsSync(join(root, directory)), "required-directory", directory);

const requiredFiles = [
  ".node-version",
  ".npmrc",
  "Cargo.lock",
  "Cargo.toml",
  "biome.json",
  "deny.toml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "rust-toolchain.toml",
  "tools/versions.json",
  ".github/dependabot.yml",
  ".github/workflows/monorepo-ci.yml",
  "scripts/bootstrap.mjs",
  "scripts/lib/toolchain.mjs",
  "scripts/new-machine-acceptance.mjs",
  "scripts/verify-licenses.mjs",
  "scripts/verify-remote-s02.mjs",
];
for (const file of requiredFiles) check(existsSync(join(root, file)), "required-file", file);

const versions = json("tools/versions.json");
check(text(".node-version").trim() === versions.runtime.node, "node-pin", versions.runtime.node);
check(text("rust-toolchain.toml").includes(`channel = "${versions.runtime.rust}"`), "rust-pin", versions.runtime.rust);

const rootPackage = json("package.json");
check(rootPackage.packageManager === `pnpm@${versions.runtime.pnpm}`, "pnpm-pin", rootPackage.packageManager);
check(rootPackage.engines.node === versions.runtime.node, "node-engine", rootPackage.engines.node);
check(rootPackage.private === true, "root-private", "true");
for (const script of [
  "build",
  "format:check",
  "lint",
  "test",
  "typecheck",
  "verify:licenses",
  "verify:repo",
  "acceptance:new-machine",
]) {
  check(Boolean(rootPackage.scripts[script]), "root-script", script);
}

const bootstrap = text("scripts/bootstrap.mjs");
const acceptance = text("scripts/new-machine-acceptance.mjs");
check(bootstrap.includes("resolvePinnedNode"), "bootstrap-node-selection", "exact pinned Node resolver");
check(bootstrap.includes("SABER_BOOTSTRAP_REEXEC"), "bootstrap-node-reexec", "pinned Node re-execution guard");
check(acceptance.includes("environmentForNode"), "acceptance-node-path", "pinned Node PATH propagation");

const workspace = text("pnpm-workspace.yaml");
for (const directory of ["apps/*", "packages/*"])
  check(workspace.includes(`- "${directory}"`), "pnpm-workspace", directory);
for (const [catalogName, version] of Object.entries({
  "@biomejs/biome": versions.format_and_types.biome,
  "@types/node": versions.format_and_types.types_node,
  typescript: versions.format_and_types.typescript,
})) {
  const quotedName = catalogName.startsWith("@") ? `"${catalogName}"` : catalogName;
  const escapedVersion = version.replaceAll(".", "\\.");
  check(
    new RegExp(`${quotedName}: ["']?${escapedVersion}["']?`).test(workspace),
    "catalog-pin",
    `${catalogName}@${version}`,
  );
}

const cargo = text("Cargo.toml");
for (const member of ["crates/core-protocol", "crates/saber-core"])
  check(cargo.includes(`"${member}"`), "cargo-member", member);
const rustLanguageVersion = versions.runtime.rust.split(".").slice(0, 2).join(".");
check(cargo.includes(`rust-version = "${rustLanguageVersion}"`), "cargo-rust-version", rustLanguageVersion);

const workflow = text(".github/workflows/monorepo-ci.yml");
for (const runner of ["ubuntu-latest", "macos-latest", "windows-latest"])
  check(workflow.includes(runner), "ci-runner", runner);
// Every registered action must be referenced by its pinned SHA somewhere in
// the workflow set; the registry covers all workflows, not only monorepo-ci.
const allWorkflowText = readdirSync(join(root, ".github", "workflows"))
  .filter((name) => name.endsWith(".yml"))
  .map((name) => text(`.github/workflows/${name}`))
  .join("\n");
for (const [name, action] of Object.entries(versions.ci_actions))
  check(allWorkflowText.includes(`@${action.sha}`), "immutable-action", `${name} ${action.sha}`);
for (const gate of [
  "pnpm install --frozen-lockfile",
  "cargo fmt --all -- --check",
  "cargo clippy",
  "cargo test",
  "pnpm verify",
  "pnpm audit --prod --audit-level high",
]) {
  check(workflow.includes(gate), "ci-gate", gate);
}
check(workflow.includes("timeout-minutes: 30"), "ci-time-budget", "30 minutes");
check(workflow.includes("node scripts/verify-s00.mjs"), "ci-secret-scan", "repository safety verifier");
check((workflow.match(/fetch-depth: 0/g) ?? []).length === 2, "ci-full-history", "both checkout steps");

const repositoryWorkflow = text(".github/workflows/repository-verification.yml");
check(repositoryWorkflow.includes("node scripts/verify-s02.mjs"), "baseline-s02-gate", "repository-verification");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S02 verification passed with ${passes.length} checks.`);
