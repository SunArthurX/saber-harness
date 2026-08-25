import assert from "node:assert/strict";
import { delimiter, join } from "node:path";
import test from "node:test";

import { environmentForNode, nodeExecutableCandidates, resolvePinnedNode } from "../lib/toolchain.mjs";

test("candidate discovery includes PATH and common version-manager locations without duplicates", () => {
  const candidates = nodeExecutableCandidates("24.15.0", {
    env: {
      PATH: ["/system/bin", "/managed/bin", "/system/bin"].join(delimiter),
      NVM_DIR: "/nvm",
    },
    home: "/home/developer",
    platform: "linux",
    execPath: "/system/bin/node",
  });

  assert.equal(candidates.filter((candidate) => candidate === "/system/bin/node").length, 1);
  assert.ok(candidates.includes("/managed/bin/node"));
  assert.ok(candidates.includes("/nvm/versions/node/v24.15.0/bin/node"));
  assert.ok(candidates.includes("/home/developer/.volta/bin/node"));
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
