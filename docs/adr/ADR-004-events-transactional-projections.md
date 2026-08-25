# ADR-004 — Append-only Events with Transactional Projections

Status: accepted
Date: 2026-08-25
Deciders: repository owner and S01 architecture review

## Context

Cross-model continuation, recovery, audit and self-evolution require causal evidence. Pure CRUD loses history; theoretical full event sourcing makes every read and migration depend on total replay.

## Decision

Store immutable domain facts in an append-only event log. Update query projections and a transactional outbox in the same SQL transaction as event append. Use projections for fast reads, encrypted blobs for large payloads and rebuildable indexes for search. Corrections append `superseded`, `revoked`, `redacted` or compensating events; they never silently rewrite audit facts. Hash-chain the timeline and periodically anchor/sign checkpoints.

## Consequences

- Run recovery, lineage and audits share one causal source.
- Projection versioning, replay tooling and poison-event handling are required.
- Side effects use intent/result events plus idempotency or explicit non-retriable semantics.
- Hash chains expose tampering but cannot prevent an administrator from deleting all local data.

## Rejected alternatives

- CRUD-only history tables: weak causality and recovery semantics.
- Pure replay for all reads: avoidable latency and migration complexity.
- Independent event and projection writes: permits acknowledged facts without usable state.

## Verification

- Atomicity, replay equivalence, projection rebuild, duplicate idempotency and kill-9 tail-repair tests.
- Requirements: FR-RUN-002, RES-HEAL-001, RES-HEAL-002, OPS-ENT-001.
