#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runtimeIdentity } from "@saber/agent-runtime";

/** Creates the deterministic CLI skeleton banner. */
export function createBanner(): string {
  return `saber-cli using ${runtimeIdentity()}`;
}

/** Usage line for the shell around the trusted Rust core. */
export function createUsage(): string {
  return "usage: saber run <args...> | saber ui [--port N] [--store DIR] | saber banner";
}

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/**
 * Resolve the trusted core binary: an explicit override first, then the
 * release build, then the debug build left by the workspace test gate.
 * Returns null when no core build exists yet.
 */
export function resolveCoreBinary(): string | null {
  const override = process.env.SABER_CORE_BIN;
  if (override !== undefined && override.length > 0) {
    return override;
  }
  const binaryNames = process.platform === "win32" ? ["saber-core.exe", "saber-core"] : ["saber-core"];
  for (const profile of ["release", "debug"]) {
    for (const binaryName of binaryNames) {
      const path = resolve(repositoryRoot(), "target", profile, binaryName);
      if (existsSync(path)) {
        return path;
      }
    }
  }
  return null;
}

function run(args: string[]): number {
  const core = resolveCoreBinary();
  if (core === null) {
    console.error("saber: trusted core binary not found");
    console.error("build it with `cargo build -p saber-core` or set SABER_CORE_BIN");
    return 64;
  }
  const result = spawnSync(core, ["run", ...args], { stdio: "inherit" });
  if (result.error !== undefined) {
    console.error(`saber: failed to start the trusted core: ${String(result.error)}`);
    return 64;
  }
  return result.status ?? 1;
}

function main(): number | null {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(createBanner());
    console.log(createUsage());
    return 0;
  }
  switch (args[0]) {
    case "run":
      return run(args.slice(1));
    case "banner":
      console.log(createBanner());
      return 0;
    case "ui": {
      // Stay alive: the HTTP server owns the event loop from here.
      void ui(args.slice(1));
      return null;
    }
    default:
      console.error(`saber: unknown command ${args[0]}`);
      console.error(createUsage());
      return 64;
  }
}

/** Start the local web console; resolves only on shutdown. */
async function ui(args: string[]): Promise<void> {
  const { startUiServer } = await import("./ui.js");
  let port = 0;
  let store: string | null = null;
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1] ?? "";
    if (args[index] === "--port" && value.length > 0) {
      port = Number.parseInt(value, 10);
    }
    if (args[index] === "--store" && value.length > 0) {
      store = value;
    }
  }
  const core = resolveCoreBinary();
  if (core === null) {
    console.error("saber: trusted core binary not found");
    console.error("build it with `cargo build -p saber-core` or set SABER_CORE_BIN");
    process.exitCode = 64;
    return;
  }
  const handle = await startUiServer(store === null ? { core, port } : { core, port, store });
  console.log(`saber console: http://127.0.0.1:${handle.port}`);
  console.log(`audit store: ${handle.store}`);
  console.log("press Ctrl-C to stop");
  process.on("SIGINT", () => {
    handle.server.close(() => process.exit(0));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = main();
  if (exitCode !== null) {
    process.exit(exitCode);
  }
}
