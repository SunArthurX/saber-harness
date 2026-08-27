# ADR-015 — Verifiable Resumption Capsule

Status: accepted
Date: 2026-08-28
Deciders: repository owner and S13 architecture review

## Context

Work must continue across model, agent and session changes. A naive
"paste the transcript" resume invents state, loses lineage and silently
tolerates an environment that has drifted since the capsule was written.
The roadmap requires a verifiable capsule preserving goal, task, artifact
and decision causal lineage, with environment drift discoverable
(S13 gate: 环境漂移可发现).

## Decision

### The capsule is a digest-bound fact set, not a prompt

A `ResumptionCapsule` carries: schema version, tenant/workspace scope,
goal id, ordered task lineage (id + state), content-addressed artifact
references (path + digest), decision ids, the workspace fingerprint at
creation, and a `capsule_digest` over the canonical body. Capsules are
created only from authoritative facts supplied by the durable event
store — the builder refuses missing facts rather than inventing them —
and every consumer can re-verify the digest chain without trusting the
producer.

### Verification compares the capsule against the present world

`verify` re-computes the capsule digest (tampering fails closed), checks
the resumer's scope (cross-workspace capsules are rejected), and compares
each referenced artifact and the workspace fingerprint against the
current environment. Missing or mutated artifacts and fingerprint drift
produce `NeedsReconcile` — an explicit state, never a silent continue —
carrying the exact drift list as evidence (S07 semantics).

### Continuation is lineage, not replay

`continue_from` returns the recorded lineage verbatim when (and only
when) verification is `Ready`. The successor task receives the capsule id,
the full task lineage and the artifact references; nothing is truncated,
extended or paraphrased, and a drifted environment must reconcile first.

## Consequences

- Capsules are portable evidence: any Saber instance (or auditor) can
  verify them offline.
- Environments that changed underneath a capsule force an explicit
  reconcile step the user can see.
- Capsule creation is only as good as the fact source; the event store
  remains the authority (INV-01).
- Schema evolution requires a new version and fail-closed consumers,
  mirroring the control protocol.

## Rejected alternatives

- Transcript replay as resumption: invents state, loses causality.
- Silent best-effort resume on drift: the exact failure mode this ADR
  exists to close.
- Trusting the capsule producer: a tampered capsule must fail closed
  anywhere.

## Verification

- Capsule digest mismatch and unknown versions fail closed.
- Mutated or missing artifacts and fingerprint drift yield
  `NeedsReconcile` with drift evidence.
- Resumed lineage equals the recorded lineage byte for byte.
- Cross-workspace injection denied; creation refuses incomplete facts.
- Consumers re-verify without producer trust; identical facts produce
  identical capsules.
