import {execFileSync} from "node:child_process";
import {lstatSync, readdirSync, readFileSync} from "node:fs";
import {extname, join, relative} from "node:path";

const root = process.cwd();
const requiredFiles = [
  "README.md",
  ".gitignore",
  ".editorconfig",
  ".gitattributes",
  "AGENTS.md",
  "LICENSE",
  "SECURITY.md",
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/repository-verification.yml",
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

function readText(file) {
  return readFileSync(join(root, file), "utf8");
}

for (const file of requiredFiles) {
  try {
    const content = readFileSync(join(root, file));
    check(content.length > 0, "required-file", file);
  } catch {
    check(false, "required-file", file);
  }
}

const plan = readText("docs/企业级开发执行与跨模型接力计划.md");
const segments = plan.match(/^## S\d{2}：/gm) ?? [];
check(segments.length === 25, "segment-count", String(segments.length));

const state = readText("docs/execution/STATE.yaml");
check(state.includes("id: S00"), "state-segment", "S00");
check(/status: (in_progress|completed)/.test(state), "state-status", "recognized");
check(state.includes("remote: git@github.com:SunArthurX/saber-harness.git"), "remote-recorded", "origin");

try {
  const evidence = JSON.parse(readText("docs/execution/EVIDENCE.json"));
  check(evidence.segment === "S00", "evidence-segment", evidence.segment);
  check(evidence.remote === "git@github.com:SunArthurX/saber-harness.git", "evidence-remote", "origin");
} catch (error) {
  check(false, "evidence-json", error.message);
}

const textExtensions = new Set([".md", ".yaml", ".yml", ".json", ".mjs", ""]);
const skipDirectories = new Set([".git", "tmp", "node_modules", "target", "dist", "build"]);
const conflictPattern = /^(<<<<<<<|=======|>>>>>>>)/m;
const secretPatterns = [
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9]{32,}/,
  /sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];

function scan(directory) {
  for (const entry of readdirSync(directory)) {
    if (skipDirectories.has(entry)) continue;
    const absolute = join(directory, entry);
    const info = lstatSync(absolute);
    check(!info.isSymbolicLink(), "no-symbolic-link", relative(root, absolute));
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      scan(absolute);
      continue;
    }
    if (!textExtensions.has(extname(entry)) && !entry.startsWith(".")) continue;
    const content = readFileSync(absolute, "utf8");
    const file = relative(root, absolute);
    check(!conflictPattern.test(content), "conflict-marker", file);
    check(content.endsWith("\n"), "final-newline", file);
    check(!/[ \t]+$/m.test(content), "trailing-whitespace", file);
    check(!secretPatterns.some((pattern) => pattern.test(content)), "secret-pattern", file);
    if (extname(entry) === ".md") {
      const fences = content.match(/^```/gm) ?? [];
      check(fences.length % 2 === 0, "markdown-fences", file);
    }
  }
}

scan(root);

try {
  const tracked = execFileSync("git", ["ls-files", "-z"], {cwd: root})
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const unsafeTracked = tracked.filter((file) =>
    file.startsWith("tmp/") ||
    /(^|\/)\.env(?:\.|$)/.test(file) ||
    /\.(?:pem|key|p12)$/.test(file)
  );
  check(unsafeTracked.length === 0, "tracked-file-safety", unsafeTracked.join(", ") || "clean");
} catch (error) {
  check(false, "tracked-file-safety", error.message);
}

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
