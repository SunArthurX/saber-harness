#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");
const normalized = (value) => value.replace(/\s+/g, " ");

const requiredFiles = [
  "docs/adr/ADR-028-codeoss-desktop-primary-product.md",
  "docs/execution/DESKTOP-WORKBENCH-ENTERPRISE-PLAN.md",
  "docs/design/SABER-STUDIO-GUI-DESIGN.md",
  "apps/desktop-codeoss/README.md",
  "docs/execution/desktop/README.md",
  "docs/execution/desktop/SEGMENT-RUNBOOK-TEMPLATE.md",
  "docs/execution/desktop/desktop-workbench-wbs.json",
  "docs/execution/desktop/ACCEPTANCE-AND-TRACEABILITY.md",
  "docs/execution/desktop/UX-SCREEN-INVENTORY.md",
  "docs/execution/desktop/PLATFORM-AND-RELEASE-MATRIX.md",
  "docs/execution/desktop/TEAM-OPERATING-MODEL.md",
  "docs/execution/desktop/EVAL-AND-DESIGN-PARTNER-PLAN.md",
  "docs/execution/desktop/NEXT-MODEL-S26.md",
];

for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "required-file", file);
}

const adr = text("docs/adr/ADR-028-codeoss-desktop-primary-product.md");
for (const contract of [
  "Status: accepted",
  "Code-OSS-derived Electron desktop application",
  "default route is the Desktop Agent Workbench",
  "loopback Web supervisor remains an optional companion",
  "Saber Core remains a separately supervised Rust process",
  "will not maintain parallel Code-OSS and Tauri main products",
]) {
  check(normalized(adr).includes(contract), "desktop-adr-contract", contract);
}

const plan = text("docs/execution/DESKTOP-WORKBENCH-ENTERPRISE-PLAN.md");
for (const contract of [
  "主产品：Saber Studio Desktop",
  "辅助产品：Saber Web Supervisor（可选）",
  "## 2. 当前事实与缺口审计",
  "## 4. 技术架构",
  "## 6. S25-S38 分段交付路线",
  "## 9. 质量、测试与发布门禁",
  "## 11. 风险登记",
  "Web Supervisor 不计入此 Gate",
  "不得用截图、静态 HTML、Web Supervisor、Storybook 或模拟 Core 单独证明",
  "### 1.1 可直接执行的计划包",
  "S26-S38 共 13 份独立 Segment Runbook",
  "S25 只交付可验证的桌面产品基线与执行计划",
]) {
  check(plan.includes(contract), "enterprise-plan-contract", contract);
}

for (let segment = 25; segment <= 38; segment += 1) {
  check(plan.includes(`| S${segment} `), "desktop-roadmap-segment", `S${segment}`);
}

const design = text("docs/design/SABER-STUDIO-GUI-DESIGN.md");
check(design.includes("### 5.1 Desktop Agent Workbench（默认）"), "desktop-default-view", "design section 5.1");
check(
  design.includes("Today / Command Center（二级监督页）"),
  "command-center-secondary",
  "design information architecture",
);
check(
  design.includes("`bin/saber ui` 是可选 Web Supervisor"),
  "web-supervisor-boundary",
  "design desktop-first invariant",
);

const desktopReadme = text("apps/desktop-codeoss/README.md");
check(
  desktopReadme.includes("production Code-OSS/Electron shell has not landed yet"),
  "honest-desktop-status",
  "placeholder is explicit",
);
check(
  normalized(desktopReadme).includes("primary product surface selected by ADR-028"),
  "desktop-product-priority",
  "desktop is primary",
);

const consoleStrings = text("apps/cli/src/ui-i18n.ts");
check(
  consoleStrings.includes("It is not the full desktop IDE"),
  "console-honest-scope",
  "web console does not claim desktop completion",
);

check(text("package.json").includes("node scripts/verify-s25.mjs"), "local-s25-gate", "pnpm verify");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s25.mjs"),
  "hosted-s25-gate",
  "repository verification workflow",
);

const desktopDirectory = "docs/execution/desktop";
const executionIndex = text(`${desktopDirectory}/README.md`);
for (const contract of [
  "Status: executable planning baseline; S26 implementation has not started",
  "## Five-minute start",
  "## Universal Definition of Done",
  "git diff --check origin/main...HEAD",
  "NEXT-MODEL-S26.md",
]) {
  check(executionIndex.includes(contract), "desktop-execution-index", contract);
}

const runbooks = [
  ["S26", "S26-CODEOSS-BOOTSTRAP.md"],
  ["S27", "S27-CORE-SUPERVISION-TRANSPORT.md"],
  ["S28", "S28-DESKTOP-WORKBENCH-SHELL.md"],
  ["S29", "S29-CONVERSATION-CONTEXT.md"],
  ["S30", "S30-GOVERNED-AGENT-RUN.md"],
  ["S31", "S31-CHANGES-EVIDENCE-REVIEW.md"],
  ["S32", "S32-MULTIAGENT-WORKTREE.md"],
  ["S33", "S33-CONTINUITY-KNOWLEDGE.md"],
  ["S34", "S34-ARMOR-EVOLUTION-HEALTH.md"],
  ["S35", "S35-ENTERPRISE-DESKTOP.md"],
  ["S36", "S36-PACKAGING-UPDATE.md"],
  ["S37", "S37-QUALITY-SECURITY-GATE.md"],
  ["S38", "S38-DESIGN-PARTNER-PRODUCTION.md"],
];

