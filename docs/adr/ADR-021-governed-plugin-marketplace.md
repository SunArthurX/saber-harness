# ADR-021 — Governed Plugin Marketplace

Status: accepted
Date: 2026-08-29
Deciders: repository owner and S19 architecture review

## Context

Third-party extensions are the product's "external armor" but also a
supply-chain surface (TM-04, TB-07). The S06 host already contains
plugin faults; S19 makes the marketplace itself governed: admission,
distribution and revocation must meet the same bar as first-party code.

## Decision

### Manifests are digest-bound closed contracts

A plugin manifest carries stable id, version, content digest, declared
capabilities from the closed S05 action + S14 selector vocabulary,
sandbox realm, budgets and probe evidence — mirroring the S16 capsule
discipline. Tampered manifests and undeclared capability requests fail
closed.

### The registry is monotonic and revocable

Registry entries are digest-pinned; updates are monotonic (rollback
refused); revocation removes a plugin from the executable set
immediately while retaining the audit tombstone. Full cryptographic
signing arrives with the S22 TUF segment; the digest chain is the
stated boundary until then.

### The SDK has no host path

The SDK surface exposes typed capability requests, lifecycle events and
host callbacks — every capability flows through the S05 policy and S06
sandbox boundaries. There is no SDK function that touches the host,
store, network or filesystem directly; a plugin written against the SDK
cannot bypass governance by construction.

## Consequences

- Plugin governance equals core governance: same vocabulary, same
  boundaries, same audit.
- Marketplace distribution can later move to signed TUF targets without
  changing the admission contract.
- Registry-sourced plugins inherit S06 fault containment unchanged.

## Rejected alternatives

- Raw npm-style distribution: unsigned, uncontained supply chain (TM-04).
- SDK convenience wrappers over host APIs: every convenience is a bypass.
- Revocation by flag: execution eligibility must fail closed at lookup.

## Verification

- Tampered manifests fail admission; undeclared capabilities fail
  closed; revoked plugins never execute again; rollback refused.
- SDK surface audit: no host-access path exists.
- Fault containment holds for registry-sourced plugins.
