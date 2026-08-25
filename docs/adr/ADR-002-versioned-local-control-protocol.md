# ADR-002 — Versioned Local Control Protocol

Status: accepted
Date: 2026-08-25
Deciders: repository owner and S01 architecture review

## Context

Desktop, CLI, Agent Host and Core need a reconnectable lifecycle protocol for Goals, Runs, approvals, artifacts, memory, health and events. MCP describes tool/data interaction but does not own the product's complete state machine.

## Decision

Use versioned JSON-RPC 2.0 over Unix domain sockets on macOS/Linux and named pipes on Windows for the initial local control protocol. Every request includes `request_id`, actor, workspace, causation and deadline; mutations also include an idempotency key. Payloads are generated from canonical schemas and enforce size, timeout, backpressure and unknown-method behavior. Event subscriptions resume from durable cursors. A framed binary encoding may be added only as a compatible negotiated transport.

## Consequences

- JSON improves early inspectability and cross-language debugging.
- Generated types and compatibility tests prevent Rust/TypeScript drift.
- The protocol requires explicit N/N-1 compatibility and denial semantics.
- MCP remains an adapter behind Tool Broker, not an alternate authority path.

## Rejected alternatives

- In-process bindings: couple fault domains and prevent reusable CLI/Core.
- Ad-hoc Electron IPC: shell-specific and difficult to version/govern.
- MCP for all lifecycle operations: mismatched semantics for Run replay, approval and recovery.

## Verification

- Rust/TypeScript round-trip, N/N-1, fuzz, frame limit, deadline and idempotency tests.
- Unknown methods and invalid state transitions fail deterministically.
- Requirements: FR-RUN-001, FR-RUN-003, OPS-ENT-002.
