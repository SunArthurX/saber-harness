# ADR-020 — Contain-First Immune Core

Status: accepted
Date: 2026-08-29
Deciders: repository owner and S18 architecture review

## Context

The product's physiology metaphor makes health a first-class subsystem:
like inflammation alerting the brain while leukocytes heal locally, the
system must detect, contain and recover — but a health subsystem that can
touch policy, disable audit or improvise repairs with wider scope is
itself the worst incident (TM-15, INV-08).

## Decision

### Deterministic detection, H0-H4 ladder

Health detectors are pure functions over observed metrics (integrity,
budget, latency, crash, policy, contamination) mapping to a severity
ladder: H0 local reflex, H1 cell-level containment, H2 cross-cell
degradation, H3 Safe Mode, H4 external medicine. No LLM participates in
detection.

### Bounded reflexes that cannot touch authority

Reflexes are a closed set — rate limit, circuit break, budget suspend,
quarantine — each with cooldown and blast-radius bounds. The reflex
vocabulary structurally excludes policy, sandbox, audit, crypto and
recovery enforcement: a failing reflex can degrade work, never weaken a
boundary. Health-system faults contain the health system itself.

### Safe Mode is fail-closed and operator-exited

When a critical enforcement boundary is unavailable, the supervisor
enters Safe Mode: new effects stop, evidence is preserved, entry is
idempotent, and exit requires an explicit operator action — never a
timeout, never self-assessment.

### Escalation stops autonomy

Incidents needing wider privilege/data scope, or touching trust roots,
sandbox escapes or audit-chain breaks, stop autonomous repair and emit a
minimal metadata-only, DLP-reviewed diagnostic bundle for external
authority.

## Consequences

- The health system is deterministic and exhaustively testable.
- Degradation is preferred over improvisation; evidence always survives.
- LLM diagnosis may run only inside already-contained, Safe-Mode-aware
  contexts — after containment, never instead of it.

## Rejected alternatives

- Self-healing with broad privileges: the amplifier TM-15 warns about.
- Auto-exit from Safe Mode: false recovery is worse than downtime.
- LLM-first triage: nondeterministic and uncontained by construction.

## Verification

- Reflexes cannot disable policy/audit; health faults stay contained.
- Safe Mode entry idempotent; exit operator-only.
- Escalation halts autonomy with a minimal redacted bundle.
- Game-day cascade: injected multi-cell faults end in bounded,
  evidence-preserving containment.
