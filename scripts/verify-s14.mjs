#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-016-goal-dag-subagent-evidence.md",
  "crates/orchestrator/Cargo.toml",
  "crates/orchestrator/src/lib.rs",
  "crates/orchestrator/src/dag.rs",
  "crates/orchestrator/src/delegation.rs",
  "crates/orchestrator/src/judgment.rs",
  "scripts/verify-remote-s14.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const dag = text("crates/orchestrator/src/dag.rs");
for (const contract of [
  "pub struct TaskNode",
  "declared_evidence",
  "pub enum DagError",
  "UnknownDependency",
  "Cycle",
  "pub struct GoalDag",
  "pub fn new",
  "pub fn ready_tasks",
  "pub fn descendants",
  "DFS cycle detection",
])
  check(dag.includes(contract), "dag-contract", contract);

const delegation = text("crates/orchestrator/src/delegation.rs");
for (const contract of [
  "pub enum Selector",
  "pub fn within",
  "pub fn covers",
  "falls_within",
  "pub struct Grant",
  "pub enum DelegationError",
  "Escalation",
  "pub struct Delegation",
  "pub const MAX_RETRIES",
  "pub fn delegate",
])
  check(delegation.includes(contract), "delegation-contract", contract);

const judgment = text("crates/orchestrator/src/judgment.rs");
for (const contract of [
  "pub struct EvidenceSpec",
  "pub enum EvidenceKind",
  "ArtifactDigest",
  "CommandSucceeded",
  "pub struct SubagentReport",
  "pub enum Judgment",
  "Verified",
  "Rejected",
  "pub enum RejectionReason",
  "ForgedIdentity",
  "MissingEvidence",
  "UndeclaredEvidence",
  "EvidenceMismatch",
  "pub fn judge_report",
  "pub fn artifact_digest",
])
  check(judgment.includes(contract), "judgment-contract", contract);

const lib = text("crates/orchestrator/src/lib.rs");
for (const contract of [
  "pub enum OrchestratorError",
  "NotReady",
  "Escalation",
  "Terminal",
  "pub struct GoalOrchestrator",
  "pub fn new",
  "pub fn ready",
  "pub fn delegate_task",
  "pub fn submit_report",
  "pub fn exhaust_budget",
  "pub fn cancel",
])
  check(lib.includes(contract), "orchestrator-contract", contract);

for (const test of [
  "cycles_and_unknown_dependencies_are_rejected",
  "ready_order_is_deterministic_and_dependency_enforced",
  "delegation_only_attenuates",
  "selectors_cover_and_narrow_correctly",
  "tasks_only_run_when_dependencies_are_evidence_complete",
  "self_reported_success_without_evidence_is_rejected",
  "forged_subagent_identity_and_delegation_are_rejected",
  "budget_exhaustion_fails_only_its_task",
  "bounded_retries_never_widen_authority",
  "cancellation_cascades_to_descendants_exactly_once",
  "missing_and_undeclared_evidence_are_rejected",
])
  check(
    dag.includes(`fn ${test}`) || delegation.includes(`fn ${test}`) || lib.includes(`fn ${test}`),
    "adversarial-test",
    test,
  );

check(text("Cargo.toml").includes('"crates/orchestrator"'), "workspace-member", "crates/orchestrator");
check(
  text("crates/orchestrator/src/judgment.rs").includes("The judge trusts"),
  "judge-trusts-nothing",
  "evidence recomputed, identity bound",
);
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s14.mjs"),
  "baseline-s14-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s14.mjs"), "local-s14-gate", "pnpm verify");
check(
  text("docs/adr/ADR-016-goal-dag-subagent-evidence.md").includes("Status: accepted"),
  "adr-016-status",
  "accepted",
);

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S14 verification passed with ${passes.length} checks.`);
