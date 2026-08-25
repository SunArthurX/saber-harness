# Architecture Invariants v1

Status: frozen for S01

These invariants are release-blocking constraints. An implementation may strengthen them but cannot silently reinterpret them.

## INV-01 — Core-mediated authority

Model, Prompt, Persona, Skill, Plugin and external Agent code cannot directly mutate authoritative facts, call the host or change Policy. All such effects pass through typed Core APIs and an auditable policy decision.

## INV-02 — External evidence is untrusted by default

Imported conversations, webpages, tool output and external Agent results are evidence sources, not authorities. Unclassified sources enter as `untrusted` and cannot directly become instructions, memory or executable capability.

## INV-03 — Candidate is not capability

Candidate creation, scanner success, evaluation success, approval and promotion are distinct states. No earlier state implies a later one.

## INV-04 — Approval is not isolation

Workspace/CWD, Skill allowlists and UI approvals do not constitute a sandbox. Non-read-only execution requires a supported OS, container, WASI or managed-realm enforcement boundary; unavailable enforcement fails closed.

## INV-05 — State machines stay separated

Memory, Skill, Policy, Intent, Run and EvolutionCandidate use distinct schemas, authorities and transition rules. They cannot collapse into an untyped prompt file or shared mutable table.

## INV-06 — E2EE deployment truthfulness

In zero-knowledge E2EE mode, the ordinary server cannot access plaintext, embeddings or content keys. Server-side plaintext/vector search requires an explicitly different trusted-service deployment contract.

## INV-07 — Self-change cannot acquire release authority

An Agent may propose E6 Core changes but cannot approve them, obtain production signing keys, publish releases or modify E7 trust roots. Proposal, verification, approval and signing identities remain separable.

## INV-08 — Contain before diagnose

Automatic repair first limits the fault domain and preserves evidence. If deterministic Policy, Sandbox, Audit, Crypto or Recovery controls are unavailable, the system fails closed or enters Safe Mode before asking an LLM to diagnose.

## Enforcement

Every invariant maps to one or more requirements and planned tests in `docs/traceability.yaml`. A pull request that changes a trust boundary must name affected invariant IDs and include an ADR; undeclared changes fail architecture review.
