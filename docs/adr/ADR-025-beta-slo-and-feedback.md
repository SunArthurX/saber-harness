# ADR-025 — Beta SLO Contracts and Feedback Intake

Status: accepted
Date: 2026-08-30
Deciders: repository owner and S23 architecture review

## Context

The Design Partner Beta must run on real projects with measurable
reliability, and partner feedback must improve the product without ever
becoming unauditable self-modification (INV-03, TM-06).

## Decision

### SLO budgets are tested contracts

A deterministic benchmark harness measures startup, memory and task
latency; budgets are explicit numbers asserted like any other contract.
An over-budget run fails the gate — regressions are never silent.
Benchmarks are deterministic (fixed seeds/iterations) so the same
platform yields comparable numbers run over run; where wall-clock
noise is unavoidable, budgets carry generous margins and the harness
reports measurements.

### Telemetry is opt-in and metadata-only

Telemetry payloads carry counters and durations — no content,
credentials, paths or transcripts. A canary test asserts that forbidden
strings cannot appear in any payload shape, and collection is opt-in
(default off).

### Onboarding is one command

A single bootstrap brings a clean machine from clone to green
acceptance; it is exercised on every CI platform on every push (the
existing new-machine acceptance IS the harness input).

### Feedback proposes, never promotes

Partner feedback enters as evolution candidates with provenance
(`imported` trust) into the S15 workshop — quarantine, evaluation and
explicit review apply unchanged. There is no intake path that grants
capability directly.

## Consequences

- Performance regressions become reviewable CI failures.
- Partner telemetry cannot leak content by construction.
- The beta feedback loop inherits the full S15 governance.

## Rejected alternatives

- Best-effort dashboards without gate teeth: silent regressions.
- Content-bearing telemetry: privacy and leakage risks.
- Direct promotion of popular feedback: unauditable self-modification.

## Verification

- An intentionally over-budget benchmark fails the gate (proven).
- Telemetry canaries catch forbidden payloads.
- Feedback intake produces candidates only; determinism proven.
