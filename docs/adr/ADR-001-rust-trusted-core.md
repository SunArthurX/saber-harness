# ADR-001 — Rust Trusted Core as an Independent Process

Status: accepted
Date: 2026-08-25
Deciders: repository owner and S01 architecture review

## Context

Saber must keep durable state, policy, secrets, sandbox control, sync keys, recovery and audit trustworthy while desktop shells, model providers, Agent runtimes and plugins evolve independently. A renderer or Node extension host is too broad and mutable to be the authority boundary.

## Decision

Implement `saber-core` as an independent Rust process reusable by Desktop, CLI and managed nodes. It owns authoritative Run transitions, append-only events, projections, Policy PDP/PEP, Secret Broker interfaces, sandbox supervision, key management, recovery and update verification. TypeScript hosts are lower-trust clients and cannot link around Core APIs.

## Consequences

- Memory safety, explicit errors and a small dependency surface improve the trusted computing base.
- Cross-process protocols, packaging and crash recovery become first-class work.
- UI and Agent crashes can restart without losing committed Run state.
- Rust does not make unsafe design safe; `unsafe`, FFI and privileged dependencies require review.

## Rejected alternatives

- Electron/Node monolith: too much ambient authority and plugin/runtime coupling.
- Tauri command handlers as the only Core: binds product authority to one shell and lifecycle.
- Microservice-first cloud Core: conflicts with local-first/offline ownership and increases plaintext boundaries.

## Verification

- Process-boundary contract tests and crash/restart tests.
- No renderer/Agent package imports privileged persistence, key or sandbox implementations.
- Requirements: SEC-POL-001, SEC-ISO-001, RES-HEAL-001, OPS-ENT-002.
