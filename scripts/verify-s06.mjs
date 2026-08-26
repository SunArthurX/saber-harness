#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-008-sandbox-secret-egress-fail-closed-boundaries.md",
  "schemas/sandbox/v1/platform-matrix.json",
  "schemas/sandbox/v1/matrix.json",
  "crates/sandbox/Cargo.toml",
  "crates/sandbox/src/lib.rs",
  "crates/sandbox/src/plan.rs",
  "crates/sandbox/src/path.rs",
  "crates/sandbox/src/environment.rs",
  "crates/sandbox/src/spi.rs",
  "crates/sandbox/src/registry.rs",
  "crates/sandbox/src/fake.rs",
  "crates/sandbox/src/process.rs",
  "crates/sandbox/src/platform.rs",
  "crates/secret-broker/Cargo.toml",
  "crates/secret-broker/src/lib.rs",
  "crates/egress/Cargo.toml",
  "crates/egress/src/lib.rs",
  "crates/effect-broker/Cargo.toml",
  "crates/effect-broker/src/lib.rs",
  "crates/effect-broker/src/journal.rs",
  "crates/effect-broker/src/plugin_host.rs",
  "crates/effect-broker/tests/journal_integration.rs",
  "scripts/verify-remote-s06.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const matrixSchema = JSON.parse(text("schemas/sandbox/v1/platform-matrix.json"));
const matrix = JSON.parse(text("schemas/sandbox/v1/matrix.json"));
check(matrixSchema["$id"].endsWith("sandbox/v1/platform-matrix.json"), "matrix-schema-id", "platform-matrix.json");
check(matrixSchema["x-saber-version"] === "1.0.0", "matrix-schema-version", matrixSchema["x-saber-version"]);
check(matrixSchema.properties.spi_version.const === matrix.spi_version, "spi-version-parity", matrix.spi_version);
check(matrix.schema_version === "1.0.0", "matrix-data-version", matrix.schema_version);
const realms = matrix.realms;
check(
  JSON.stringify(realms) ===
    JSON.stringify([
      "s0_pure",
      "s1_guarded_read",
      "s2_isolated_read_only",
      "s3_isolated_overlay",
      "s4_egress_mediated",
    ]),
  "realm-ladder-parity",
  realms.join(","),
);
const platforms = Object.fromEntries(matrix.platforms.map((entry) => [entry.platform, entry]));
check(platforms.macos?.backend_id === "darwin://seatbelt-v1", "macos-backend", platforms.macos?.backend_id);
check(platforms.linux?.backend_id === "linux://bwrap-v1", "linux-backend", platforms.linux?.backend_id);
check(platforms.windows?.backend_id === "windows://none-v1", "windows-fail-closed", platforms.windows?.backend_id);
check(platforms.windows?.max_realm === "s1_guarded_read", "windows-no-s2-plus", platforms.windows?.max_realm);
for (const entry of matrix.platforms) check(entry.self_tested === true, "backend-self-tested", entry.backend_id);

const plan = text("crates/sandbox/src/plan.rs");
for (const contract of [
  "pub enum Realm",
  "S0Pure",
  "S1GuardedRead",
  "S2IsolatedReadOnly",
  "S3IsolatedOverlay",
  "S4EgressMediated",
  "pub struct SandboxPlan",
  "pub fn validate",
  "PlanError::RealmViolation",
  "PlanError::MountConflict",
  "PlanError::InvalidEnvironment",
  "PlanError::InvalidCommand",
])
  check(plan.includes(contract), "sandbox-plan-contract", contract);
for (const test of [
  "realm_ladder_is_monotonic",
  "realm_governs_mounts_command_and_network",
  "mount_targets_reject_traversal_duplicates_and_writability_lies",
  "environment_allowlist_rejects_sensitive_and_unconfined_path",
  "commands_must_resolve_inside_executable_mounts",
  "digest_binds_exact_plan_content",
])
  check(plan.includes(`fn ${test}`), "sandbox-plan-test", test);

const pathGuard = text("crates/sandbox/src/path.rs");
for (const contract of [
  "pub struct PathGuard",
  "PathError::Traversal",
  "PathError::SymlinkComponent",
  "PathError::RaceDetected",
  "PathError::Escape",
  "fn resolve_for_create",
  "fn verify_identity",
])
  check(pathGuard.includes(contract), "path-guard-contract", contract);
