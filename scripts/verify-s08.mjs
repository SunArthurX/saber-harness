#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const files = [
  "docs/adr/ADR-010-policy-bound-model-layer.md",
  "crates/model-providers/Cargo.toml",
  "crates/model-providers/src/lib.rs",
  "crates/model-providers/src/spi.rs",
  "crates/model-providers/src/provider.rs",
  "crates/model-providers/src/adapters.rs",
  "crates/model-providers/src/registry.rs",
  "crates/model-providers/src/router.rs",
  "crates/model-providers/src/budget.rs",
  "crates/model-providers/src/invoker.rs",
  "crates/model-providers/src/probe.rs",
  "scripts/verify-remote-s08.mjs",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const spi = text("crates/model-providers/src/spi.rs");
for (const contract of [
  'pub const MODEL_SPI_VERSION: &str = "1.0.0"',
  'pub const MODEL_EGRESS_PURPOSE: &str = "model-provider"',
  "pub enum Role",
  "pub struct ModelMessage",
  "pub struct ToolDeclaration",
  "pub struct ToolCall",
  "pub struct StructuredOutput",
  "pub struct UsageRecord",
  "pub const fn is_meaningful",
  "pub enum FinishReason",
  "pub enum StreamEvent",
  "MessageStart",
  "TextDelta",
  "ToolCallDelta",
  "Usage {",
  "Done {",
  "pub enum ModelError",
  "pub const fn retryable",
  "pub struct ModelResponse",
  "pub struct ModelRequest",
  "pub fn validate",
  "pub struct WireRequest",
  "credential_header",
  "[redacted]",
  "pub struct StreamOutcome",
  "cancelled: bool",
])
  check(spi.includes(contract), "spi-contract", contract);

const provider = text("crates/model-providers/src/provider.rs");
for (const contract of [
  "pub enum ApiFamily",
  "OpenAiCompatible",
  "AnthropicCompatible",
  "Ollama",
  "pub enum Residency",
  "OnDevice",
  "pub struct Capabilities",
  "pub const fn covers",
  "pub struct CostProfile",
  "estimate_micro",
  "pub struct EndpointSpec",
  "pub struct ModelEntry",
  "max_data_class",
  "pub trait ModelProvider",
  "fn translate",
  "fn parse_response",
  "fn parse_stream_chunk",
  "require_success_payload",
  "pub fn map_status",
])
  check(provider.includes(contract), "provider-contract", contract);

const adapters = text("crates/model-providers/src/adapters.rs");
for (const contract of [
  "pub struct OpenAiAdapter",
  "pub struct AnthropicAdapter",
  "pub struct OllamaAdapter",
  "/v1/chat/completions",
  "/v1/messages",
  "/api/chat",
  "json_schema",
  "input_schema",
  "prompt_tokens",
  "completion_tokens",
  "input_tokens",
  "output_tokens",
])
  check(adapters.includes(contract), "adapter-contract", contract);

const registry = text("crates/model-providers/src/registry.rs");
for (const contract of [
  "pub enum RegistryError",
  "DigestMismatch",
  "Rollback",
  "pub struct RegistryRecord",
  "content_digest",
  "pub struct ModelRegistry",
  "pub fn new",
  "pub fn update",
  "snapshot_id",
  "pub fn canonical_digest",
  "pub fn record_for",
])
  check(registry.includes(contract), "registry-contract", contract);

const router = text("crates/model-providers/src/router.rs");
for (const contract of [
  "pub enum RouteError",
  "NoAdmissibleProvider",
  "BudgetExhausted",
  "pub struct RouteRequest",
  "data_class",
  "residency",
  "budget_remaining_tokens",
  "pub struct RouteDecision",
  "registry_snapshot_id",
  "pub struct ModelRouter",
  "pub fn route",
  "quality_tier",
])
  check(router.includes(contract), "router-contract", contract);

const budget = text("crates/model-providers/src/budget.rs");
for (const contract of [
  "pub struct TaskBudget",
  "pub fn new",
  "pub const fn remaining",
  "pub fn consume",
  "pub fn refund",
  "pub const fn affords",
  "pub fn drive_stream",
  "BudgetExhausted",
  "StreamAborted",
  "pub struct RetryPolicy",
  "pub const fn permits",
  "retryable()",
])
  check(budget.includes(contract), "budget-contract", contract);

const invoker = text("crates/model-providers/src/invoker.rs");
for (const contract of [
  "pub trait ModelTransport",
  "authorization: &saber_egress::EgressAuthorization",
  "credential: Option<&saber_secret_broker::LeaseMaterial>",
  "fn call_count",
  "pub enum InvokeError",
  "Route(",
  "EgressDenied",
  "Secret(",
  "Model(",
  "pub struct ModelInvoker",
  "pub fn invoke",
  "MODEL_EGRESS_PURPOSE",
  "credential://broker/provider-",
  "silent substitution is a policy bypass",
  "RetryPolicy",
])
  check(invoker.includes(contract), "invoker-contract", contract);

const probe = text("crates/model-providers/src/probe.rs");
for (const contract of [
  "pub struct ProbeReport",
  "basic_ok",
  "streaming_ok",
  "tools_ok",
  "pub const fn certifies",
  "pub fn exclusions_from_reports",
  "pub fn probe_model",
])
  check(probe.includes(contract), "probe-contract", contract);

const lib = text("crates/model-providers/src/lib.rs");
for (const test of [
  "openai_translation_and_parsing_roundtrip",
  "anthropic_translation_and_parsing_roundtrip",
  "ollama_translation_and_stream_parsing",
  "provider_success_without_usage_is_rejected",
  "stream_without_terminal_event_aborts",
  "egress_denial_executes_zero_transport_calls",
  "happy_invocation_verifies_usage_and_leases_credentials",
  "restricted_data_never_routes_to_lower_ceiling",
  "router_is_deterministic_and_fails_closed_on_budget",
  "budget_exhaustion_midstream_cancels_with_partial_usage",
  "retries_are_bounded_and_only_retryable",
  "registry_rejects_digest_mismatch_and_rollback",
  "wire_request_never_renders_credentials_or_body",
  "probe_reports_certify_capabilities_and_drive_exclusions",
])
  check(lib.includes(`fn ${test}`), "adversarial-test", test);

check(text("Cargo.toml").includes('"crates/model-providers"'), "workspace-member", "crates/model-providers");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s08.mjs"),
  "baseline-s08-gate",
  "repository-verification",
);
check(text("package.json").includes("node scripts/verify-s08.mjs"), "local-s08-gate", "pnpm verify");
check(text("docs/adr/ADR-010-policy-bound-model-layer.md").includes("Status: accepted"), "adr-010-status", "accepted");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S08 verification passed with ${passes.length} checks.`);
