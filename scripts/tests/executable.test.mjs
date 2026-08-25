import assert from "node:assert/strict";
import test from "node:test";

import { commandSpec } from "../lib/executable.mjs";

test("Windows package-manager shims use a constrained command interpreter", () => {
  assert.deepEqual(commandSpec("pnpm", ["--version"], { platform: "win32", comspec: "cmd.exe" }), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "pnpm --version"],
  });
  assert.throws(() => commandSpec("pnpm", ["--version&whoami"], { platform: "win32" }), /unsafe argument/);
});

test("native executables and POSIX commands remain unchanged", () => {
  assert.deepEqual(commandSpec("cargo", ["--version"], { platform: "win32" }), {
    command: "cargo",
    args: ["--version"],
  });
  assert.deepEqual(commandSpec("pnpm", ["--version"], { platform: "linux" }), {
    command: "pnpm",
    args: ["--version"],
  });
});
