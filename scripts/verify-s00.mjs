import {readdirSync, readFileSync, statSync} from "node:fs";
import {extname, join, relative} from "node:path";

const root = process.cwd();
const requiredFiles = [
  "README.md",
  ".gitignore",
  ".editorconfig",
  ".gitattributes",
  "AGENTS.md",
  "docs/企业级本地CodingAgent-IDE产品与架构方案.md",
  "docs/企业级开发执行与跨模型接力计划.md",
  "docs/traceability.yaml",
  "docs/execution/ROADMAP.md",
  "docs/execution/STATE.yaml",
  "docs/execution/HANDOFF.md",
  "docs/execution/DECISIONS.md",
  "docs/execution/KNOWN-ISSUES.md",
  "docs/execution/EVIDENCE.json",
  "docs/templates/HANDOFF.md",
  "docs/templates/SEGMENT-CHECKLIST.md",
  "docs/templates/STATE.yaml.example",
  "docs/templates/NEXT-MODEL-PROMPT.md"
];

const failures = [];
const passes = [];

function check(condition, name, detail) {
  if (condition) {
    passes.push({name, detail});
  } else {
    failures.push({name, detail});
  }
}

for (const file of requiredFiles) {
  try {
    const content = readFileSync(join(root, file));
    check(content.length > 0, "required-file", file);
  } catch {
    check(false, "required-file", file);
  }
}

const plan = readFileSync(join(root, "docs/企业级开发执行与跨模型接力计划.md"), "utf8");
const segments = plan.match(/^## S\d{2}：/gm) ?? [];
check(segments.length === 25, "segment-count", String(segments.length));

const state = readFileSync(join(root, "docs/execution/STATE.yaml"), "utf8");
check(state.includes("id: S00"), "state-segment", "S00");
check(state.includes("status: in_progress"), "state-status", "in_progress");
check(state.includes("remote: null"), "remote-explicitly-unconfigured", "true");

try {
  const evidence = JSON.parse(readFileSync(join(root, "docs/execution/EVIDENCE.json"), "utf8"));
  check(evidence.segment === "S00", "evidence-segment", evidence.segment);
  check(evidence.remote === null, "evidence-remote", "null");
} catch (error) {
  check(false, "evidence-json", error.message);
}

const textExtensions = new Set([".md", ".yaml", ".yml", ".json", ".mjs", ""]);
const skipDirectories = new Set([".git", "tmp", "node_modules", "target", "dist", "build"]);
const conflictPattern = /^(<<<<<<<|=======|>>>>>>>)/m;

function scan(directory) {
  for (const entry of readdirSync(directory)) {
    if (skipDirectories.has(entry)) continue;
    const absolute = join(directory, entry);
    const info = statSync(absolute);
    if (info.isDirectory()) {
      scan(absolute);
      continue;
    }
    if (!textExtensions.has(extname(entry)) && !entry.startsWith(".")) continue;
    const content = readFileSync(absolute, "utf8");
    check(!conflictPattern.test(content), "conflict-marker", relative(root, absolute));
  }
}

scan(root);

for (const pass of passes) {
  console.log(`PASS ${pass.name}: ${pass.detail}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure.name}: ${failure.detail}`);
  }
  process.exit(1);
}

console.log(`S00 local verification passed with ${passes.length} checks.`);
