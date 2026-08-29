#!/usr/bin/env node
/**
 * S26-WP06 + S28 — deterministic smoke over the patched upstream worktree.
 *
 * This is the static half of the smoke journey: it proves branding,
 * data-directory isolation, built-in extension presence, honest
 * unconnected states, Microsoft-service exclusion from the patched
 * product identity and (S28) the workbench shell contribution surface —
 * without launching anything and without network. `--workspace <path>`
 * additionally validates a real workspace fixture the workbench must
 * open into the default layout. The runtime launch smoke on each
 * packaged platform is the remaining S26-WP06 evidence and is not
 * claimed here.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatchSeries, copyBuiltinExtensions, extractWorktree } from "./apply-patches.mjs";
import { loadLock } from "./fetch-upstream.mjs";

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceArg = process.argv.indexOf("--workspace");
const WORKSPACE = workspaceArg === -1 ? null : process.argv[workspaceArg + 1];

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

  // S28 — workbench shell contribution surface (static startup assertions).
  const activityViews = extension.contributes.views["saber-workbench"].map((view) => view.id);
  check(
    JSON.stringify(activityViews) ===
      JSON.stringify(["saber.projects", "saber.goals", "saber.tasks", "saber.conversations", "saber.runs"]),
    "S28 five navigation views contribute to the default workbench container",
  );
  check(
    Array.isArray(extension.contributes.viewsContainers.panel) &&
      extension.contributes.views["saber-evidence-panel"].some((view) => view.id === "saber.evidence"),
    "S28 evidence drawer lives in the bottom panel",
  );
  check(
    Array.isArray(extension.contributes.viewsContainers.secondarySidebar) &&
      extension.contributes.views["saber-secondary"].some((view) => view.id === "saber.commandCenter"),
    "S28 command center is a secondary-sidebar view",
  );
  check(
    extension.contributes.viewsContainers.activitybar.every((container) => container.id !== "saber.commandCenter") &&
      extension.contributes.views["saber-secondary"].length > 0,
    "S28 command center is absent from the activity bar (secondary by construction)",
  );
  const keybindingCommands = extension.contributes.keybindings.map((binding) => binding.command);
  check(
    [
      "saber.workbench.openRepository",
      "saber.workbench.selectTask",
      "saber.workbench.focusConversation",
      "saber.workbench.focusEditor",
      "saber.workbench.openTerminal",
      "saber.workbench.openEvidence",
      "saber.workbench.returnFocus",
    ].every((command) => keybindingCommands.includes(command)),
    "S28 full keyboard path is keybound",
  );
  check(
    extension.contributes.keybindings.some(
      (binding) => binding.command === "saber.workbench.layout.moveSplitter" && binding.args?.pane,
    ),
    "S28 splitter keyboard movement is keybound with pane args",
  );
  const englishStrings = JSON.parse(
    readFileSync(join(worktree, "extensions", "saber-agent", "package.nls.json"), "utf8"),
  );
  const chineseStrings = JSON.parse(
    readFileSync(join(worktree, "extensions", "saber-agent", "package.nls.zh-cn.json"), "utf8"),
  );
  check(
    JSON.stringify(Object.keys(englishStrings).sort()) === JSON.stringify(Object.keys(chineseStrings).sort()),
    "S28 zh/en string tables keep parity",
  );

  const english = readFileSync(join(worktree, "extensions", "saber-agent", "package.nls.json"), "utf8");
  check(
    english.includes("engineering preview") && english.includes("not connected"),
    "welcome copy states the honest unconnected preview",
  );

  const layout = readFileSync(join(worktree, "src", "vs", "workbench", "browser", "layout.ts"), "utf8");
  check(
    layout.includes("getViewContainerById('saber-workbench')") &&
      layout.includes("saberWorkbenchContainer?.id ?? this.viewDescriptorService.getDefaultViewContainer"),
    "Desktop Agent Workbench is the default startup sidebar route (patch 0002)",
  );

  if (WORKSPACE !== null && WORKSPACE !== undefined) {
    const workspacePath = isAbsolute(WORKSPACE) ? WORKSPACE : join(process.cwd(), WORKSPACE);
    check(existsSync(workspacePath) && statSync(workspacePath).isDirectory(), `workspace fixture exists: ${WORKSPACE}`);
    const entries = existsSync(workspacePath) ? readdirSync(workspacePath) : [];
    check(entries.length > 0, "workspace fixture is a real, non-empty workspace");
    check(
      entries.includes("README.md") && existsSync(join(workspacePath, "src")),
      "workspace fixture carries documentation and sources",
    );
  }

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
