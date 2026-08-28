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

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S25 verification passed with ${passes.length} checks.`);
