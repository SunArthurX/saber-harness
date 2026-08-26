#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "schemas/capabilities/v1/capability.schema.json",
  "schemas/capabilities/v1/vocabulary.json",
  "crates/policy/Cargo.toml",
  "crates/policy/src/lib.rs",
  "crates/policy/src/approval.rs",
  "crates/policy/src/audit.rs",
  "crates/policy/src/vocabulary.rs",
  "scripts/verify-remote-s05.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const schema = JSON.parse(text("schemas/capabilities/v1/capability.schema.json"));
const registry = JSON.parse(text("schemas/capabilities/v1/vocabulary.json"));
check(schema.$schema === "https://json-schema.org/draft/2020-12/schema", "schema-draft", schema.$schema);
check(schema["x-saber-version"] === "1.0.0", "schema-version", schema["x-saber-version"]);
check(registry.schema_version === "1.0.0", "vocabulary-version", registry.schema_version);
const schemaActions = schema.$defs.Action.enum;
const registryActions = registry.actions.map((entry) => entry.name);
check(schemaActions.length === 19, "closed-action-count", schemaActions.length);
check(new Set(schemaActions).size === schemaActions.length, "unique-schema-actions", schemaActions.length);
check(new Set(registryActions).size === registryActions.length, "unique-registry-actions", registryActions.length);
check(JSON.stringify(schemaActions) === JSON.stringify(registryActions), "schema-registry-parity", "ordered actions");
check(!schemaActions.includes("system.all"), "no-ambient-super-capability", "system.all");
for (const family of ["fs.", "process.", "network.", "secret.", "git.", "external.", "self."])
  check(
    schemaActions.some((action) => action.startsWith(family)),
    "required-action-family",
    family,
  );
for (const entry of registry.actions) {
  check(["low", "moderate", "high", "critical"].includes(entry.risk), "registry-risk", `${entry.name}:${entry.risk}`);
  check(
    ["never", "risk_based", "always"].includes(entry.approval),
    "registry-approval",
    `${entry.name}:${entry.approval}`,
  );
  check(
    typeof entry.persistable === "boolean" &&
      typeof entry.requires_sandbox === "boolean" &&
      typeof entry.requires_secret === "boolean" &&
      typeof entry.requires_network === "boolean",
    "registry-boundaries",
    entry.name,
  );
}
check(schema.$defs.ToolManifest.additionalProperties === false, "closed-tool-manifest", "additionalProperties=false");
check(
  schema.$defs.CapabilityDeclaration.required.join(",") === "action,resource",
  "typed-manifest-capability",
  "action+resource",
);
check(
  schema.$defs.CapabilityRequest.required.join(",") ===
    "request_id,principal,workspace_id,task_id,action,resource,operation_hash,credential_ref,sandboxed,data_class,occurred_at_ms",
  "rust-request-schema-shape",
  "exact bound request fields",
);

const policy = text("crates/policy/src/lib.rs");
for (const contract of [
  "pub struct CapabilityRequest",
  "pub enum PolicyTier",
  "PlatformHard",
  "Regulatory",
  "Organization",
  "Workspace",
  "User",
  "TaskGrant",
  "pub struct PolicyEngine",
  "pub fn update",
  "DecisionOutcome::Deny",
  "DecisionReason::DefaultDeny",
  "DecisionReason::PolicyUnavailable",
  "DecisionReason::SandboxRequired",
  "DecisionReason::ApprovalRequired",
  "pub struct PolicyEnforcer",
  "record_decision",
  "record_enforcement",
])
  check(policy.includes(contract), "policy-contract", contract);
for (const test of [
  "frozen_vocabulary_matches_canonical_registry",
  "deserialized_request_cannot_bypass_resource_validation",
  "policy_is_default_deny_and_any_higher_restriction_wins",
  "policy_update_rejects_rollback_reuse_and_tier_removal",
  "unavailable_policy_and_audit_fail_before_effect",
  "approval_is_exact_expiring_revocable_and_one_shot",
  "failed_audit_does_not_consume_one_shot_approval",
  "permit_that_needs_no_approval_does_not_consume_supplied_grant",
  "approval_detects_toctou_expiry_revocation_and_vague_ui",
  "persisted_audit_excludes_secret_resource_and_free_text",
])
  check(policy.includes(`fn ${test}`), "policy-adversarial-test", test);

const approval = text("crates/policy/src/approval.rs");
for (const contract of [
  "MAX_APPROVAL_TTL_MS",
  "ApprovalScope::Task",
  "request_digest",
  "expires_at_ms",
  "validate_and_consume",
  "ApprovalExpired",
  "ApprovalRevoked",
  "ApprovalReplayed",
  "ApprovalBindingMismatch",
  "allow everything",
])
  check(approval.includes(contract), "approval-contract", contract);

const audit = text("crates/policy/src/audit.rs");
for (const contract of [
  "PolicyDecisionAudit",
  "principal_hash",
  "resource_hash",
  "context_hash",
  "policy_snapshot_id",
  "DecisionAuditSink",
  "EnforcementResult",
])
  check(audit.includes(contract), "redacted-audit-contract", contract);

const store = text("crates/event-store/src/lib.rs");
for (const contract of [
  "const SCHEMA_VERSION: i64 = 3",
  "CREATE TABLE policy_decisions",
  "policy.decision_recorded",
  "policy.enforcement_recorded",
  "impl DecisionAuditSink for EventStore",
  "PolicyAuditConflict",
  "policy_decision_and_enforcement_are_encrypted_transactional_facts",
])
  check(store.includes(contract), "durable-policy-audit", contract);

check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s05.mjs"),
  "baseline-s05-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s05.mjs"), "local-s05-gate", "pnpm verify");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S05 verification passed with ${passes.length} checks.`);
