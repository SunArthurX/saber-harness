#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");
const json = (path) => JSON.parse(text(path));

const files = [
  "schemas/domain/v1/entities.schema.json",
  "schemas/control/v0/protocol.schema.json",
  "schemas/control/v1/protocol.schema.json",
  "schemas/fixtures/v1/domain-roundtrip.json",
  "schemas/fixtures/v1/control-request.json",
  "scripts/generate-contracts.mjs",
  "scripts/verify-remote-s03.mjs",
  "crates/core-protocol/src/generated.rs",
  "packages/agent-runtime/src/generated/contracts.ts",
  "packages/agent-runtime/src/control.ts",
];
for (const file of files) check(existsSync(join(root, file)), "required-file", file);

const domain = json("schemas/domain/v1/entities.schema.json");
const protocol = json("schemas/control/v1/protocol.schema.json");
const previous = json("schemas/control/v0/protocol.schema.json");
for (const schema of [domain, protocol, previous]) {
  check(schema.$schema === "https://json-schema.org/draft/2020-12/schema", "schema-draft", schema.$id);
  check(
    typeof schema.$id === "string" && schema.$id.startsWith("https://saber.local/schema/"),
    "schema-id",
    schema.$id,
  );
  check(/^\d+\.\d+\.\d+$/.test(schema["x-saber-version"]), "schema-version", schema["x-saber-version"]);
}

const entityNames = [
  "Workspace",
  "Goal",
  "Task",
  "Run",
  "Artifact",
  "Decision",
  "Memory",
  "Capability",
  "Incident",
  "EvolutionCandidate",
];
for (const name of entityNames) check(Boolean(domain.$defs[name]), "domain-entity", name);
for (const [name, definition] of Object.entries(domain.$defs)) {
  if (definition.type === "object") check(definition.additionalProperties === false, "closed-domain-object", name);
}
for (const field of [
  "event_id",
  "schema_version",
  "event_type",
  "occurred_at",
  "workspace_id",
  "actor_id",
  "correlation_id",
  "sensitivity",
  "policy_snapshot_id",
  "payload",
]) {
  check(domain.$defs.EventEnvelope.required.includes(field), "event-envelope-field", field);
}

const methods = protocol.$defs.ControlMethod.enum;
for (const method of ["run.steer", "run.cancel", "run.retry", "run.fork", "events.subscribe"])
  check(methods.includes(method), "control-method", method);
check(protocol.$defs.ControlRequest.additionalProperties === false, "closed-control-request", "ControlRequest");
check(protocol.$defs.RequestContext.additionalProperties === false, "closed-request-context", "RequestContext");
check(
  protocol.$defs.ControlRequest.properties.protocol_version.enum.join(",") === "1.0.0,0.1.0",
  "n-n-minus-1",
  "1.0.0,0.1.0",
);

const rust = text("crates/core-protocol/src/lib.rs");
const typescript = text("packages/agent-runtime/src/control.ts");
for (const contract of [
  "MAX_FRAME_BYTES",
  "DeadlineExceeded",
  "IdempotencyConflict",
  "UnknownMethod",
  "DesktopPlatform",
])
  check(rust.includes(contract), "rust-protocol-contract", contract);
for (const contract of ["MAX_FRAME_BYTES", "deadline_exceeded", "idempotency_required", "unknown_method"])
  check(typescript.includes(contract), "typescript-protocol-contract", contract);
check(text("crates/core-protocol/src/generated.rs").includes("DO NOT EDIT"), "generated-rust", "source banner");
check(
  text("packages/agent-runtime/src/generated/contracts.ts").includes("DO NOT EDIT"),
  "generated-typescript",
  "source banner",
);
check(json("package.json").scripts.verify.includes("generate:check"), "deterministic-codegen-gate", "pnpm verify");
check(
  text(".github/workflows/repository-verification.yml").includes("node scripts/verify-s03.mjs"),
  "baseline-s03-gate",
  "repository-verification",
);

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S03 verification passed with ${passes.length} checks.`);
