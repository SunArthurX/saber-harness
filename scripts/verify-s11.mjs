#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-013-untrusted-renderer-crash-safe-runview.md",
  "packages/ide-client/package.json",
  "packages/ide-client/tsconfig.json",
  "packages/ide-client/src/index.ts",
  "packages/ide-client/src/protocol.ts",
  "packages/ide-client/src/runView.ts",
  "packages/ide-client/src/approvalCard.ts",
  "packages/ide-client/src/contextPanel.ts",
  "packages/ide-client/test/ideClient.test.mjs",
  "scripts/verify-remote-s11.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const protocol = text("packages/ide-client/src/protocol.ts");
for (const contract of [
  "export const MAX_FRAME_BYTES",
  'export const CURRENT_PROTOCOL_VERSION = "1.0.0"',
  'export const PREVIOUS_PROTOCOL_VERSION = "0.1.0"',
  "export type IdeMethod",
  '"approval.resolve"',
  '"context.exclude"',
  '"context.revoke"',
  "export class ProtocolViolation",
  "incompatible_protocol",
  "unknown_method",
  "invalid_actor",
  "deadline_exceeded",
  "frame_too_large",
  "export function encodeRequest",
  "export interface CoreTransport",
  "export class IdeClient",
  "send(frame: EncodedFrame): void",
])
  check(protocol.includes(contract), "protocol-contract", contract);

const runView = text("packages/ide-client/src/runView.ts");
for (const contract of [
  "export interface RunEvent",
  "export interface RunEventSource",
  "readAfter",
  "export interface RunViewState",
  "export class RunView",
  "get cursor",
  "refresh",
  "export function replayPresentation",
  "no run state",
])
  check(runView.includes(contract), "runview-contract", contract);

const approval = text("packages/ide-client/src/approvalCard.ts");
for (const contract of [
  'export const APPROVAL_DENY_LABEL = "deny"',
  "export interface ApprovalRequestView",
  "export interface ApprovalCard",
  "export class ApprovalCardViolation",
  "scope_broader_than_request",
  "missing_deny_alternative",
  "expired",
  "choice_not_offered",
  "export function approvalCardFor",
  "export function approvalResolveIntent",
  "never broader",
])
  check(approval.includes(contract), "approval-contract", contract);

const panel = text("packages/ide-client/src/contextPanel.ts");
for (const contract of [
  'export const REDACTED_MARKER = "[saber:redacted]"',
  "export interface ExplanationView",
  "export class ContextPanelViolation",
  "redacted_field_leak",
  "export function contextPanelFor",
  "export function excludeIntent",
  "export function revokeIntent",
  '"context.exclude"',
  '"context.revoke"',
])
  check(panel.includes(contract), "panel-contract", contract);

const tests = text("packages/ide-client/test/ideClient.test.mjs");
for (const test of [
  "renderer crash mid-run leaves run state untouched and replay identical",
  "version, method, frame-size, deadline and identity violations fail closed pre-send",
  "client surface exposes no effect path outside the protocol",
  "approval cards cannot outscope their request, outlive their TTL or hide deny",
  "explanations render markers only and intents stay protocol-bound",
])
  check(tests.includes(`test("${test}"`), "adversarial-test", test);

check(
  text("package.json").includes("--filter @saber/ide-client build"),
  "build-wired",
  "pnpm build includes ide-client",
);
check(
  text("package.json").includes("--filter @saber/ide-client typecheck"),
  "typecheck-wired",
  "pnpm typecheck includes ide-client",
);
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s11.mjs"),
  "baseline-s11-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s11.mjs"), "local-s11-gate", "pnpm verify");
check(
  text("docs/adr/ADR-013-untrusted-renderer-crash-safe-runview.md").includes("Status: accepted"),
  "adr-013-status",
  "accepted",
);

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S11 verification passed with ${passes.length} checks.`);
