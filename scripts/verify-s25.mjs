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
  "docs/execution/desktop/COMPETITIVE-CAPABILITY-RESEARCH.md",
  "docs/execution/desktop/competitive-capability-map.json",
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
  "### 1.2 竞品能力校准后的产品原则",
  "一个受治理的身体、可替换的大脑",
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
  "COMPETITIVE-CAPABILITY-RESEARCH.md",
  "competitive-capability-map.json",
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

const capabilityMapPath = `${desktopDirectory}/competitive-capability-map.json`;
let capabilityMap;
if (existsSync(join(root, capabilityMapPath))) {
  try {
    capabilityMap = JSON.parse(text(capabilityMapPath));
    check(true, "competitive-capability-json", "valid JSON");
  } catch (error) {
    check(false, "competitive-capability-json", error.message);
  }
}

const capabilityById = new Map();
if (capabilityMap) {
  check(capabilityMap.schema_version === 1, "competitive-capability-schema", "schema_version 1");
  check(
    capabilityMap.capabilities.length === 31,
    "competitive-capability-count",
    `${capabilityMap.capabilities.length}`,
  );
  check(capabilityMap.products.length === 4, "competitive-product-count", `${capabilityMap.products.length}`);
  for (const capability of capabilityMap.capabilities) {
    check(/^(CDX|CLD|ZCD|MMX)-\d{2}$/.test(capability.id), "competitive-capability-id", capability.id);
    check(!capabilityById.has(capability.id), "competitive-capability-unique", capability.id);
    check(capabilityMap.products.includes(capability.product), "competitive-capability-product", capability.id);
    check(["A", "B"].includes(capability.evidence_grade), "competitive-capability-grade", capability.id);
    check(
      Boolean(capability.capability && capability.saber_decision),
      "competitive-capability-decision",
      capability.id,
    );
    check(capability.segments.length > 0, "competitive-capability-segments", capability.id);
    check(capability.ui.length > 0, "competitive-capability-ui", capability.id);
    check(capability.journeys.length > 0, "competitive-capability-journeys", capability.id);
    for (const segment of capability.segments) {
      check(/^S(?:2[6-9]|3[0-8])$/.test(segment), "competitive-capability-segment-id", `${capability.id}: ${segment}`);
    }
    for (const ui of capability.ui) {
      check(/^UI-(?:0[1-9]|[12][0-9]|3[0-5])$/.test(ui), "competitive-capability-ui-id", `${capability.id}: ${ui}`);
    }
    for (const journey of capability.journeys) {
      check(
        /^DJ-(?:0[1-9]|1[0-9]|2[0-4])$/.test(journey),
        "competitive-capability-journey-id",
        `${capability.id}: ${journey}`,
      );
    }
    capabilityById.set(capability.id, capability);
  }
}

for (const [segment, file] of runbooks) {
  const path = `${desktopDirectory}/${file}`;
  check(existsSync(join(root, path)), "desktop-segment-runbook", `${segment}: ${file}`);
  if (!existsSync(join(root, path))) continue;
  const runbook = text(path);
  for (const contract of ["Status: planned", "## Outcome", "## Work packages", "## Exit Gate"]) {
    check(runbook.includes(contract), "desktop-runbook-contract", `${segment}: ${contract}`);
  }
  check(runbook.includes("## Competitive-derived requirements"), "desktop-runbook-competitive-section", segment);
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
      check(
        Array.isArray(segment.competitive_capabilities) && segment.competitive_capabilities.length > 0,
        "desktop-wbs-competitive-capabilities",
        segment.id,
      );
      const runbookFile = runbooks.find(([id]) => id === segment.id)?.[1];
      const runbook = runbookFile ? text(`${desktopDirectory}/${runbookFile}`) : "";
      for (const capabilityId of segment.competitive_capabilities ?? []) {
        check(capabilityById.has(capabilityId), "desktop-wbs-competitive-id", `${segment.id}: ${capabilityId}`);
        check(runbook.includes(capabilityId), "desktop-runbook-competitive-id", `${segment.id}: ${capabilityId}`);
        check(
          capabilityById.get(capabilityId)?.segments.includes(segment.id),
          "desktop-competitive-segment-symmetry",
          `${segment.id}: ${capabilityId}`,
        );
      }
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
check(acceptance.includes("DJ-24"), "desktop-acceptance-competitive-last-journey", "DJ-24");
check(acceptance.includes("## DJ-03 canonical fixture"), "desktop-acceptance-canonical-fixture", "DJ-03 fixture");

const screenInventory = text(`${desktopDirectory}/UX-SCREEN-INVENTORY.md`);
check(screenInventory.includes("UI-01"), "desktop-screen-first", "UI-01");
check(screenInventory.includes("UI-24"), "desktop-screen-last", "UI-24");
check(screenInventory.includes("UI-35"), "desktop-screen-competitive-last", "UI-35");
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
  "COMPETITIVE-CAPABILITY-RESEARCH.md",
]) {
  check(nextModel.includes(contract), "desktop-next-model-contract", contract);
}

const competitiveResearch = text(`${desktopDirectory}/COMPETITIVE-CAPABILITY-RESEARCH.md`);
for (const contract of [
  "## Research method and evidence grades",
  "## Codex desktop findings",
  "## Claude Code Desktop findings",
  "## ZCode Desktop findings",
  "## MiniMax Code Desktop findings",
  "## Saber capability decisions",
  "## Anti-copy rules",
  "https://learn.chatgpt.com/docs/app",
  "https://code.claude.com/docs/en/desktop",
  "https://zcode.z.ai/en/docs/goal",
  "https://agent.minimax.io/docs/techblog/agent-team",
]) {
  check(competitiveResearch.includes(contract), "desktop-competitive-research", contract);
}

for (const [capabilityId, capability] of capabilityById) {
  check(competitiveResearch.includes(`### ${capabilityId}`), "competitive-research-capability", capabilityId);
  for (const segmentId of capability.segments) {
    const segment = JSON.parse(text(wbsPath)).segments.find((item) => item.id === segmentId);
    check(
      segment?.competitive_capabilities.includes(capabilityId),
      "competitive-map-wbs-symmetry",
      `${capabilityId}: ${segmentId}`,
    );
  }
}

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S25 verification passed with ${passes.length} checks.`);
