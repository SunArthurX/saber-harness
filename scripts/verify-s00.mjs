import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

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
  ".github/workflows/main-provenance.yml",
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
  "docs/templates/NEXT-MODEL-PROMPT.md",
  "scripts/configure-main-protection.mjs",
  "scripts/verify-remote-s00.mjs",
  "scripts/lib/github-protection.mjs",
  "scripts/tests/github-protection.test.mjs",
];

const failures = [];
const passes = [];

function check(condition, name, detail) {
  if (condition) {
    passes.push({ name, detail });
  } else {
    failures.push({ name, detail });
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
const currentSegment = state.match(/^current_segment:\n(?: {2}.+\n)*? {2}id: (S\d{2})$/m)?.[1];
const currentSegmentStatus = state.match(/^current_segment:\n(?: {2}.+\n)*? {2}status: (in_progress|completed)$/m)?.[1];
check(/^S\d{2}$/.test(currentSegment ?? ""), "state-segment", currentSegment ?? "missing");
check(["in_progress", "completed"].includes(currentSegmentStatus), "state-status", currentSegmentStatus ?? "missing");
check(state.includes("remote: git@github.com:SunArthurX/saber-harness.git"), "remote-recorded", "origin");
check(state.includes("visibility: public"), "visibility-recorded", "public");
const segmentCompleted = currentSegmentStatus === "completed";
if (currentSegment !== "S00") {
  check(state.includes("segment: S00"), "s00-predecessor", "S00");
  check(state.includes("tag: s00-complete"), "s00-completion-tag", "s00-complete");
  try {
    const tagCommit = execFileSync("git", ["rev-parse", "s00-complete^{}"], { cwd: root, encoding: "utf8" }).trim();
    check(/^[0-9a-f]{40}$/.test(tagCommit), "s00-tag-resolves", tagCommit);
  } catch (error) {
    check(false, "s00-tag-resolves", error.message);
  }
}

const acceptanceBlock = state.match(/^acceptance:\n([\s\S]*?)^evidence:/m)?.[1] ?? "";
function acceptanceList(name) {
  const match = acceptanceBlock.match(new RegExp(`^  ${name}:(?: \\[\\])?\\n?((?:    - [^\\n]+\\n?)*)`, "m"));
  return (match?.[1]?.match(/^ {4}- (.+)$/gm) ?? []).map((line) => line.slice(6));
}

const requiredAcceptance = acceptanceList("required");
const passedAcceptance = acceptanceList("passed");
const failedAcceptance = acceptanceList("failed");
const pendingAcceptance = acceptanceList("pending");
const classifiedAcceptance = [...passedAcceptance, ...failedAcceptance, ...pendingAcceptance];
check(
  new Set(requiredAcceptance).size === requiredAcceptance.length,
  "acceptance-required-unique",
  String(requiredAcceptance.length),
);
check(
  new Set(classifiedAcceptance).size === classifiedAcceptance.length,
  "acceptance-state-exclusive",
  String(classifiedAcceptance.length),
);
check(
  requiredAcceptance.length === classifiedAcceptance.length &&
    requiredAcceptance.every((item) => classifiedAcceptance.includes(item)),
  "acceptance-state-complete",
  `${classifiedAcceptance.length}/${requiredAcceptance.length}`,
);
if (segmentCompleted) {
  check(failedAcceptance.length === 0, "completed-without-failures", "true");
  check(pendingAcceptance.length === 0, "completed-without-pending", "true");
  check(
    classifiedAcceptance.length === passedAcceptance.length,
    "completed-all-acceptance-passed",
    `${passedAcceptance.length}/${requiredAcceptance.length}`,
  );
}
if (state.includes("remote_verified: true")) {
  check(passedAcceptance.includes("configured_remote"), "remote-state-consistency", "configured_remote passed");
  check(passedAcceptance.includes("verified_segment_push"), "remote-push-consistency", "verified_segment_push passed");
}

let evidence;
try {
  evidence = JSON.parse(readText("docs/execution/EVIDENCE.json"));
  check(evidence.segment === currentSegment, "evidence-segment", evidence.segment);
  check(evidence.remote === "git@github.com:SunArthurX/saber-harness.git", "evidence-remote", "origin");
  check(evidence.visibility === "PUBLIC", "evidence-visibility", "PUBLIC");
  if (segmentCompleted) check(evidence.status === "completed", "evidence-completion-consistency", evidence.status);
} catch (error) {
  check(false, "evidence-json", error.message);
}

if (evidence?.status === "acceptance_blocked_external") {
  check(
    pendingAcceptance.includes("protected_main_baseline"),
    "blocker-state-consistency",
    "protected_main_baseline pending",
  );
  check(
    evidence.known_blockers?.includes("private-branch-protection-entitlement"),
    "blocker-evidence-consistency",
    "private-branch-protection-entitlement",
  );
}

const textExtensions = new Set([".md", ".yaml", ".yml", ".json", ".mjs", ""]);
const skipDirectories = new Set([".git", "tmp", "node_modules", "target", "dist", "build"]);
// The disposable Code-OSS upstream cache (archive, extracted worktrees and
// the pinned Node toolchain) holds third-party bytes that must never be
// reformatted or scanned as Saber source; it is gitignored and regenerable
// from the digest-verified archive.
const skipPaths = new Set([join("apps", "desktop-codeoss", ".cache")]);
const conflictPattern = /^(<<<<<<<|=======|>>>>>>>)/m;
const secretPatterns = [
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9]{32,}/,
  /sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function scan(directory) {
  for (const entry of readdirSync(directory)) {
    if (skipDirectories.has(entry)) continue;
    const absolute = join(directory, entry);
    const info = lstatSync(absolute);
    check(!info.isSymbolicLink(), "no-symbolic-link", relative(root, absolute));
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      if (skipPaths.has(relative(root, absolute))) continue;
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
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
  const unsafeTracked = tracked.filter(
    (file) => file.startsWith("tmp/") || /(^|\/)\.env(?:\.|$)/.test(file) || /\.(?:pem|key|p12)$/.test(file),
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
