# ADR-006 — Canonical Schema and Rust/TypeScript Code Generation

Status: accepted
Date: 2026-08-25
Deciders: repository owner and S01 architecture review

## Context

Rust Core and TypeScript hosts exchange domain objects, events, capabilities and external Agent records. Handwritten duplicate types drift and can turn validation differences into security bypasses.

## Decision

Maintain canonical versioned schemas under `schemas/` and generate Rust and TypeScript types, validators and fixtures. Initial wire schemas use JSON Schema 2020-12 with explicit IDs, closed objects by default and semantic version metadata. Code generation is reproducible and checked in CI; generated files are not manually edited. Breaking wire/storage changes require a major version, migration and N/N-1 compatibility decision.

## Consequences

- One vocabulary drives IPC, persistence envelopes, capability manifests, CAX and tests.
- Schema review becomes an architecture/security gate.
- Generator version locking and deterministic output are required.
- Domain invariants beyond structural validation remain explicit Core code.

## Rejected alternatives

- Handwritten Rust and TypeScript models: inevitable drift and duplicated validation.
- TypeScript-first generation: makes the lower-trust runtime the vocabulary authority.
- Protobuf-only immediately: weaker inspectability for the architecture spike; may be added for negotiated high-volume paths later.

## Verification

- Deterministic generation, clean diff, Rust/TypeScript round-trip, unknown-field and N/N-1 fixtures.
- Requirements: FR-CONT-002, OPS-ENT-002.
