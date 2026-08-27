# ADR-024 — Verifiable Release Integrity

Status: accepted
Date: 2026-08-30
Deciders: repository owner and S22 architecture review

## Context

S15 (evolution), S19 (plugin registry) and S21 (org bundles) all noted
honestly that digest chains were the integrity boundary "until S22
signing". Release, update and air-gap flows need reproducible builds,
SBOM/provenance, rollback protection, freeze detection and an updater
that verifies before installing (TB-10, INV-07).

## Decision

### Release manifests are signed, reproducible fact sets

A release manifest carries artifact digests (reproducible: same inputs,
same digest), an SBOM (component/digest list), a SLSA-style provenance
statement and a signature over the canonical body. Verification
recomputes every digest; tampering fails closed.

### A monotonic signed target chain with rollback and freeze detection

Targets carry monotonically increasing versions plus a timestamp role:
replaying an older signed target (rollback) or a stale timestamp
(freeze) is refused by the verifier. Key roles (root/targets) are
separated in the model even where the local verifier holds them.

### Staged rings with last-known-good rollback

Releases promote through rings; demotion restores the last-known-good
release cleanly with full history. Ring state is explicit evidence, not
a flag.

### The updater verifies before installing

The updater validates the full chain — signatures, digests, target
version above the pinned floor — before any install step. Unsigned,
downgraded or floor-violating bundles are refused; air-gap import runs
the identical verification offline.

## Consequences

- The digest-only honesty notes in S15/S19/S21 resolve: their chains
  can now be signature-verified through this model.
- Updates are safe on disconnected networks by construction.
- Reproducibility is a test, not an aspiration.

## Rejected alternatives

- Trust-on-first-use without monotonicity: rollback attacks.
- Install-then-verify: the classic poisoned-update hole.
- Silent downgrade for "compatibility": floor violations are refusals.

## Verification

- Tampered manifests/artifacts fail verification; rollback and freeze
  refused; ring rollback restores last-known-good; updater refuses
  unsigned/downgraded bundles; air-gap verifies offline; reproducible
  digests proven.
