#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * S26-WP03 — prepare the patched upstream worktree.
 *
 * Extracts the digest-verified archive into an ignored worktree, applies the
 * Saber patch series in order (git apply: any fuzz or conflict fails the
 * run), proves every patch is reversible, and copies the built-in extension
 * skeletons into the tree. A failed run removes the worktree so the next
 * attempt starts from the pristine archive — the cache is never hand-edited
 * to make a patch fit.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureUpstream, loadLock } from "./fetch-upstream.mjs";

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.status}):\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result;
}

/** Extract the verified archive into cache/worktrees/<commit>. */
export async function extractWorktree(lock, { desktopRoot = DESKTOP_ROOT } = {}) {
  const upstream = await ensureUpstream(lock);
  const worktrees = join(desktopRoot, ".cache", "worktrees");
  const worktree = join(worktrees, lock.source.commit);
  if (existsSync(worktree)) {
    return { worktree, mode: "existing" };
  }
  const staging = `${worktree}.staging-${process.pid}`;
  rmSync(staging, { force: true, recursive: true });
  mkdirSync(staging, { recursive: true });
  try {
    run("tar", ["-xzf", upstream.path, "-C", staging]);
    const extracted = join(staging, `vscode-${lock.source.commit}`);
    if (!existsSync(extracted)) {
      throw new Error("archive layout changed: expected vscode-<commit> root directory");
    }
    mkdirSync(worktrees, { recursive: true });
    renameSync(extracted, worktree);
  } catch (error) {
    rmSync(staging, { force: true, recursive: true });
    rmSync(worktree, { force: true, recursive: true });
    throw error;
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
  return { worktree, mode: "extracted" };
}

/**
 * Apply the ordered patch series with strict checks, idempotently: a patch
 * that is already applied (reverse check passes) is skipped so repeated
 * preparations of one worktree are safe. Throws on the first failure; the
 * caller decides whether to discard the worktree.
 */
export function applyPatchSeries(worktree, series, { patchesDir }) {
  const applied = [];
  for (const entry of series.patches) {
    const patchPath = resolve(patchesDir, entry.file);
    if (!existsSync(patchPath)) {
      throw new Error(`series lists ${entry.id} but ${patchPath} is missing`);
    }
    const reverse = spawnSync("git", ["apply", "--check", "--reverse", patchPath], {
      cwd: worktree,
      encoding: "utf8",
    });
    if (reverse.status === 0) {
      continue;
    }
    run("git", ["apply", "--check", patchPath], { cwd: worktree });
    run("git", ["apply", patchPath], { cwd: worktree });
    run("git", ["apply", "--check", "--reverse", patchPath], { cwd: worktree });
    applied.push(entry.id);
  }
  return applied;
}

/** Copy built-in extension skeletons into the upstream extensions tree. */
export function copyBuiltinExtensions(worktree, series, { desktopRoot = DESKTOP_ROOT } = {}) {
  for (const relative of series.builtin_extensions ?? []) {
    const source = join(desktopRoot, relative);
    const target = join(worktree, "extensions", relative.split("/").pop());
    if (!existsSync(join(source, "package.json"))) {
      throw new Error(`built-in extension ${relative} has no package.json`);
    }
    cpSync(source, target, { recursive: true });
  }
}

async function main() {
  const lock = loadLock();
  const series = JSON.parse(readFileSync(join(DESKTOP_ROOT, "patches", "series.json"), "utf8"));
  const lockIds = (lock.patches ?? []).map((patch) => patch.id);
  const seriesIds = series.patches.map((patch) => patch.id);
  if (JSON.stringify(lockIds) !== JSON.stringify(seriesIds)) {
    throw new Error(`upstream.lock.json patches [${lockIds}] and patches/series.json [${seriesIds}] disagree`);
  }
  const { worktree, mode } = await extractWorktree(lock);
  try {
    const applied = applyPatchSeries(worktree, series, { patchesDir: join(DESKTOP_ROOT, "patches") });
    copyBuiltinExtensions(worktree, series);
    console.log(`worktree ${mode}: ${worktree}`);
    for (const entry of series.patches) {
      console.log(`applied+reversible ${entry.id}${applied.includes(entry.id) ? "" : " (already applied)"}`);
    }
    for (const extension of series.builtin_extensions ?? []) {
      console.log(`built-in extension copied ${extension}`);
    }
  } catch (error) {
    rmSync(worktree, { force: true, recursive: true });
    throw new Error(`${error.message}\nworktree discarded; the cache stays pristine`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(`apply-patches: ${error.message}`);
    process.exit(1);
  });
}