for (const test of [
  "rejects_absolute_relative_and_encoded_traversal",
  "rejects_symlink_parent_and_swapped_target",
  "detects_symlink_swap_between_resolve_and_open",
  "normalizes_curdir_and_resolves_inside",
  "root_must_be_canonical_directory",
])
  check(pathGuard.includes(`fn ${test}`), "path-guard-test", test);

const environment = text("crates/sandbox/src/environment.rs");
for (const contract of [
  "SENSITIVE_ENV_KEYS",
  "SSH_AUTH_SOCK",
  "is_sensitive_key",
  "is_reserved_env_key",
  "pub fn build_environment",
  "RedactableValue",
  "[redacted]",
])
  check(environment.includes(contract), "environment-contract", contract);
for (const test of [
  "sensitive_keys_are_rejected_by_exact_name_and_pattern",
  "built_environment_contains_only_declared_entries",
  "host_environment_cannot_leak_through_construction",
  "redactable_value_never_prints_material",
])
  check(environment.includes(`fn ${test}`), "environment-test", test);

const spi = text("crates/sandbox/src/spi.rs");
for (const contract of [
  'pub const SPI_VERSION: &str = "1.0.0"',
  "pub trait SandboxBackend",
  "fn create",
  "fn mount",
  "fn network",
  "fn exec",
  "fn kill",
  "fn snapshot",
  "fn destroy",
  "fn health",
  "pub struct BackendDescriptor",
  "isolation_self_tested",
  "pub fn covers",
])
  check(spi.includes(contract), "sandbox-spi-contract", contract);

const registry = text("crates/sandbox/src/registry.rs");
for (const contract of [
  "pub struct BackendRegistry",
  "pub fn for_current_platform",
  "pub fn select_for",
  "SandboxError::BackendUnavailable",
  "descriptor.production",
  "descriptor.isolation_self_tested",
  "health().healthy",
])
  check(registry.includes(contract), "fail-closed-registry", contract);
for (const test of [
  "production_registry_never_selects_non_production_backends",
  "unhealthy_and_uncovered_backends_are_skipped_fail_closed",
  "current_platform_registry_is_fail_closed_for_confined_children",
  "s1_plans_select_the_guarded_backend_everywhere",
])
  check(registry.includes(`fn ${test}`), "registry-test", test);

const processBackend = text("crates/sandbox/src/process.rs");
for (const contract of [
  "pub fn run_scrubbed_child",
  "env_clear",
  "process_group(0)",
  "SandboxError::BackendUnavailable",
  "structural_inventory",
])
  check(processBackend.includes(contract), "guarded-process-contract", contract);
for (const test of [
  "any_child_plan_is_refused_fail_closed",
  "environment_canary_finds_no_sensitive_host_authority",
  "output_cap_truncates_large_streams",
])
  check(processBackend.includes(`fn ${test}`), "guarded-process-test", test);

const platformBackends = text("crates/sandbox/src/platform.rs");
for (const contract of [
  "pub enum WrapperKind",
  "DarwinSeatbelt",
  "LinuxBwrap",
  "probe_write_escape",
  "probe_overlay_denied",
  "unshare-net",
  "deny network*",
])
  check(platformBackends.includes(contract), "platform-backend-contract", contract);
for (const test of ["wrapper_backends_report_honest_platform_health", "unhealthy_wrapper_refuses_every_operation"])
  check(platformBackends.includes(`fn ${test}`), "platform-backend-test", test);

const secrets = text("crates/secret-broker/src/lib.rs");
for (const contract of [
  "credential://broker/",
  "pub const MAX_LEASE_MS",
  "pub struct LeaseRequest",
  "pub struct SecretLease",
  "request_digest",
  "BrokerError::Replay",
  "BrokerError::DigestMismatch",
  "pub fn issue",
  "pub fn consume",
  "pub fn revoke_reference",
  "pub fn sweep",
  "pub fn redact",
  "Zeroizing",
  "REDACTION_MARKER",
])
  check(secrets.includes(contract), "secret-broker-contract", contract);
for (const test of [
  "references_are_opaque_and_validated",
  "leases_enforce_scope_purpose_and_ttl",
  "consumption_is_single_shot_digest_bound_and_revocable",
  "expiry_sweep_revokes_and_blocks_after_crash_window",
  "redaction_masks_material_in_stdout_stderr_and_files",
  "lease_material_never_renders_in_debug",
])
  check(secrets.includes(`fn ${test}`), "secret-broker-test", test);

