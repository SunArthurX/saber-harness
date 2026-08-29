#!/usr/bin/env node
/**
 * S38 dev entry point — one reproducible command that takes the Saber
 * Studio desktop from a clean checkout to a launched dev session:
 *
 *   pnpm desktop:dev [-- <code.sh args and workspace paths>]
 *
 * Stages (each skipped when its artifact already exists):
 *   1. toolchain + worktree preflight (build.mjs; fails closed when
 *      SABER_DESKTOP_NODE does not resolve to the pinned Node)
 *   2. npm install inside the patched worktree
 *   3. upstream compile
 *   4. Electron binary fetch (local cache honored; checksum-gated)
 *   5. interactive launch of scripts/code.sh with the given args
 *
 * Everything heavy is delegated to the existing governed stages; this
 * script only sequences them and never weakens a boundary.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildScript = join(root, "apps/desktop-codeoss/scripts/build.mjs");
const argsSeparator = process.argv.indexOf("--");
const passthrough = argsSeparator === -1 ? [] : process.argv.slice(argsSeparator + 1);

function stage(label, command, args, { cwd = root, timeoutMs } = {}) {
  console.log(`dev: ${label} → ${command} ${args.join(" ")}${cwd === root ? "" : ` (in ${cwd})`}`);
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  return new Promise((resolveStage, rejectStage) => {
    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          rejectStage(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs)
      : null;
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      rejectStage(error);
    });
    child.on("exit", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolveStage();
      } else {
        rejectStage(new Error(`${label} failed with exit ${code ?? signal}`));
      }
    });
  });
}

async function main() {
  // 1. preflight resolves the toolchain and materializes the worktree.
  await stage("preflight", process.execPath, [buildScript]);

  const lock = JSON.parse(readFileSync(join(root, "apps/desktop-codeoss/upstream.lock.json"), "utf8"));
  const worktree = join(root, "apps/desktop-codeoss/.cache/worktrees", lock.source.commit);

  // 2-3. install and compile only when their artifacts are missing.
  if (!existsSync(join(worktree, "node_modules"))) {
    await stage("install", process.execPath, [buildScript, "--install"], { timeoutMs: 30 * 60_000 });
  }
  if (!existsSync(join(worktree, "out"))) {
    await stage("compile", process.execPath, [buildScript, "--compile"], { timeoutMs: 60 * 60_000 });
  }

  // 4. the Electron binary (honors the @electron/get cache; the
  //    extraction dir is the upstream convention). The upstream
  //    fetcher must run from the worktree root.
  if (!existsSync(join(worktree, ".build/electron/Saber Studio.app/Contents/MacOS"))) {
    await stage("fetch electron", process.execPath, ["build/lib/electron.ts"], {
      cwd: worktree,
      timeoutMs: 20 * 60_000,
    });
  }

  // 5. interactive launch; stdio inherits so the dev session is a
  //    real foreground process the operator controls.
  const launcher = join("scripts", process.platform === "win32" ? "code.bat" : "code.sh");
  console.log(`dev: launching → ${launcher} ${passthrough.join(" ")}`);
  const env = { ...process.env, VSCODE_SKIP_PRELAUNCH: "1" };
  const child = spawn(launcher, passthrough, { cwd: worktree, env, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

main().catch((error) => {
  console.error(`dev: ${error.message}`);
  process.exit(1);
});
