#!/usr/bin/env node
/**
 * S26-WP06 — deterministic smoke over the patched upstream worktree.
 *
 * This is the static half of the S26 smoke journey: it proves branding,
 * data-directory isolation, built-in extension presence, honest
 * unconnected states and Microsoft-service exclusion from the patched
 * product identity — without launching anything and without network.
 * The runtime launch smoke on each packaged platform is the remaining
 * S26-WP06 evidence and is not claimed here.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatchSeries, copyBuiltinExtensions, extractWorktree } from "./apply-patches.mjs";
import { loadLock } from "./fetch-upstream.mjs";

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];
const check = (condition, name) => {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}`);
  if (!condition) failures.push(name);
};

async function main() {
  const lock = loadLock();
  const series = JSON.parse(readFileSync(join(DESKTOP_ROOT, "patches", "series.json"), "utf8"));
  const { worktree } = await extractWorktree(lock);
  applyPatchSeries(worktree, series, { patchesDir: join(DESKTOP_ROOT, "patches") });
  copyBuiltinExtensions(worktree, series);

  const product = JSON.parse(readFileSync(join(worktree, "product.json"), "utf8"));
  check(product.nameShort === "Saber Studio", "product.nameShort is Saber Studio");
  check(product.nameLong === "Saber Studio", "product.nameLong is Saber Studio");
  check(product.applicationName === "saber-studio", "product.applicationName is saber-studio");
  check(product.dataFolderName === ".saber-studio", "user data directory is Saber-owned");
  check(product.urlProtocol === "saber", "url protocol is saber");
  check(product.win32DirName === "Saber Studio", "win32 directory name has no Microsoft mark");
  check(product.win32AppUserModelId === "Studio.Saber", "app user model id has no Microsoft mark");
  check(product.darwinBundleIdentifier === "studio.saber.dev", "darwin bundle identifier is Saber-owned");
  check(product.extensionsGallery === undefined, "no Microsoft extension gallery endpoint");

  const extension = JSON.parse(readFileSync(join(worktree, "extensions", "saber-agent", "package.json"), "utf8"));
  const commands = extension.contributes.commands.map((command) => command.command);
  check(commands.length > 0 && commands.every((id) => id.startsWith("saber.")), "built-in commands use saber.* ids");
  check(extension.contributes.viewsContainers.activitybar.length === 1, "activity bar container contributed");
  check(
    !JSON.stringify(extension).includes('"webview"'),
    "skeleton contributes no webview (native contributions first)",
  );
  check(existsSync(join(worktree, "extensions", "saber-agent", "package.nls.zh-cn.json")), "zh-CN strings shipped");

  const english = readFileSync(join(worktree, "extensions", "saber-agent", "package.nls.json"), "utf8");
  check(
    english.includes("engineering preview") && english.includes("not connected"),
    "welcome copy states the honest unconnected preview",
  );

  if (failures.length > 0) {
    console.error(`smoke failed with ${failures.length} failing checks`);
    process.exit(1);
  }
  console.log("static smoke passed; runtime platform launch smoke remains S26-WP06 evidence");
}

main().catch((error) => {
  console.error(`smoke: ${error.message}`);
  process.exit(1);
});
