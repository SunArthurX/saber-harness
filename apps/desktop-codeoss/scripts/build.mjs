#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * S26-WP05 — desktop build entry point.
 *
 * The upstream tree is built with the toolchain pinned in upstream.lock.json
 * (read from upstream, never from the Saber monorepo defaults). This script
 * fails closed until the exact Node version is available so a mismatched
 * local toolchain can never produce an artifact we would call reproducible.
 *
 * Status (honest): the toolchain preflight and worktree preparation below
 * are real; the full Electron compile/package invocation is executed only
 * with `--full` on a matching toolchain and is recorded as pending S26
 * evidence until it has actually run on all three platforms.
 *
 * Environment:
 *   SABER_DESKTOP_NODE  path to a Node binary matching lock.toolchain.node
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractWorktree } from "./apply-patches.mjs";
import { loadLock, validateLock } from "./fetch-upstream.mjs";

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function nodeVersion(binary) {
  const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return (result.stdout ?? "").trim().replace(/^v/, "");
}

async function main() {
  const lock = loadLock();
  const validation = validateLock(lock);
  if (!validation.ok) {
    console.error(`build: upstream.lock.json rejected:\n  - ${validation.errors.join("\n  - ")}`);
    process.exit(1);
  }
  const candidate = process.env.SABER_DESKTOP_NODE ?? process.execPath;
  if (!existsSync(candidate)) {
    console.error(`build: node binary not found: ${candidate}`);
    process.exit(64);
  }
  const version = nodeVersion(candidate);
  if (version !== lock.toolchain.node) {
    console.error(
      `build: toolchain mismatch — upstream ${lock.source.ref} pins Node ${lock.toolchain.node}, ` +
        `${candidate} is ${version ?? "unknown"}.`,
    );
    console.error(
      "build: install the pinned version (for example into apps/desktop-codeoss/.cache/node/) " +
        "and point SABER_DESKTOP_NODE at it, then re-run.",
    );
    process.exit(64);
  }
  const { worktree, mode } = await extractWorktree(lock);
  console.log(`toolchain ok: node ${version} at ${candidate}`);
  console.log(`worktree ${mode}: ${worktree}`);

  if (!process.argv.includes("--full")) {
    console.log(
      "preflight complete; pass --full to run the upstream Electron compile and package tasks " +
        "(S26-WP05 continues: the three-platform builds and their digests are recorded as evidence only after they run)",
    );
    return;
  }
  const npm = join(dirname(candidate), "npm");
  run(npm, ["run", "compile"], { cwd: worktree }); // full compile: executed only on a verified toolchain
  console.log("compile finished; packaging tasks for each platform are the next S26-WP05 step");
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    console.error(`build: ${command} ${args.join(" ")} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
    process.exit(1);
  }
  return result;
}

main().catch((error) => {
  console.error(`build: ${error.message}`);
  process.exit(1);
});
