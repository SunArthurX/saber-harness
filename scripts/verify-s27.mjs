#!/usr/bin/env node
/**
 * S27 focused verifier — Core supervision and transport contracts.
 *
 * Deterministic, offline, binary-independent: it checks that the versioned
 * lifecycle surface exists identically on both sides of the wire (schema →
 * generated Rust → generated TypeScript → ide-client registry), that the
 * local endpoint hardening, one-time-token handshake and cursor replay are
 * implemented where they must be, and that the renderer bridge stays a
 * frozen allowlist with no host capability. The real-binary transport,
 * adversarial and crash-matrix evidence runs in the ide-client tests
 * (desktop:test:transport, desktop:test:crash-matrix).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");
const normalized = (value) => value.replace(/\s+/g, " ");

const requiredFiles = [
  "crates/saber-core/src/serve.rs",
  "crates/event-store/src/lib.rs",
  "crates/core-protocol/src/lib.rs",
  "crates/core-protocol/src/generated.rs",
  "packages/agent-runtime/src/generated/contracts.ts",
  "packages/ide-client/src/protocol.ts",
  "packages/ide-client/src/supervision.ts",
  "packages/ide-client/test/supervision.test.mjs",
  "packages/ide-client/test/crashMatrix.test.mjs",
  "apps/desktop-codeoss/extensions/saber-agent/src/bridge.js",
  "scripts/tests/s27-desktop-bridge.test.mjs",
  "apps/desktop-codeoss/scripts/core-supervisor.mjs",
  "apps/desktop-codeoss/scripts/test-core-supervisor.mjs",
  "packages/ide-client/test/adversarial.test.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s27-required-file", file);
}

// Contract parity: schema → generated Rust → generated TS → ide-client.
const schema = text("schemas/control/v1/protocol.schema.json");
check(schema.includes('"core.initialize"'), "s27-schema-method", "core.initialize");
check(schema.includes('"core.health"'), "s27-schema-method", "core.health");
const generatedRust = text("crates/core-protocol/src/generated.rs");
check(generatedRust.includes("CoreInitialize"), "s27-generated-rust", "CoreInitialize");
check(generatedRust.includes("CoreHealth"), "s27-generated-rust", "CoreHealth");
const generatedTs = text("packages/agent-runtime/src/generated/contracts.ts");
check(generatedTs.includes("core.initialize"), "s27-generated-ts", "core.initialize");
check(generatedTs.includes("core.health"), "s27-generated-ts", "core.health");
const ideProtocol = text("packages/ide-client/src/protocol.ts");
check(ideProtocol.includes('"core.initialize"'), "s27-ide-registry", "core.initialize");
check(ideProtocol.includes('"core.health"'), "s27-ide-registry", "core.health");
const coreProtocol = text("crates/core-protocol/src/lib.rs");
for (const lifecycle of ["core.initialize", "core.health"]) {
  check(coreProtocol.includes(lifecycle), "s27-rust-decoder", lifecycle);
}
check(
  coreProtocol.includes("ControlMethod::EventsSubscribe | ControlMethod::CoreInitialize | ControlMethod::CoreHealth"),
  "s27-lifecycle-non-mutation",
  "handshake and health require no idempotency key",
);

// Endpoint hardening and one-time token handshake (S27-WP02).
const serve = text("crates/saber-core/src/serve.rs");
for (const contract of [
  "from_mode(0o600)",
  "refusing endpoint",
  "symlink",
  "already serving",
  "bootstrap-token",
  "getrandom::fill",
  "token_spent",
  "unauthorized",
]) {
  check(serve.includes(contract), "s27-serve-hardening", contract);
}
check(
  serve.includes("std::thread::spawn"),
  "s27-serve-concurrent",
  "one thread per connection so long-lived peers cannot starve each other",
);
check(
  serve.includes("windows named-pipe transport is not implemented"),
  "s27-serve-windows-fail-closed",
  "no half transport on Windows",
);
check(serve.includes("replay_events"), "s27-serve-replay", "cursor-ordered replay from the encrypted store");

// Cursor replay is read-only and bounded (S27-WP03).
const store = text("crates/event-store/src/lib.rs");
check(store.includes("pub fn replay_events"), "s27-store-replay", "replay_events");
check(store.includes("clamp(1, 500)"), "s27-store-replay-bound", "page size clamp");
check(store.includes("pub struct ReplayedEvent"), "s27-store-replayed-event", "typed replay projection");

// Client: lifecycle machine, bounded frames, cursor acknowledgement.
const supervision = text("packages/ide-client/src/supervision.ts");
for (const state of [
  '"booting"',
  '"starting_core"',
  '"attaching"',
  '"ready"',
  '"incompatible"',
  '"reconnecting"',
  '"degraded"',
  '"safe_mode"',
  '"stopping"',
  '"stopped"',
]) {
  check(supervision.includes(state), "s27-lifecycle-state", state);
}
for (const contract of [
  "MAX_LINE_BYTES",
  "deadline_exceeded",
  "frame_too_large",
  "buffer_overflow",
  "next_cursor",
  "replayAll",
  "encodeRequest",
  "attach_timeout",
]) {
  check(supervision.includes(contract), "s27-client-contract", contract);
}
check(
  supervision.includes("version !== CURRENT_PROTOCOL_VERSION && version !== PREVIOUS_PROTOCOL_VERSION"),
  "s27-client-version-gate",
  "initialize rejects incompatible protocol versions",
);

// Renderer bridge: frozen allowlist only (S27-WP04).
const bridge = text("apps/desktop-codeoss/extensions/saber-agent/src/bridge.js");
for (const contract of [
  "Object.freeze",
  "saber.core.initialize",
  "saber.core.health",
  "saber.events.subscribe",
  "saber.workbench.status",
  "unknown_bridge_method",
  "bridge_payload_too_large",
]) {
  check(bridge.includes(contract), "s27-bridge-allowlist", contract);
}
check(bridge.includes("require(") === false, "s27-bridge-no-host", "no host module loading");

// Tests exist with adversarial coverage and platform guards.
const transport = text("packages/ide-client/test/supervision.test.mjs");
for (const contract of ["SKIP_UNIX", "forged", "replayed", "unauthorized", "replayAll", "nextLifecycle"]) {
  check(transport.includes(contract), "s27-transport-test", contract);
}
const crash = text("packages/ide-client/test/crashMatrix.test.mjs");
for (const contract of ["SKIP_UNIX", "SIGKILL", "degraded", "firstEventId"]) {
  check(crash.includes(contract), "s27-crash-test", contract);
}

// Supervisor lifecycle (S27-WP01) and windows pipe (S27-WP02).
const supervisor = text("apps/desktop-codeoss/scripts/core-supervisor.mjs");
for (const contract of [
  "bootstrap-token",
  "restartBackoffMs",
  "maxRestarts",
  "shutdownGraceMs",
  "SIGKILL",
  "retries_exhausted",
  "degraded",
  "stopped",
]) {
  check(supervisor.includes(contract), "s27-supervisor-contract", contract);
}
const pipe = text("crates/saber-core/src/serve_windows.rs");
for (const contract of [
  "CreateNamedPipeW",
  "PIPE_REJECT_REMOTE_CLIENTS",
  "FILE_FLAG_FIRST_PIPE_INSTANCE",
  "bootstrap-token",
  "record_handshake_failure",
]) {
  check(pipe.includes(contract), "s27-windows-pipe-contract", contract);
}
const adversarial = text("packages/ide-client/test/adversarial.test.mjs");
for (const contract of ["slow", "event_count + 1_000", "supervision.handshake_rejected", "monotonic"]) {
  check(adversarial.includes(contract), "s27-adversarial-contract", contract);
}

// Gate wiring: scripts exist and the focused verifier is chained in.
const packageJson = text("package.json");
check(packageJson.includes("desktop:test:transport"), "s27-wiring-scripts", "desktop:test:transport");
check(packageJson.includes("desktop:test:crash-matrix"), "s27-wiring-scripts", "desktop:test:crash-matrix");
check(packageJson.includes("desktop:test:supervisor"), "s27-wiring-scripts", "desktop:test:supervisor");
check(packageJson.includes("verify-s27.mjs"), "s27-wiring-verify", "verify-s27 chained into the repository gate");
const workflow = text(".github/workflows/repository-verification.yml");
check(
  workflow.includes("node scripts/verify-s27.mjs"),
  "s27-wiring-hosted",
  "hosted repository verification runs verify-s27",
);

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S27 verification passed with ${passes.length} checks.`);
