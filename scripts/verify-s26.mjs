#!/usr/bin/env node
/**
 * S26 focused verifier — Code-OSS bootstrap contracts.
 *
 * Deterministic, offline, cache-independent: it checks the committed
 * upstream lock, patch series, built-in extension skeleton and gate wiring
 * against strict contracts so a moving ref, missing digest, unreviewed
 * patch, privileged extension path or a Web-Supervisor-as-desktop claim
 * cannot slip onto main. The real fetch/patch/smoke pipeline runs locally
 * and in S26 CI evidence; this verifier never needs the 52 MB archive.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const requiredFiles = [
  "apps/desktop-codeoss/README.md",
  "apps/desktop-codeoss/UPSTREAM-AND-SUPPLY-CHAIN.md",
  "apps/desktop-codeoss/upstream.lock.json",
  "apps/desktop-codeoss/patches/series.json",
  "apps/desktop-codeoss/patches/0001-product-identity.patch",
  "apps/desktop-codeoss/patches/0002-workbench-default-route.patch",
  "apps/desktop-codeoss/scripts/fetch-upstream.mjs",
  "apps/desktop-codeoss/scripts/apply-patches.mjs",
  "apps/desktop-codeoss/scripts/build.mjs",
  "apps/desktop-codeoss/scripts/smoke.mjs",
  "apps/desktop-codeoss/extensions/saber-agent/package.json",
  "apps/desktop-codeoss/extensions/saber-agent/package.nls.json",
  "apps/desktop-codeoss/extensions/saber-agent/package.nls.zh-cn.json",
  "apps/desktop-codeoss/extensions/saber-agent/src/extension.js",
  "apps/desktop-codeoss/extensions/saber-agent/media/saber.svg",
  "scripts/tests/s26-desktop-bootstrap.test.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s26-required-file", file);
}

// Upstream lock contracts.
const lock = JSON.parse(text("apps/desktop-codeoss/upstream.lock.json"));
check(lock.schema_version === 1, "s26-lock-schema", "schema_version 1");
check(/^[0-9a-f]{40}$/.test(lock.source?.commit ?? ""), "s26-lock-commit", "full 40-hex commit");
check(/^[0-9a-f]{64}$/.test(lock.source?.archive_sha256 ?? ""), "s26-lock-digest", "full sha-256");
check(
  (lock.source?.archive_url ?? "").startsWith("https://") &&
    lock.source.archive_url.endsWith(`/tar.gz/${lock.source.commit}`),
  "s26-lock-archive-url",
  "immutable commit-addressed https archive",
);
check(
  ["main", "master", "head"].includes((lock.source?.ref ?? "").toLowerCase()) === false,
  "s26-lock-ref",
  "released tag, not a symbolic ref",
);
check(/^\d+\.\d+\.\d+$/.test(lock.toolchain?.node ?? ""), "s26-lock-toolchain", "exact upstream Node version");
check(lock.source?.license === "MIT", "s26-lock-license", "MIT upstream license recorded");
check((lock.source?.selection_rationale ?? "").length > 80, "s26-lock-rationale", "recorded selection rationale");
for (const exclusion of ["extensions_gallery", "telemetry", "update", "trademark"]) {
  check(typeof lock.exclusions?.[exclusion] === "string", "s26-lock-exclusion", exclusion);
}

// Patch series and patch file contracts.
const series = JSON.parse(text("apps/desktop-codeoss/patches/series.json"));
const lockIds = (lock.patches ?? []).map((patch) => patch.id);
const seriesIds = series.patches?.map((patch) => patch.id) ?? [];
check(
  JSON.stringify(lockIds) === JSON.stringify(seriesIds),
  "s26-series-lock-parity",
  "lock and series list identical patch ids",
);
for (const patch of lock.patches ?? []) {
  check(existsSync(join(root, "apps/desktop-codeoss", patch.file)), "s26-patch-file", patch.file);
  check(patch.expected_base_commit === lock.source.commit, "s26-patch-base", `${patch.id} pins the locked commit`);
  check(
    Array.isArray(patch.upstream_files) && patch.upstream_files.length > 0,
    "s26-patch-files",
    `${patch.id} declares touched files`,
  );
}
const patchText = text("apps/desktop-codeoss/patches/0001-product-identity.patch");
const routePatch = text("apps/desktop-codeoss/patches/0002-workbench-default-route.patch");
check(
  routePatch.includes("--- a/src/vs/workbench/browser/layout.ts") &&
    routePatch.includes("getViewContainerById('saber-workbench')") &&
    routePatch.includes("?? this.viewDescriptorService.getDefaultViewContainer"),
  "s26-route-patch-contract",
  "0002 makes the saber workbench the default sidebar route with an upstream fallback",
);
check(
  patchText.includes("--- a/product.json") && patchText.includes("+++ b/product.json"),
  "s26-patch-format",
  "unified diff with a/ b/ labels",
);
check(patchText.includes('+\t"nameShort": "Saber Studio"'), "s26-patch-branding", "brands nameShort as Saber Studio");
check(
  patchText.includes('-\t"darwinBundleIdentifier": "com.visualstudio.code.oss"'),
  "s26-patch-trademark",
  "removes the Microsoft bundle identifier",
);
check(
  /^\+\t".*" : ".*(Microsoft|Visual Studio|vscode|code-oss).*$/m.test(patchText) === false,
  "s26-patch-no-ms-marks-added",
  "no Microsoft marks introduced",
);
const patchTouchedFiles = [...new Set([...patchText.matchAll(/^[-+]{3} [ab]\/(.+)$/gm)].map((match) => match[1]))];
check(
  patchTouchedFiles.length > 0 && patchTouchedFiles.every((file) => lock.patches[0].upstream_files.includes(file)),
  "s26-patch-touched-declared",
  "patch touches only declared upstream files",
);

// Built-in extension skeleton contracts (low-trust projection only).
const extension = JSON.parse(text("apps/desktop-codeoss/extensions/saber-agent/package.json"));
const extensionText = text("apps/desktop-codeoss/extensions/saber-agent/package.json");
check(
  extension.publisher === "saber" && extension.name === "saber-agent",
  "s26-extension-identity",
  "saber publisher and name",
);
check(extension.engines?.vscode === "^1.135.0", "s26-extension-engine", "engine matches the locked upstream release");
const commands = (extension.contributes?.commands ?? []).map((command) => command.command);
check(
  commands.length >= 2 && commands.every((id) => id.startsWith("saber.")),
  "s26-extension-commands",
  "stable saber.* command ids",
);
check(
  (extension.contributes?.viewsContainers?.activitybar ?? []).some((container) => container.id === "saber-workbench"),
  "s26-extension-container",
  "activity bar workbench container",
);
check(extensionText.includes('"webview"') === false, "s26-extension-no-webview", "no webview in the skeleton");
check((extension.activationEvents ?? []).length === 0, "s26-extension-activation", "no eager activation events");
const extensionSource = text("apps/desktop-codeoss/extensions/saber-agent/src/extension.js");
const requires = [...extensionSource.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
// S28 split the shell into pure sibling modules inside src/; those are
// still extension-host-local — the boundary forbids Node built-ins and
// npm packages, not the extension's own dependency-free projections.
check(
  requires.every((name) => name === "vscode" || name.startsWith("./")),
  "s26-extension-only-vscode-api",
  "extension requires nothing beyond the vscode API and its own src/ modules",
);
check(
  requires
    .filter((name) => name.startsWith("./"))
    .every((name) => existsSync(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name))),
  "s26-extension-only-vscode-api",
  "sibling requires resolve inside the extension src/ directory",
);
check(
  extensionSource.includes("engineering preview") && extensionSource.includes("not connected"),
  "s26-extension-honest-state",
  "honest unconnected copy in code",
);

// Bilingual strings with key parity.
const english = JSON.parse(text("apps/desktop-codeoss/extensions/saber-agent/package.nls.json"));
const chinese = JSON.parse(text("apps/desktop-codeoss/extensions/saber-agent/package.nls.zh-cn.json"));
check(
  JSON.stringify(Object.keys(english).sort()) === JSON.stringify(Object.keys(chinese).sort()),
  "s26-nls-parity",
  "en/zh string keys identical",
);
const referencedKeys = [...extensionText.matchAll(/%([A-Za-z0-9_.-]+)%/g)].map((match) => match[1]);
check(
  referencedKeys.length > 0 && referencedKeys.every((key) => key in english),
  "s26-nls-coverage",
  "every %key% resolves in package.nls.json",
);

// Honest status and Web-supervisor boundary.
const readme = text("apps/desktop-codeoss/README.md");
check(
  readme.includes("the desktop plan (S00-S38) is complete") &&
    readme.includes("remain hosted release-pipeline evidence") &&
    readme.includes("bounded launch smoke"),
  "s26-honest-status",
  "darwin dev-launch truth recorded; packaged three-platform claim still withheld",
);
check(readme.includes("engineering preview"), "s26-honest-preview", "RT-0 engineering preview language");
check(
  readme.includes("not an implementation substitute"),
  "s26-web-supervisor-secondary",
  "Web supervisor stays secondary",
);
const supplyChain = text("apps/desktop-codeoss/UPSTREAM-AND-SUPPLY-CHAIN.md");
check(
  supplyChain.includes("TBD-BY-SEGMENT"),
  "s26-tbd-explicit",
  "signing/update/legal unknowns are explicit blockers",
);
check(
  supplyChain.includes("08d4889f9ec4a1685d257b9b95de036c8e1ce1e5"),
  "s26-supply-chain-commit",
  "record names the pinned commit",
);

// Ignored cache + gate wiring.
const gitignore = text(".gitignore");
check(gitignore.includes("apps/desktop-codeoss/.cache/"), "s26-cache-ignored", "cache directory is gitignored");
const packageJson = text("package.json");
check(packageJson.includes("desktop:upstream:fetch"), "s26-wiring-scripts", "desktop scripts wired");
check(packageJson.includes("verify-s26.mjs"), "s26-wiring-verify", "verify-s26 chained into the repository gate");
check(existsSync(join(root, "scripts/dev-desktop.mjs")), "s26-wiring-dev", "one-command dev entry point exists");
check(packageJson.includes("desktop:dev"), "s26-wiring-dev-script", "pnpm desktop:dev wired");
const workflow = text(".github/workflows/repository-verification.yml");
check(
  workflow.includes("node scripts/verify-s26.mjs"),
  "s26-wiring-hosted",
  "hosted repository verification runs verify-s26",
);

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S26 verification passed with ${passes.length} checks.`);
