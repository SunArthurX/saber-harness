import assert from "node:assert/strict";
import { delimiter, join } from "node:path";
import test from "node:test";

import { environmentForNode, nodeExecutableCandidates, resolvePinnedNode } from "../lib/toolchain.mjs";

test("candidate discovery includes PATH and common version-manager locations without duplicates", () => {
  const systemBin = join("fixture", "system", "bin");
  const managedBin = join("fixture", "managed", "bin");
  const nvmRoot = join("fixture", "nvm");
  const home = join("fixture", "home", "developer");
  const candidates = nodeExecutableCandidates("24.15.0", {
    env: {
      PATH: [systemBin, managedBin, systemBin].join(delimiter),
      NVM_DIR: nvmRoot,
    },
    home,
    platform: "linux",
    execPath: join(systemBin, "node"),
  });

  assert.equal(candidates.filter((candidate) => candidate === join(systemBin, "node")).length, 1);
  assert.ok(candidates.includes(join(managedBin, "node")));
  assert.ok(candidates.includes(join(nvmRoot, "versions", "node", "v24.15.0", "bin", "node")));
  assert.ok(candidates.includes(join(home, ".volta", "bin", "node")));
});

test("resolver accepts only an executable reporting the exact pinned version", () => {
  const versions = new Map([
    ["/current/node", "25.9.0"],
    ["/pinned/node", "24.15.0"],
  ]);
  assert.equal(
    resolvePinnedNode("24.15.0", {
      candidates: ["/missing/node", "/current/node", "/pinned/node"],
      exists: (candidate) => versions.has(candidate),
      readVersion: (candidate) => versions.get(candidate),
    }),
    "/pinned/node",
  );
});

test("selected runtime directory is prepended to PATH", () => {
  const environment = environmentForNode(join("", "managed", "node"), { PATH: "/system/bin", SAFE: "yes" });
  assert.equal(environment.PATH, [join("", "managed"), "/system/bin"].join(delimiter));
  assert.equal(environment.SAFE, "yes");
});
