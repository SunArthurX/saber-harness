#!/usr/bin/env node
/**
 * S26-WP05 — desktop build entry point.
 *
 * The upstream tree is built with the toolchain pinned in upstream.lock.json
 * (read from upstream, never from the Saber monorepo defaults). This script
 * fails closed until the exact Node version is available so a mismatched
 * toolchain can never produce an artifact we would call reproducible.
 *
 * Stages (composable flags, always preceded by the toolchain preflight):
 *   (default)       preflight + worktree preparation only
 *   --install       npm install inside the patched worktree
 *   --compile       upstream compile (npm run compile)
 *   --launch-smoke  launch the built app with --version: the process must
 *                   boot, report the pinned release and exit cleanly
 *   --package       upstream packaging task named by SABER_DESKTOP_GULP_TASK
 *
 * Environment:
 *   SABER_DESKTOP_NODE        path to a Node binary matching the lock pin
 *   SABER_DESKTOP_GULP_TASK   upstream gulp packaging task (for --package)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractWorktree } from "./apply-patches.mjs";
import { loadLock, validateLock } from "./fetch-upstream.mjs";

function resolveToolchain(lock) {
  const nodeBinary = resolve(process.env.SABER_DESKTOP_NODE ?? process.execPath);
  if (!existsSync(nodeBinary)) {
    console.error(`build: node binary not found: ${nodeBinary}`);
    process.exit(64);
  }
  const probe = spawnSync(nodeBinary, ["--version"], { encoding: "utf8" });
  const version = (probe.stdout ?? "").trim().replace(/^v/, "");
  if (probe.status !== 0 || version !== lock.toolchain.node) {
    console.error(
      `build: toolchain mismatch — upstream ${lock.source.ref} pins Node ${lock.toolchain.node}, ` +
        `${nodeBinary} is ${probe.status === 0 ? version : "unknown"}.`,
    );
    console.error("build: install the pinned version and point SABER_DESKTOP_NODE at it, then re-run.");
    process.exit(64);
  }
  const nodeDir = dirname(nodeBinary);
  const env = {
    ...process.env,
    PATH: `${nodeDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
  };
  const onWindows = process.platform === "win32";
  return {
    nodeBinary,
    npm: onWindows ? "npm.cmd" : "npm",
    // npm.cmd is a batch script: Windows needs a shell to execute it.
    npmShell: onWindows,
    env,
    version,
  };
}

function stage(env, command, args, cwd, label, shell = false) {
  console.log(`build: ${label} → ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell });
  if (result.status !== 0) {
    console.error(`build: ${label} failed with exit ${result.status}`);
    process.exit(1);
  }
}

async function main() {
  const lock = loadLock();
  const validation = validateLock(lock);
  if (!validation.ok) {
    console.error(`build: upstream.lock.json rejected:\n  - ${validation.errors.join("\n  - ")}`);
    process.exit(1);
  }
  const toolchain = resolveToolchain(lock);
  const { worktree, mode } = await extractWorktree(lock);
  console.log(`toolchain ok: node ${toolchain.version} at ${toolchain.nodeBinary}`);
  console.log(`worktree ${mode}: ${worktree}`);

  const stages = process.argv.slice(2).filter((flag) => flag.startsWith("--"));

  if (stages.includes("--install")) {
    stage(
      toolchain.env,
      toolchain.npm,
      ["install", "--no-fund", "--no-audit"],
      worktree,
      "npm install",
      toolchain.npmShell,
    );
  }
  if (stages.includes("--compile")) {
    stage(toolchain.env, toolchain.npm, ["run", "compile"], worktree, "npm run compile", toolchain.npmShell);
  }
  if (stages.includes("--launch-smoke")) {
    const upstream = JSON.parse(readFileSync(join(worktree, "package.json"), "utf8"));
    const launcher = process.platform === "win32" ? join("scripts", "code.bat") : join("scripts", "code.sh");
    // Headless Linux runners have no X server; Chromium needs xvfb even to
    // answer --version.
    const command = process.platform === "linux" ? "xvfb-run" : launcher;
    const args = process.platform === "linux" ? ["-a", launcher, "--version"] : ["--version"];
    console.log(`build: runtime launch smoke → ${command} ${args.join(" ")}`);
    // Ubuntu 24.04 restricts unprivileged user namespaces, so the Chromium
    // OS sandbox of the development Electron build cannot initialize on the
    // runner (SIGTRAP/133). This dev-CI flag is about Chromium's own sandbox,
    // never about Saber's policy/sandbox authority in the Rust Core.
    const smokeEnv = process.platform === "linux" ? { ...toolchain.env, ELECTRON_DISABLE_SANDBOX: "1" } : toolchain.env;
    const smoke = spawnSync(command, args, {
      cwd: worktree,
      encoding: "utf8",
      env: smokeEnv,
      shell: process.platform === "win32",
    });
    const output = `${smoke.stdout ?? ""}${smoke.stderr ?? ""}`.trim();
    console.log(output);
    const pinned = lock.source.ref.replace(/^v/, "");
    if (smoke.status !== 0) {
      console.error(`build: launch smoke failed with exit ${smoke.status}`);
      process.exit(1);
    }
    if (!output.includes(pinned) && !output.includes(upstream.version)) {
      console.error(`build: launch smoke did not report the pinned release ${pinned}`);
      process.exit(1);
    }
    console.log("build: launch smoke passed (started, reported the pinned release, exited cleanly)");
  }
  if (stages.includes("--package")) {
    const task = process.env.SABER_DESKTOP_GULP_TASK;
    if (typeof task !== "string" || task.length === 0) {
      console.error("build: --package requires SABER_DESKTOP_GULP_TASK");
      process.exit(64);
    }
    stage(toolchain.env, toolchain.npm, ["run", "gulp", task], worktree, `package ${task}`, toolchain.npmShell);
  }

  if (stages.length === 0) {
    console.log(
      "preflight complete; --install, --compile, --launch-smoke and --package run the real upstream build (their evidence counts only after it actually runs)",
    );
  }
}

main().catch((error) => {
  console.error(`build: ${error.message}`);
  process.exit(1);
});
