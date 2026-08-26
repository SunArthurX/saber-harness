#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-009-tool-lifecycle-verification.md",
  "crates/tool-broker/Cargo.toml",
  "crates/tool-broker/src/lib.rs",
  "crates/tool-broker/src/worktree.rs",
  "crates/tool-broker/tests/crash_replay.rs",
  "scripts/verify-remote-s07.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const lib = text("crates/tool-broker/src/lib.rs");
for (const contract of [
  "pub enum ToolName",
  "pub fn describe",
  "pub struct ToolDescriptor",
  "pub enum ToolArgs",
  "Patch {",
  "declared_outputs",
  "pub enum VerificationEvidence",
  "InventoryDelta {",
  "missing:",
  "pub enum FailureKind",
  "NonRetriable",
  "NeedsReconcile",
  "pub struct ToolBroker",
  "pub fn run<JournalError>",
  "pub fn prepare_invocation",
  "ToolFailure::Contract",
  "ToolFailure::WorktreeBusy",
  "ToolFailure::Verify {",
  "ToolError::OverlayNotDeclared",
  "ToolError::OverlayRequired",
  'effect_kind: "tool.verify"',
  "verification_failed_non_retriable",
  "verification_failed_needs_reconcile",
  "A tool that declared outputs must produce them",
  "pub fn readonly_plan",
  "pub fn mutation_plan",
  "pub fn tool_request",
])
  check(lib.includes(contract), "tool-broker-contract", contract);

for (const test of [
  "readonly_tools_verify_independently",
  "forged_success_is_rejected_and_compensated",
  "patch_happy_path_verifies_and_journals",
  "stale_before_hash_never_patches",
  "mutation_outside_declared_overlay_is_denied",
  "external_edit_requires_reconcile",
  "git_index_drift_requires_reconcile",
  "compensation_failure_is_durably_non_retriable",
  "broker_failure_releases_worktree_and_retry_succeeds",
  "forged_success_cannot_hide_behind_exit_status",
  "contract_gates_arguments_before_authorization",
  "mutation_without_overlay_root_is_denied",
  "ops_sink_observes_full_lifecycle_ordering",
])
  check(lib.includes(`fn ${test}`), "tool-broker-test", test);

const worktree = text("crates/tool-broker/src/worktree.rs");
for (const contract of [
  "pub struct Checkpoint",
  "pub fn capture",
  "pub fn restore",
  "pub fn inventory",
  "pub fn overlay_fingerprint",
  "pub fn git_status_digest",
  "pub struct WorktreeManager",
  "pub fn try_lock",
  "WorktreeError::RestoreIncomplete",
])
  check(worktree.includes(contract), "worktree-contract", contract);
for (const test of [
  "checkpoint_restores_exactly_including_removals",
  "fingerprint_changes_on_content_and_git_drift",
  "git_index_drift_changes_digest",
  "second_mutation_on_same_root_is_refused",
])
  check(worktree.includes(`fn ${test}`), "worktree-test", test);

const crash = text("crates/tool-broker/tests/crash_replay.rs");
for (const contract of [
  "crash_between_intent_and_result_replays_exactly_once",
  "verification_failure_is_durable_in_the_store",
  "pending_effects",
  "the effect ran exactly once",
  "The journal and the overlay must never share a directory",
])
  check(crash.includes(contract), "crash-replay-contract", contract);

const effectBroker = text("crates/effect-broker/src/lib.rs");
check(
  effectBroker.includes("// In-core (S0/S1) plans execute no child"),
  "in-core-effect-path",
  "command-less S1 plans",
);
const journal = text("crates/effect-broker/src/journal.rs");
check(journal.includes("pub detail: Option<&'a str>"), "journal-detail", "verification verdict label");
check(
  text("crates/sandbox/src/fake.rs").includes("pub exec_hook"),
  "test-interference-hook",
  "mid-run external drift injection",
);

check(text("Cargo.toml").includes('"crates/tool-broker"'), "workspace-member", "crates/tool-broker");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s07.mjs"),
  "baseline-s07-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s07.mjs"), "local-s07-gate", "pnpm verify");
check(
  text("docs/adr/ADR-009-tool-lifecycle-verification.md").includes("Status: accepted"),
  "adr-009-status",
  "accepted",
);
check(text("docs/execution/DECISIONS.md").includes("DEC-0011"), "dec-0011-recorded", "FR-RUN-006 realignment");
check(text("docs/traceability.yaml").includes("FR-RUN-005"), "fr-run-005-served", "tool broker evidence");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S07 verification passed with ${passes.length} checks.`);
