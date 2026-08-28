import assert from "node:assert/strict";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyPatchSeries, copyBuiltinExtensions } from "../../apps/desktop-codeoss/scripts/apply-patches.mjs";
import {
  archivePath,
  ensureUpstream,
  loadLock,
  sha256File,
  validateLock,
} from "../../apps/desktop-codeoss/scripts/fetch-upstream.mjs";

function validLock() {
  return JSON.parse(JSON.stringify(loadLock()));
}

function fixtureDir(name) {
  const dir = join(tmpdir(), `s26-${name}-${process.pid}`);
  rmSync(dir, { force: true, recursive: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("validateLock refuses symbolic refs, short shas and non-commit archive urls", () => {
  const base = validLock();
  const symbolicRef = { ...base, source: { ...base.source, ref: "main" } };
  assert.equal(validateLock(symbolicRef).ok, false);
  assert.ok(
    validateLock(symbolicRef).errors.some((error) => error.includes("symbolic")),
    "symbolic ref must be called out",
  );

  const shortSha = { ...base, source: { ...base.source, commit: "08d4889" } };
  assert.equal(validateLock(shortSha).ok, false);
  assert.ok(validateLock(shortSha).errors.some((error) => error.includes("40-hex")));

  const refAddress = {
    ...base,
    source: { ...base.source, archive_url: "https://codeload.github.com/microsoft/vscode/tar.gz/main" },
  };
  assert.equal(validateLock(refAddress).ok, false);

  const http = {
    ...base,
    source: {
      ...base.source,
      archive_url: "http://codeload.github.com/microsoft/vscode/tar.gz/08d4889f9ec4a1685d257b9b95de036c8e1ce1e5",
    },
  };
  assert.equal(validateLock(http).ok, false);

  const missingDigest = { ...base, source: { ...base.source, archive_sha256: "deadbeef" } };
  assert.equal(validateLock(missingDigest).ok, false);

  const patchBaseDrift = {
    ...base,
    patches: base.patches.map((patch) => ({ ...patch, expected_base_commit: "0".repeat(40) })),
  };
  assert.equal(validateLock(patchBaseDrift).ok, false);

  assert.equal(validateLock(base).ok, true, "the committed lock must validate");
});

test("ensureUpstream offline fails closed on a missing cache and verifies a digest-matching one", async () => {
  const dir = fixtureDir("offline");
  const lock = validLock();
  await assert.rejects(
    ensureUpstream(lock, { cacheRoot: dir, offline: true }),
    /offline mode/,
    "absent cache must fail with an explicit offline error",
  );

  const target = archivePath(lock, dir);
  mkdirSync(join(target, ".."), { recursive: true });
  const content = Buffer.from("s26 fixture archive");
  writeFileSync(target, content);
  const digest = await sha256File(target);
  const matching = { ...lock, source: { ...lock.source, archive_sha256: digest } };
  const result = await ensureUpstream(matching, { cacheRoot: dir, offline: true });
  assert.equal(result.mode, "offline-verified");

  const tampered = { ...lock, source: { ...lock.source, archive_sha256: "0".repeat(64) } };
  await assert.rejects(
    ensureUpstream(tampered, { cacheRoot: dir, offline: true }),
    /digest mismatch/,
    "a corrupt cache entry must be rejected, not silently refetched",
  );
  rmSync(dir, { force: true, recursive: true });
});

test("ensureUpstream never promotes a digest-mismatched download", async () => {
  const dir = fixtureDir("mismatch");
  const lock = validLock();
  // Valid-shaped but unreachable: port 1 refuses instantly; the URL still
  // ends with /tar.gz/<commit> so lock validation passes and the failure
  // happens in the download/verify layer, never at promotion.
  lock.source.archive_url = `https://127.0.0.1:1/microsoft/vscode/tar.gz/${lock.source.commit}`;
  lock.source.archive_sha256 = "1".repeat(64);
  await assert.rejects(ensureUpstream(lock, { cacheRoot: dir }), /download failed|digest/);
  const target = archivePath(lock, dir);
  assert.equal(existsSync(target), false, "no promoted artifact after failure");
  assert.deepEqual(
    existsSync(join(dir, "upstream")) ? readdirSync(join(dir, "upstream")) : [],
    [],
    "no temporary residue after failure",
  );
  rmSync(dir, { force: true, recursive: true });
});

test("applyPatchSeries fails on a patch that does not apply and reports the patch id", async () => {
  const dir = fixtureDir("conflict");
  const worktree = join(dir, "worktree");
  mkdirSync(join(worktree, "nested"), { recursive: true });
  writeFileSync(join(worktree, "product.json"), '{\n  "nameShort": "Something Else"\n}\n');
  const patchPath = join(dir, "broken.patch");
  writeFileSync(
    patchPath,
    [
      "--- a/product.json",
      "+++ b/product.json",
      "@@ -1,2 +1,2 @@",
      '-  "nameShort": "Code - OSS"',
      '+  "nameShort": "Saber Studio"',
      "",
    ].join("\n"),
  );
  const series = { patches: [{ id: "9999-broken", file: "broken.patch" }], builtin_extensions: [] };
  assert.throws(
    () => applyPatchSeries(worktree, series, { patchesDir: dir }),
    /9999-broken|failed/,
    "a conflicting patch must fail the series",
  );
  rmSync(dir, { force: true, recursive: true });
});

test("applyPatchSeries is idempotent and copyBuiltinExtensions requires a manifest", async () => {
  const dir = fixtureDir("idempotent");
  const worktree = join(dir, "worktree");
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, "product.json"), '{\n  "nameShort": "Code - OSS"\n}\n');
  const patchPath = join(dir, "ok.patch");
  writeFileSync(
    patchPath,
    [
      "--- a/product.json",
      "+++ b/product.json",
      "@@ -1,3 +1,3 @@",
      " {",
      '-  "nameShort": "Code - OSS"',
      '+  "nameShort": "Saber Studio"',
      " }",
      "",
    ].join("\n"),
  );
  const series = { patches: [{ id: "0001-fixture", file: "ok.patch" }], builtin_extensions: [] };
  applyPatchSeries(worktree, series, { patchesDir: dir });
  const secondPass = applyPatchSeries(worktree, series, { patchesDir: dir });
  assert.deepEqual(secondPass, [], "second pass applies nothing");

  const extensionSource = join(dir, "extensions", "saber-agent");
  mkdirSync(extensionSource, { recursive: true });
  closeSync(openSync(join(extensionSource, "README.md"), "w"));
  assert.throws(
    () => copyBuiltinExtensions(worktree, { builtin_extensions: ["extensions/saber-agent"] }, { desktopRoot: dir }),
    /no package\.json/,
    "a built-in extension without a manifest must fail",
  );
  rmSync(dir, { force: true, recursive: true });
});

test("the committed lock, series and extension satisfy the S26 contracts", async () => {
  const lock = validLock();
  assert.equal(validateLock(lock).ok, true);
  const series = JSON.parse(await readFile(join(process.cwd(), "apps/desktop-codeoss/patches/series.json"), "utf8"));
  assert.deepEqual(
    lock.patches.map((patch) => patch.id),
    series.patches.map((patch) => patch.id),
  );
  const extension = JSON.parse(
    await readFile(join(process.cwd(), "apps/desktop-codeoss/extensions/saber-agent/package.json"), "utf8"),
  );
  for (const command of extension.contributes.commands) {
    assert.ok(command.command.startsWith("saber."), `${command.command} must use the saber namespace`);
  }
  assert.equal(JSON.stringify(extension).includes('"webview"'), false);
});
