import assert from "node:assert/strict";
import test from "node:test";

import { executableName } from "../lib/executable.mjs";

test("Windows package-manager shims use cmd entrypoints", () => {
  assert.equal(executableName("pnpm", "win32"), "pnpm.cmd");
  assert.equal(executableName("corepack", "win32"), "corepack.cmd");
});

test("native executables and POSIX commands remain unchanged", () => {
  assert.equal(executableName("cargo", "win32"), "cargo");
  assert.equal(executableName("pnpm", "darwin"), "pnpm");
  assert.equal(executableName("pnpm", "linux"), "pnpm");
});
