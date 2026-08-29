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
  "docs/execution/desktop/GLM-5.3-S26-EXECUTION-PROMPT.md",
  "docs/execution/desktop/COMPETITIVE-CAPABILITY-RESEARCH.md",
  "docs/execution/desktop/competitive-capability-map.json",
  "docs/execution/desktop/ADVANCED-HARNESS-RESEARCH.md",
  "docs/execution/desktop/advanced-harness-capability-map.json",
  "docs/execution/desktop/PHILOSOPHY-TO-ARCHITECTURE.md",
  "docs/execution/desktop/philosophy-architecture-map.json",
  "docs/execution/desktop/DESKTOP-PRODUCT-OPERATING-MODEL.md",
  "docs/execution/desktop/desktop-product-release-trains.json",
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
  "RT-0 只能称为工程预览",
  "RT-1 才能称为",
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
check(design.includes("### 5.12 Advanced Agent Body Inspectors"), "advanced-desktop-inspectors", "design section 5.12");
for (const ui of ["UI-36", "UI-37", "UI-38", "UI-39", "UI-40", "UI-41", "UI-42"]) {
  check(design.includes(ui), "advanced-desktop-inspector-id", ui);
}

const desktopReadme = text("apps/desktop-codeoss/README.md");
check(
  desktopReadme.includes("the desktop plan (S00-S38) is complete") &&
    desktopReadme.includes("remain hosted release-pipeline evidence"),
  "honest-desktop-status",
  "status is explicit: dev launch real, packaged claim withheld",
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
  "GLM-5.3-S26-EXECUTION-PROMPT.md",
  "COMPETITIVE-CAPABILITY-RESEARCH.md",
  "competitive-capability-map.json",
  "ADVANCED-HARNESS-RESEARCH.md",
  "advanced-harness-capability-map.json",
  "PHILOSOPHY-TO-ARCHITECTURE.md",
  "philosophy-architecture-map.json",
  "DESKTOP-PRODUCT-OPERATING-MODEL.md",
  "desktop-product-release-trains.json",
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

const advancedCapabilityMapPath = `${desktopDirectory}/advanced-harness-capability-map.json`;
let advancedCapabilityMap;
try {
  advancedCapabilityMap = JSON.parse(text(advancedCapabilityMapPath));
  check(true, "advanced-capability-json", "valid JSON");
} catch (error) {
  check(false, "advanced-capability-json", error.message);
}

const advancedCapabilityById = new Map();
if (advancedCapabilityMap) {
  check(advancedCapabilityMap.schema_version === 1, "advanced-capability-schema", "schema_version 1");
  check(
    advancedCapabilityMap.products.length === 7,
    "advanced-product-count",
    `${advancedCapabilityMap.products.length}`,
  );
  check(
    advancedCapabilityMap.capabilities.length === 36,
    "advanced-capability-count",
    `${advancedCapabilityMap.capabilities.length}`,
  );
  for (const capability of advancedCapabilityMap.capabilities) {
    check(/^(CUR|DSH|ZED|KIR|OHD|CLN|AID)-\d{2}$/.test(capability.id), "advanced-capability-id", capability.id);
    check(!advancedCapabilityById.has(capability.id), "advanced-capability-unique", capability.id);
    check(advancedCapabilityMap.products.includes(capability.product), "advanced-capability-product", capability.id);
    check(["A", "B"].includes(capability.evidence_grade), "advanced-capability-grade", capability.id);
    check(Boolean(capability.capability && capability.saber_decision), "advanced-capability-decision", capability.id);
    check(capability.philosophy.length > 0, "advanced-capability-philosophy", capability.id);
    check(capability.segments.length > 0, "advanced-capability-segments", capability.id);
    check(capability.ui.length > 0, "advanced-capability-ui", capability.id);
    check(capability.journeys.length > 0, "advanced-capability-journeys", capability.id);
    for (const principle of capability.philosophy) {
      check(/^PHL-(?:0[1-9]|1[0-2])$/.test(principle), "advanced-philosophy-id", `${capability.id}: ${principle}`);
    }
    for (const segment of capability.segments) {
      check(/^S(?:2[7-9]|3[0-8])$/.test(segment), "advanced-capability-segment-id", `${capability.id}: ${segment}`);
    }
    for (const ui of capability.ui) {
      check(/^UI-(?:0[1-9]|[1-3][0-9]|4[0-2])$/.test(ui), "advanced-capability-ui-id", `${capability.id}: ${ui}`);
    }
    for (const journey of capability.journeys) {
      check(
        /^DJ-(?:0[1-9]|[12][0-9]|3[0-2])$/.test(journey),
        "advanced-capability-journey-id",
        `${capability.id}: ${journey}`,
      );
    }
    advancedCapabilityById.set(capability.id, capability);
  }
}

const philosophyMapPath = `${desktopDirectory}/philosophy-architecture-map.json`;
let philosophyMap;
try {
  philosophyMap = JSON.parse(text(philosophyMapPath));
  check(true, "philosophy-map-json", "valid JSON");
} catch (error) {
  check(false, "philosophy-map-json", error.message);
}

if (philosophyMap) {
  check(philosophyMap.schema_version === 1, "philosophy-map-schema", "schema_version 1");
  check(philosophyMap.authority_order.length === 6, "philosophy-authority-order", philosophyMap.authority_order.length);
  check(philosophyMap.principles.length === 12, "philosophy-principle-count", philosophyMap.principles.length);
  check(philosophyMap.organs.length === 19, "philosophy-organ-count", philosophyMap.organs.length);
  check(
    philosophyMap.evolution_levels.length === 8,
    "philosophy-evolution-count",
    philosophyMap.evolution_levels.length,
  );
  check(
    philosophyMap.homeostasis_states.length === 9,
    "philosophy-homeostasis-count",
    philosophyMap.homeostasis_states.length,
  );
  check(
    philosophyMap.health_levels.join(",") === "H0,H1,H2,H3,H4",
    "philosophy-health-levels",
    philosophyMap.health_levels.join(","),
  );
  check(philosophyMap.data_islands.length === 5, "philosophy-data-islands", philosophyMap.data_islands.length);
  const principleIds = new Set(philosophyMap.principles.map((principle) => principle.id));
  const organIds = new Set(philosophyMap.organs.map((organ) => organ.id));
  for (let index = 1; index <= 12; index += 1) {
    check(
      principleIds.has(`PHL-${String(index).padStart(2, "0")}`),
      "philosophy-principle-id",
      `PHL-${String(index).padStart(2, "0")}`,
    );
  }
  for (let index = 1; index <= 19; index += 1) {
    check(
      organIds.has(`ORG-${String(index).padStart(2, "0")}`),
      "philosophy-organ-id",
      `ORG-${String(index).padStart(2, "0")}`,
    );
  }
  for (const principle of philosophyMap.principles) {
    check(Boolean(principle.invariant), "philosophy-invariant", principle.id);
    check(principle.negative_tests.length > 0, "philosophy-negative-tests", principle.id);
    for (const organ of principle.organs) {
      check(organIds.has(organ), "philosophy-principle-organ", `${principle.id}: ${organ}`);
    }
  }
  for (const organ of philosophyMap.organs) {
    check(Boolean(organ.authority && organ.reflex), "philosophy-organ-contract", organ.id);
    check(organ.signals.length > 0 && organ.evidence.length > 0, "philosophy-organ-observability", organ.id);
  }
  for (const level of philosophyMap.evolution_levels) {
    check(level.autonomous_core_mutation === false, "philosophy-no-autonomous-core-mutation", level.id);
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
  check(
    runbook.includes("## Advanced harness and philosophy requirements"),
    "desktop-runbook-advanced-section",
    segment,
  );
  const segmentNumber = Number(segment.slice(1));
  const expectedReleaseTrain =
    segmentNumber <= 29 ? "RT-0" : segmentNumber <= 31 ? "RT-1" : segmentNumber <= 34 ? "RT-2" : "RT-3";
  check(
    runbook.includes(`Release train: ${expectedReleaseTrain}`),
    "desktop-runbook-release-train",
    `${segment}: ${expectedReleaseTrain}`,
  );
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
      check(Array.isArray(segment.advanced_capabilities), "desktop-wbs-advanced-capabilities", segment.id);
      for (const capabilityId of segment.advanced_capabilities ?? []) {
        check(advancedCapabilityById.has(capabilityId), "desktop-wbs-advanced-id", `${segment.id}: ${capabilityId}`);
        check(runbook.includes(capabilityId), "desktop-runbook-advanced-id", `${segment.id}: ${capabilityId}`);
        check(
          advancedCapabilityById.get(capabilityId)?.segments.includes(segment.id),
          "desktop-advanced-segment-symmetry",
          `${segment.id}: ${capabilityId}`,
        );
      }
      check(
        Array.isArray(segment.philosophy_principles) && segment.philosophy_principles.length > 0,
        "desktop-wbs-philosophy-principles",
        segment.id,
      );
      for (const principleId of segment.philosophy_principles ?? []) {
        check(
          philosophyMap?.principles.some((principle) => principle.id === principleId),
          "desktop-wbs-philosophy-id",
          `${segment.id}: ${principleId}`,
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
const screenInventory = text(`${desktopDirectory}/UX-SCREEN-INVENTORY.md`);
check(acceptance.includes("DJ-01"), "desktop-acceptance-first-journey", "DJ-01");
check(acceptance.includes("DJ-13"), "desktop-acceptance-last-journey", "DJ-13");
check(acceptance.includes("DJ-24"), "desktop-acceptance-competitive-last-journey", "DJ-24");
check(acceptance.includes("DJ-32"), "desktop-acceptance-advanced-last-journey", "DJ-32");
check(acceptance.includes("## DJ-03 canonical fixture"), "desktop-acceptance-canonical-fixture", "DJ-03 fixture");
check(acceptance.includes("## Release claim gates"), "desktop-release-claim-gates", "release claims");

const operatingModel = text(`${desktopDirectory}/DESKTOP-PRODUCT-OPERATING-MODEL.md`);
for (const contract of [
  "## Canonical product objects",
  "## Ownership and projection rules",
  "## Lifecycle contracts",
  "### Specification and Agent Profile",
  "### Reflex Hook, Checkpoint and Runtime Image",
  "### Projection Recipe",
  "## Navigation and command grammar",
  "## Release cut lines",
  "### MVP cut line",
  "## Recovery decision table",
  "## Product telemetry and privacy contract",
  "RT-0 Foundation Preview",
  "RT-1 Governed Coding Alpha",
  "first desktop CodingAgent MVP",
]) {
  check(operatingModel.includes(contract), "desktop-product-operating-model", contract);
}
for (const object of [
  "Workspace",
  "Repository",
  "Goal",
  "Task",
  "Conversation",
  "Plan",
  "Run",
  "Realm",
  "Worktree",
  "Context Receipt",
  "Approval",
  "Change Set",
  "Evidence",
  "Memory",
  "Capability",
  "Evolution Candidate",
  "Incident",
  "Specification",
  "Agent Profile",
  "Reflex Hook",
  "Checkpoint",
  "Runtime Image",
  "Projection Recipe",
]) {
  check(operatingModel.includes(`| ${object} |`), "desktop-canonical-product-object", object);
}

const releaseTrainPath = `${desktopDirectory}/desktop-product-release-trains.json`;
const philosophyForRelease = text(`${desktopDirectory}/PHILOSOPHY-TO-ARCHITECTURE.md`);
let releaseTrains;
try {
  releaseTrains = JSON.parse(text(releaseTrainPath));
  check(true, "desktop-release-train-json", "valid JSON");
} catch (error) {
  check(false, "desktop-release-train-json", error.message);
}
if (releaseTrains) {
  check(releaseTrains.schema_version === 1, "desktop-release-train-schema", "schema_version 1");
  check(releaseTrains.mvp_release_train === "RT-1", "desktop-mvp-release-train", releaseTrains.mvp_release_train);
  check(releaseTrains.release_trains.length === 4, "desktop-release-train-count", releaseTrains.release_trains.length);
  const expectedSegments = Array.from({ length: 13 }, (_, index) => `S${26 + index}`);
  const actualSegments = [];
  for (const [index, train] of releaseTrains.release_trains.entries()) {
    const expectedId = `RT-${index}`;
    check(train.id === expectedId, "desktop-release-train-order", `${train.id}: ${index}`);
    check(Boolean(train.name && train.label && train.distribution), "desktop-release-train-identity", train.id);
    check(Boolean(train.entry_gate && train.exit_gate), "desktop-release-train-gates", train.id);
    check(train.segments.length > 0, "desktop-release-train-segments", train.id);
    check(train.required_journeys.length > 0, "desktop-release-train-journeys", train.id);
    check(Array.isArray(train.required_philosophy_journeys), "desktop-release-train-philosophy", train.id);
    check(train.required_ui.length > 0, "desktop-release-train-ui", train.id);
    check(train.non_claims.length > 0, "desktop-release-train-non-claims", train.id);
    actualSegments.push(...train.segments);
    const releaseWbs = JSON.parse(text(wbsPath));
    for (const segmentId of train.segments) {
      check(
        releaseWbs.segments.find((segment) => segment.id === segmentId)?.release_train === train.id,
        "desktop-release-train-wbs-symmetry",
        `${train.id}: ${segmentId}`,
      );
    }
    for (const journey of train.required_journeys) {
      check(
        /^DJ-(?:0[1-9]|[12][0-9]|3[0-2])$/.test(journey) && acceptance.includes(journey),
        "desktop-release-train-journey-id",
        `${train.id}: ${journey}`,
      );
    }
    for (const ui of train.required_ui) {
      check(
        /^UI-(?:0[1-9]|[1-3][0-9]|4[0-2])$/.test(ui) && screenInventory.includes(ui),
        "desktop-release-train-ui-id",
        `${train.id}: ${ui}`,
      );
    }
    for (const journey of train.required_philosophy_journeys) {
      check(
        /^PJ-(?:0[1-9]|1[0-2])$/.test(journey) && philosophyForRelease.includes(`| ${journey} |`),
        "desktop-release-train-philosophy-id",
        `${train.id}: ${journey}`,
      );
    }
  }
  check(
    JSON.stringify(actualSegments) === JSON.stringify(expectedSegments),
    "desktop-release-train-segment-coverage",
    actualSegments.join(","),
  );
}

check(screenInventory.includes("UI-01"), "desktop-screen-first", "UI-01");
check(screenInventory.includes("UI-24"), "desktop-screen-last", "UI-24");
check(screenInventory.includes("UI-35"), "desktop-screen-competitive-last", "UI-35");
check(screenInventory.includes("UI-42"), "desktop-screen-advanced-last", "UI-42");
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
  "ADVANCED-HARNESS-RESEARCH.md",
  "advanced-harness-capability-map.json",
  "PHILOSOPHY-TO-ARCHITECTURE.md",
  "philosophy-architecture-map.json",
  "DESKTOP-PRODUCT-OPERATING-MODEL.md",
  "desktop-product-release-trains.json",
  "engineering preview rather than the CodingAgent MVP",
]) {
  check(nextModel.includes(contract), "desktop-next-model-contract", contract);
}

const glmPrompt = text(`${desktopDirectory}/GLM-5.3-S26-EXECUTION-PROMPT.md`);
for (const contract of [
  "GLM-5.3",
  "分支 A",
  "分支 B",
  "protected_pr_merge",
  "S26-CODEOSS-BOOTSTRAP.md",
  "Desktop Agent Workbench",
  "Web Supervisor",
  "E0-E7",
  "E7",
  "node scripts/verify-s26.mjs",
  "pnpm acceptance:new-machine",
  "不得开始 S27",
  "STATE.yaml",
  "HANDOFF.md",
  "EVIDENCE.json",
]) {
  check(glmPrompt.includes(contract), "desktop-glm53-prompt-contract", contract);
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

const advancedResearch = text(`${desktopDirectory}/ADVANCED-HARNESS-RESEARCH.md`);
for (const contract of [
  "## Scope and method",
  "## Cursor findings",
  "## DeepSeek Harness findings",
  "## Zed findings",
  "## Kiro findings",
  "## OpenHands findings",
  "## Cline findings",
  "## Aider findings",
  "## Cross-product architecture decisions",
  "## Anti-copy rules",
  "https://cursor.com/docs/agent/overview",
  "https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md",
  "https://zed.dev/acp",
  "https://kiro.dev/docs/hooks/",
  "https://docs.openhands.dev/openhands/usage/architecture/runtime",
  "https://docs.cline.bot/core-workflows/plan-and-act",
  "https://aider.chat/docs/repomap.html",
]) {
  check(advancedResearch.includes(contract), "advanced-harness-research", contract);
}

const wbsForAdvanced = JSON.parse(text(wbsPath));
for (const [capabilityId, capability] of advancedCapabilityById) {
  check(advancedResearch.includes(capabilityId), "advanced-research-capability", capabilityId);
  for (const principleId of capability.philosophy) {
    check(
      philosophyMap?.principles.some((principle) => principle.id === principleId),
      "advanced-philosophy-symmetry",
      `${capabilityId}: ${principleId}`,
    );
  }
  for (const segmentId of capability.segments) {
    const segment = wbsForAdvanced.segments.find((item) => item.id === segmentId);
    check(
      segment?.advanced_capabilities.includes(capabilityId),
      "advanced-map-wbs-symmetry",
      `${capabilityId}: ${segmentId}`,
    );
  }
}

const philosophyContract = text(`${desktopDirectory}/PHILOSOPHY-TO-ARCHITECTURE.md`);
for (const contract of [
  "## Twelve philosophical invariants",
  "### PHL-01 Human sovereignty",
  "### PHL-12 Graduated autonomy and least action",
  "## Body and system-organ map",
  "## Authority stack",
  "## Homeostasis protocol",
  "Detect → Classify → Contain → Stabilize → Diagnose → Repair → Verify → Learn → Expire",
  "## Evolution ladder and autonomy ceiling",
  "## Armor lifecycle",
  "## Internal evolution lifecycle",
  "## Data-island unification contract",
  "## Philosophical tensions and resolution rules",
  "## Philosophy acceptance journeys",
  "E7",
  "H4",
]) {
  check(normalized(philosophyContract).includes(contract), "philosophy-architecture-contract", contract);
}
for (let index = 1; index <= 12; index += 1) {
  const id = `PJ-${String(index).padStart(2, "0")}`;
  check(philosophyContract.includes(`| ${id} |`), "philosophy-journey", id);
}

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S25 verification passed with ${passes.length} checks.`);