for (const [segment, file] of runbooks) {
  const path = `${desktopDirectory}/${file}`;
  check(existsSync(join(root, path)), "desktop-segment-runbook", `${segment}: ${file}`);
  if (!existsSync(join(root, path))) continue;
  const runbook = text(path);
  for (const contract of ["Status: planned", "## Outcome", "## Work packages", "## Exit Gate"]) {
    check(runbook.includes(contract), "desktop-runbook-contract", `${segment}: ${contract}`);
  }
  check(runbook.toLowerCase().includes("verification"), "desktop-runbook-contract", `${segment}: verification`);
  for (let workPackage = 1; workPackage <= 6; workPackage += 1) {
    const id = `${segment}-WP${String(workPackage).padStart(2, "0")}`;
    check(runbook.includes(id), "desktop-runbook-work-package", id);
  }
}

const wbsPath = `${desktopDirectory}/desktop-workbench-wbs.json`;
if (existsSync(join(root, wbsPath))) {
  let wbs;
  try {
    wbs = JSON.parse(text(wbsPath));
    check(true, "desktop-wbs-json", "valid JSON");
  } catch (error) {
    check(false, "desktop-wbs-json", error.message);
  }
  if (wbs) {
    check(wbs.schema_version === 1, "desktop-wbs-schema", "schema_version 1");
    check(wbs.primary_surface.includes("Desktop Agent Workbench"), "desktop-wbs-product", wbs.primary_surface);
    check(wbs.authority.includes("Rust Core"), "desktop-wbs-authority", wbs.authority);
    check(wbs.segments.length === 13, "desktop-wbs-segment-count", `${wbs.segments.length}`);
    const ids = new Set();
    let taskCount = 0;
    for (const [index, segment] of wbs.segments.entries()) {
      const expectedSegment = `S${26 + index}`;
      check(segment.id === expectedSegment, "desktop-wbs-segment-order", `${segment.id}: ${index}`);
      check(segment.tasks.length === 6, "desktop-wbs-task-count", `${segment.id}: ${segment.tasks.length}`);
      check(Boolean(segment.exit_gate), "desktop-wbs-exit-gate", segment.id);
      for (const task of segment.tasks) {
        taskCount += 1;
        check(task.id.startsWith(`${segment.id}-WP`), "desktop-wbs-task-id", task.id);
        check(!ids.has(task.id), "desktop-wbs-task-unique", task.id);
        check(Boolean(task.owner && task.output), "desktop-wbs-task-contract", task.id);
        ids.add(task.id);
      }
    }
    check(taskCount === 78, "desktop-wbs-total-tasks", `${taskCount}`);
  }
}

const acceptance = text(`${desktopDirectory}/ACCEPTANCE-AND-TRACEABILITY.md`);
check(acceptance.includes("DJ-01"), "desktop-acceptance-first-journey", "DJ-01");
check(acceptance.includes("DJ-13"), "desktop-acceptance-last-journey", "DJ-13");
check(acceptance.includes("## DJ-03 canonical fixture"), "desktop-acceptance-canonical-fixture", "DJ-03 fixture");

const screenInventory = text(`${desktopDirectory}/UX-SCREEN-INVENTORY.md`);
check(screenInventory.includes("UI-01"), "desktop-screen-first", "UI-01");
check(screenInventory.includes("UI-24"), "desktop-screen-last", "UI-24");
for (const state of ["Empty", "Loading", "Error", "Keyboard", "Accessibility"]) {
  check(screenInventory.includes(state), "desktop-screen-state", state);
}

const platformMatrix = text(`${desktopDirectory}/PLATFORM-AND-RELEASE-MATRIX.md`);
for (const platform of ["macOS", "Windows", "Linux", "x64", "arm64", "signed update metadata"]) {
  check(platformMatrix.includes(platform), "desktop-platform-contract", platform);
}

const teamModel = text(`${desktopDirectory}/TEAM-OPERATING-MODEL.md`);
for (const contract of ["## RACI by stream", "Security", "evidence", "Segment close"]) {
  check(teamModel.includes(contract), "desktop-team-contract", contract);
}

const evaluationPlan = text(`${desktopDirectory}/EVAL-AND-DESIGN-PARTNER-PLAN.md`);
for (const contract of ["## Repository portfolio", "## Metrics", "## Stage thresholds", "## Stop thresholds"]) {
  check(evaluationPlan.includes(contract), "desktop-evaluation-contract", contract);
}

const nextModel = text(`${desktopDirectory}/NEXT-MODEL-S26.md`);
for (const contract of [
  "Start S26 Only After S25 Merge",
  "If S25 is not merged",
  "upstream.lock.json",
  "## Mandatory handoff",
]) {
  check(nextModel.includes(contract), "desktop-next-model-contract", contract);
}

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S25 verification passed with ${passes.length} checks.`);
