# ADR-018 — Isolated Code Capsules

Status: accepted
Date: 2026-08-28
Deciders: repository owner and S16 architecture review

## Context

E4-level evolution lets the tool improve itself with generated code — the
highest-power medium and the highest-risk surface (FR-EVO-005, INV-04,
INV-07). Generated code must never acquire ambient authority, unpinned
dependencies or unbounded resources, and an unpromoted capsule must never
execute.

## Decision

### Capsules are typed, digest-bound fact sets

A `CodeCapsule` carries: schema version, capsule name/version, source
digest, digest-pinned dependency locks, declared grants from the closed
S05 action + S14 selector vocabulary, the target S06 sandbox realm and
resource budgets, and a capsule digest over the canonical body. Admission
recomputes every digest — tampered sources, malformed locks and
unpinned dependencies fail closed.

### Admission rides the S15 workshop

Admitting a capsule proposes an `EvolutionCandidate` (kind `Code`) in the
Evolution Workshop: quarantine, evaluation and explicit review promotion
apply unchanged. Only workshop-`Promoted` capsules are executable;
candidate or revoked capsules never run.

### Execution eligibility is checked, not assumed

Executing a capsule verifies: workshop promotion state, requested
capabilities within the capsule's declared grants, requested dependencies
within the pinned locks, remaining budget, and emits a sandbox plan bound
to the declared realm and budget for the S06 SPI to enforce. Undeclared
grants and dependencies fail closed at execution time, not just
admission; budget exhaustion terminates eligibility without side
effects.

### Grants never widen across versions

Supersession installs a newer capsule version only when its grants sit
within the previous version's grants. History is retained and rollback
to any prior version is explicit and clean.

## Consequences

- Generated code becomes a governed capability like skills and memories,
  one lifecycle (S15), one boundary stack (S05-S07), one vocabulary.
- Capsule execution composes existing boundaries rather than adding a
  new isolation mechanism; nothing here weakens them.
- Versioned supersession makes self-modification auditable and
  reversible.

## Rejected alternatives

- Executing candidate capsules in a "trial" mode: candidate is not
  capability (INV-03).
- Allowing new versions to declare broader grants: supersession would be
  an escalation path.
- Environment-pinned dependencies: unpinned supply chain reintroduces
  TM-04.

## Verification

- Tampered sources fail admission; undeclared dependencies and grants
  fail at execution; budget exhaustion terminates eligibility.
- Unpromoted capsules never execute; promotion requires the S15 review
  authority.
- Supersession refuses widened grants, keeps history and rolls back.
