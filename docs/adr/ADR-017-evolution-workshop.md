# ADR-017 — Evolution Workshop: Candidates Never Bypass Review

Status: accepted
Date: 2026-08-28
Deciders: repository owner and S15 architecture review

## Context

Self-evolution is the product's differentiator and its most dangerous
surface: runtime evidence that could silently promote itself into
capability recreates every poisoning and privilege-escalation hole the
prior segments closed (TM-07, INV-03). The roadmap requires an Evolution
Workshop where evidence proposes, evaluation measures, review promotes.

## Decision

### The lifecycle is typed and unsuitable for skipping

An `EvolutionCandidate` moves through exactly
`Proposed → Quarantined → Evaluated → (Promoted | Rejected)` plus
terminal `Revoked`. Every transition is a method that validates the
current state; a `Proposed` candidate cannot be promoted, a failed
evaluation cannot be promoted, and there is no API that sets a state
directly. Scanner or harness success is recorded evidence, never
promotion.

### Promotion authority is explicit, mirroring S10

Promotion requires a `ReviewAuthority` — a human review id or a named
policy rule. The type has no runtime-evidence variant: a run cannot
construct authority over its own evolution. Promotions emit a digest
chain binding candidate content digest, reviewer identity and timestamp
(cryptographic signing keys arrive with the S22 TUF segment; the digest
chain is the integrity boundary until then, stated honestly).

### Provenance survives to the source event

Every candidate records its source event id and trust posture; poisoned
(untrusted) provenance promotes only through the same explicit review —
never silently — and the promotion record retains the provenance so an
auditor can trace any capability back to the runtime evidence that
proposed it.

### Tampering fails the digest chain

Candidate payloads are digest-bound at proposal; any later mutation
between states is detected by re-verification before each transition.

### Revocation removes capability immediately

A promoted candidate can be revoked to a terminal state; active queries
exclude it from that call onward while the audit trail retains the full
lifecycle history.

## Consequences

- Evolution velocity is bounded by review capacity — a product choice,
  never a safety compromise.
- The workshop is a pure state machine: deterministic, exhaustively
  testable, no I/O.
- S16's code capsules join as one more `EvolutionKind` with the same
  lifecycle; nothing here is skill-specific.

## Rejected alternatives

- Auto-promotion on evaluation success: the forged-success hole.
- Runtime-evidence review authority: self-promotion reborn.
- Mutable candidates between states: tampering becomes undetectable.

## Verification

- State-skip attempts structurally rejected; failed evaluation blocks
  promotion.
- No runtime-authority variant exists (type-level).
- Untrusted provenance promotes only via explicit review, provenance
  retained on the promotion record.
- Tampered payloads fail digest re-verification.
- Revoked promotions vanish from active queries immediately.
