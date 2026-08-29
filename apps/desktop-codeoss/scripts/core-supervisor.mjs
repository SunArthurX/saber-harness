#!/usr/bin/env node
/**
 * S27-WP01 — desktop-side Core lifecycle supervisor.
 *
 * This runs in the desktop main process (Node side), never in a renderer:
 * it spawns `saber-core serve`, captures the one-time bootstrap token from
 * the piped stdout channel, monitors the child, restarts it with bounded
 * backoff, and shuts it down with a deadline followed by a force kill and
 * orphan reaping. It exposes the token to the shell only through the
 * resolved promise return value — never argv, environment or logs. No
 * effect authority exists here.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Default supervision policy knobs. */
export const SUPERVISOR_DEFAULTS = Object.freeze({
  /** Grace period after SIGTERM before SIGKILL. */
  shutdownGraceMs: 4_000,
  /** Restart backoff schedule after an unexpected exit. */
  restartBackoffMs: [250, 1_000, 4_000],
  /** Giving up after this many consecutive unexpected exits. */
  maxRestarts: 3,
  /** Upper bound waiting for the bootstrap token on stdout. */
  tokenTimeoutMs: 15_000,
});

/** Resolve the core binary exactly like the CLI resolver, debug first.
 * A stale release build predates subcommands (this exact trap broke the
 * S27 supervisor tests), so the freshest gate-built debug binary wins. */
export function resolveCoreBinary() {
  if (process.env.SABER_CORE_BIN && existsSync(process.env.SABER_CORE_BIN)) {
    return process.env.SABER_CORE_BIN;
  }
  const names = process.platform === "win32" ? ["saber-core.exe", "saber-core"] : ["saber-core"];
  for (const profile of ["debug", "release"]) {
    for (const name of names) {
      const candidate = join(DESKTOP_ROOT, "..", "..", "target", profile, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Supervise one Core serve process. Resolves once the endpoint is serving
 * and the one-time token has been captured; the caller keeps the handle
 * for health checks and shutdown.
 */
export function superviseCore({ core, coreArgs, store, workspace, policy = {} }) {
  const settings = { ...SUPERVISOR_DEFAULTS, ...policy };
  const serveArgs = coreArgs ?? ["serve", "--store", store, "--workspace", workspace];
  const state = {
    status: "starting_core",
    restarts: 0,
    token: null,
    lastExit: null,
  };
  let child = null;
  let stopped = false;
  let stopSettled = null;
  const waiters = [];

  const setState = (status) => {
    state.status = status;
  };

  const spawnOnce = () => {
    // A new Core process mints a fresh one-time token; clear the old one
    // so the stdout capture below latches the new bootstrap line.
    state.token = null;
    // The ONLY channel the token travels is the piped stdout below.
    child = spawn(core, serveArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    setState("starting_core");
    let output = "";
    const tokenTimer = setTimeout(() => {
      if (state.token === null) {
        giveUp("token_timeout");
      }
    }, settings.tokenTimeoutMs);
    child.stdout.on("data", (chunk) => {
      if (state.token !== null) return;
      output += chunk.toString("utf8");
      const match = /bootstrap-token ([0-9a-f]{64})/.exec(output);
      if (match) {
        clearTimeout(tokenTimer);
        state.token = match[1];
        setState("ready");
        for (const waiter of waiters.splice(0)) {
          waiter.resolve(state.token);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      const line = chunk.toString("utf8").trim();
      if (line.length > 0 && !line.includes("token")) {
        process.stderr.write(`[saber-core] ${line}\n`);
      }
    });
    child.on("exit", (code, signal) => {
      clearTimeout(tokenTimer);
      state.lastExit = { code, signal };
      if (stopped) {
        setState("stopped");
        return;
      }
      setState("reconnecting");
      if (state.restarts >= settings.maxRestarts) {
        giveUp("retries_exhausted");
        return;
      }
      const backoff = settings.restartBackoffMs[Math.min(state.restarts, settings.restartBackoffMs.length - 1)];
      state.restarts += 1;
      setTimeout(() => {
        if (!stopped) {
          spawnOnce();
        }
      }, backoff);
    });
  };

  const giveUp = (reason) => {
    if (child !== null) {
      child.kill("SIGKILL");
    }
    setState("degraded");
    for (const waiter of waiters.splice(0)) {
      waiter.reject(new Error(`core_supervisor_degraded:${reason}`));
    }
  };

  spawnOnce();

  return {
    state,
    /** Resolves with the one-time bootstrap token once the Core is ready. */
    token() {
      if (state.token !== null) {
        return Promise.resolve(state.token);
      }
      return new Promise((resolveToken, reject) => {
        waiters.push({ resolve: resolveToken, reject });
      });
    },
    /** Deliver a signal to the live child (crash injection / stop paths). */
    signal(name = "SIGKILL") {
      if (child !== null && child.exitCode === null) {
        child.kill(name);
        return true;
      }
      return false;
    },
    /** Graceful stop: SIGTERM, wait the grace deadline, then force kill.
     * Idempotent and never hangs: the first call's outcome is memoized. */
    stop() {
      if (stopSettled !== null) {
        return stopSettled;
      }
      stopSettled = (async () => {
        stopped = true;
        if (child === null || child.exitCode !== null) {
          setState("stopped");
          return { forced: false };
        }
        setState("stopping");
        const exited = new Promise((resolveStop) => {
          child.once("exit", () => resolveStop(true));
        });
        child.kill("SIGTERM");
        const graceful = await Promise.race([
          exited.then(() => true),
          new Promise((resolveStop) => setTimeout(() => resolveStop(false), settings.shutdownGraceMs)),
        ]);
        if (!graceful) {
          child.kill("SIGKILL");
          await exited.catch(() => {});
        }
        // Release the pipes so a stopped supervisor never pins the event
        // loop of the desktop main process (or a test runner).
        child.stdout?.destroy();
        child.stderr?.destroy();
        setState("stopped");
        return { forced: !graceful };
      })();
      stopSettled.catch(() => {});
      return stopSettled;
    },
  };
}