const egress = text("crates/egress/src/lib.rs");
for (const contract of [
  "pub enum TaintKind",
  "pub enum RedirectPolicy",
  "pub struct EgressRule",
  "pub struct EgressEngine",
  "pub fn authorize",
  "pub fn validate_resolution",
  "pub fn authorize_redirect",
  "pub fn verify_connection",
  "EgressReason::DefaultDeny",
  "EgressReason::TaintedPayload",
  "EgressReason::MetadataEndpointDenied",
  "EgressReason::PrivateRangeDenied",
  "EgressReason::ResolutionDenied",
  "parse_ipv4_literal",
  "is_blocked_address",
  "is_metadata_host",
])
  check(egress.includes(contract), "egress-contract", contract);
for (const test of [
  "default_deny_without_matching_purpose_or_host",
  "schemes_classification_and_taint_are_enforced",
  "ip_literals_and_alternate_encodings_are_blocked",
  "parsing_recognizes_every_literal_encoding",
  "blocked_ranges_cover_private_linklocal_and_metadata",
  "dns_rebinding_requires_pinned_revalidation",
  "redirects_follow_policy_and_revalidate",
  "policy_construction_rejects_malformed_rules",
])
  check(egress.includes(`fn ${test}`), "egress-test", test);

const broker = text("crates/effect-broker/src/lib.rs");
for (const contract of [
  "pub struct EffectBroker",
  "pub struct IsolatedEffect",
  "pub fn prepare",
  "pub fn execute",
  "BrokerFailure::Sandbox",
  "BrokerFailure::EgressDenied",
  "BrokerFailure::Secret",
  "BrokerFailure::Journal",
  "BrokerFailure::AuditBefore",
  "record_intent",
  "destroy_realm",
  "secrets.redact",
])
  check(broker.includes(contract), "effect-broker-contract", contract);
for (const test of [
  "happy_path_executes_realm_and_journals_intent_and_result",
  "policy_denial_leaves_zero_effects_and_no_realm",
  "journal_failure_runs_zero_effects",
  "egress_default_deny_blocks_network_actions_without_request",
  "unavailable_backend_denies_fail_closed",
  "audit_failure_runs_zero_effects",
  "secret_lease_failures_execute_zero_effects",
  "healthy_secret_lease_injects_and_redacts",
])
  check(broker.includes(`fn ${test}`), "effect-broker-test", test);

const pluginHost = text("crates/effect-broker/src/plugin_host.rs");
for (const contract of [
  "pub struct PluginManifest",
  "content_digest",
  "HostError::DigestMismatch",
  "HostError::RealmTooHigh",
  "HostError::Quarantined",
  "HostError::CircuitOpen",
  "pub fn admit",
  "pub fn quarantine",
  "CIRCUIT_FAILURE_THRESHOLD",
  "constant_time_eq",
])
  check(pluginHost.includes(contract), "plugin-host-contract", contract);
for (const test of [
  "admission_requires_matching_digest_and_closed_actions",
  "fault_domain_opens_circuit_then_stays_contained",
  "one_plugin_fault_does_not_touch_neighbors",
])
  check(pluginHost.includes(`fn ${test}`), "plugin-host-test", test);

const journal = text("crates/effect-broker/src/journal.rs");
for (const contract of [
  "pub trait EffectJournal",
  "impl EffectJournal for EventStore",
  "record_effect_intent",
  "record_effect_result",
])
  check(journal.includes(contract), "durable-journal-contract", contract);

const integration = text("crates/effect-broker/tests/journal_integration.rs");
for (const contract of [
  "intent_and_result_are_durable_in_the_encrypted_store",
  "broker_execution_journals_through_the_real_store",
  "pending_effects",
])
  check(integration.includes(contract), "journal-integration", contract);

check(
  text("crates/sandbox/src/lib.rs").includes("realm_ladder_matches_platform_matrix_schema_data"),
  "matrix-parity-test",
  "sandbox lib test",
);
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s06.mjs"),
  "baseline-s06-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s06.mjs"), "local-s06-gate", "pnpm verify");
check(
  text("Cargo.toml").includes('"crates/sandbox"') &&
    text("Cargo.toml").includes('"crates/secret-broker"') &&
    text("Cargo.toml").includes('"crates/egress"') &&
    text("Cargo.toml").includes('"crates/effect-broker"'),
  "workspace-members",
  "four new crates registered",
);

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S06 verification passed with ${passes.length} checks.`);
