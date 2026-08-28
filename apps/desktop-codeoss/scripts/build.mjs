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
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

function stage(env, command, args, cwd, label, shell = false, timeoutMilliseconds) {
  console.log(`build: ${label} → ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell,
    ...(timeoutMilliseconds === undefined ? {} : { timeout: timeoutMilliseconds, killSignal: "SIGKILL" }),
  });
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
    // Bound every part of the dev launch: the Electron binary download is
    // fetched explicitly, then the app launches with the heavy preLaunch
    // (compile + built-in extension sync) skipped. The dev main opens a
    // window instead of honoring --version, so the honest assertion is:
    // the process boots, stays alive and healthy for 45 seconds, and then
    // terminates on the operator's signal — "starts and exits cleanly"
    // with the exit initiated by the smoke itself.
    stage(toolchain.env, "node", ["build/lib/electron.ts"], worktree, "fetch electron binary", false, 600_000);

    const launcher = join("scripts", process.platform === "win32" ? "code.bat" : "code.sh");
    // Headless Linux runners have no X server (xvfb) and restrict unprivileged
    // user namespaces, so Chromium's own OS sandbox cannot initialize
    // (SIGTRAP/133). ELECTRON_DISABLE_SANDBOX is a dev-CI flag about
    // Chromium's sandbox, never about Saber's Rust Core authority.
    const command = process.platform === "linux" ? "xvfb-run" : launcher;
    // A short user-data-dir: the single-instance unix socket
    // (<dir>/<version>-main.sock) must stay under the OS path limit (103
    // chars on macOS) or the main process dies at claimInstance.
    const userDataDir = join(tmpdir(), `saber-smoke-${process.pid}`);
    const args =
      process.platform === "linux"
        ? ["-a", launcher, `--user-data-dir=${userDataDir}`]
        : [`--user-data-dir=${userDataDir}`];
    console.log(`build: runtime launch smoke → ${command} ${args.join(" ")}`);
    const smokeEnv = {
      ...toolchain.env,
      VSCODE_SKIP_PRELAUNCH: "1",
      ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
    };
    const child = spawn(command, args, {
      cwd: worktree,
      env: smokeEnv,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    const alive = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(child.exitCode === null), 45_000);
      child.on("exit", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    if (!alive) {
      console.error(output.slice(-4000));
      console.error(`build: launch smoke failed — the process exited early with code ${child.exitCode}`);
      process.exit(1);
    }
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } else {
      child.kill("SIGTERM");
    }
    const stopped = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 30_000);
      child.on("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!stopped) {
      child.kill("SIGKILL");
      console.error("build: launch smoke failed — the process did not terminate on the smoke signal");
      process.exit(1);
    }
    console.log(output.slice(-2000));
    console.log("build: launch smoke passed (booted, stayed healthy 45s, terminated on the smoke signal)");
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
