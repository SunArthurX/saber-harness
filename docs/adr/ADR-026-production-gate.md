# ADR-026: Deterministic Production Readiness Gate

Status: accepted

Date: 2026-08-30

Segment: S24 (Production Gate/E6 实验)

## Context

S00-S23 delivered the sandbox, secret, egress, policy, tool, model, context,
memory, IDE, CAX, resumption, orchestration, evolution, capsule, sync, health,
plugin, remote-realm, enterprise, release-integrity and beta-SLO boundaries.
The master plan closes the roadmap with a Production Gate: an auditable,
deterministic readiness review proving every prior invariant holds on main,
plus the explicitly gated E6 experiment boundary (独立安全审查), before the
final `s24-complete` tag.

The gate must not add features. It must fail closed on any missing contract,
verifier, tag, hosted gate, stale workspace member, uncovered boundary change,
autonomous evolution path or uncovered threat-register entry, and its output
must be metadata-only.

## Decision

1. `saber-production-gate` is a pure, deterministic evaluator over
   repository-state descriptors (`GateInput`): no I/O, no clock, no network.
   The Node verifiers and CI collect descriptors; the crate certifies them.
2. Nine invariant families are asserted: `ContractsPresent`,
   `VerifiersChained`, `TagsResolve`, `HostedGatesGreen`, `WorkspaceHygiene`,
   `AdrCoverage`, `EvolutionBoundary`, `ThreatCoverage` and `ReportHygiene`.
3. `evaluate_gate` always returns a `ReadinessReport`: per-family pass/fail
   with metadata-only findings (stable codes plus segment/tag/context
   references — never content). `assert_ready` fails closed unless every
   family passes. A gate over an empty descriptor set is malformed, never
   green.
4. Determinism is certified by a checksum (`determinism_digest`): identical
   inputs must produce identical reports across runs and platforms. The
   digest is a comparison checksum, not a cryptographic commitment.
5. The E6 boundary stays proposal-only: `assert_no_autonomous_e6_e7` fails on
   any forbidden autonomy marker (`auto_merge`, `self_approve`,
   `autonomous_promote`, `merge_without_review`, `unreviewed_merge`,
   `e7_autonomous_allow`) found in any audited source surface, and the gate
   additionally requires the protected-PR-only E6 publication path flag.
   E7 (trust roots) admits no autonomous path at all.
6. `threat_register_baseline` maps TM-01..TM-16 (docs/security/THREAT-MODEL-v0.md)
   each to a covering control and a test reference;
   `assert_threat_coverage` fails on any missing, duplicated or
   under-specified entry.
7. `readiness_report_canary` scans the rendered report for forbidden material
   (credential, token, password, secret, transcript, plaintext). The gate
   runs the canary over its own output as the `ReportHygiene` family, so a
   poisoned report cannot certify itself as ready.
8. `verify-s24.mjs` asserts the contracts, the adversarial tests, the
   workspace member, gate wiring and ADR status, and scans the tracked
   source surface for forbidden autonomy markers;
   `verify-remote-s24.mjs` chains it after strict remote S23 verification.
   Every S00-S23 gate is preserved unchanged.

## Rejected alternatives

- A live gate reading the filesystem from Rust: mixes collection with
  certification, breaks determinism, duplicates the Node verifiers.
- CI-status-only readiness: green checks are necessary but not sufficient —
  contracts, tags, ADRs, workspace hygiene and threat coverage must be
  asserted structurally.
- Embedding threat controls inside the report: controls contain boundary
  vocabulary; the report stays metadata-only (codes and references).
- Treating E6 as a feature flag: the master plan keeps E6 proposal-only with
  independent review; the gate asserts the absence of any autonomous path.

## Verification

- Adversarial tests: a missing contract/verifier/tag fails the gate; the
  gate is deterministic across runs; every TM entry maps to a control and a
  test; no autonomous E6/E7 path exists (negative fixture fails); the
  readiness report is metadata-only (poisoned detail trips the canary);
  stale members and unaccepted ADRs fail their families.
- `verify-s24.mjs` and `verify-remote-s24.mjs` wired into `pnpm verify` and
  repository verification; the final annotated `s24-complete` tag marks the
  full 25-segment roadmap complete.
