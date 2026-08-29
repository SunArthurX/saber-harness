# S37 Handoff — Quality and Security Gate

Status: in progress — the complete quality/security gate contract is
implemented and tested (21 pure tests + the real bench and readiness
drivers); the protected PR, hosted checks, completion record and
s37-complete tag remain
Date: 2026-08-29
Branch: `segment/S37-quality-security-gate`
Base main: `92b05d5f6bb3da7ea6f8f49b9b24abdf8b981348` (`s36-complete`)
Runbook: `docs/execution/desktop/S37-QUALITY-SECURITY-GATE.md`

## What landed

- **performanceSlo** — twelve SLO metrics over low/mid/high reference
  machines; median/P95 evaluation; raw metadata only.
- **a11yLocalization** — keyboard journeys, three screen readers,
  eight visual checks, P0/P1 gate with tracked P2/P3; zh/en
  completeness with always-translated security decisions;
  pseudo-localization clipping detection; formatting/IME/shortcut
  contracts; the six-term glossary.
- **securityRedteam** — thirteen threats with evidence and controls;
  PJ-negative rule (brains/reflexes never touch immune containment);
  contained remote dispatch with global Stop; honest solo/team
  measurement; locked-provenance runtime images.
- **chaosReliability** — eleven scenarios proving bounded retries,
  containment, Safe Mode and retained evidence; backoff ceilings.
- **readinessGate** — eleven required families, deterministic digest,
  ready requires zero P0/P1, metadata-only hygiene.
- **Scripts** — `bench-desktop.mjs` measures real workloads with
  honest environment labeling; `readiness-desktop.mjs` gates on the
  committed descriptor report.
- **Evidence**: 21 tests across three suites; verify-s37 (119 checks)
  in local and hosted gates.

## Honest limits

Reference-machine SLO evaluation and full screen-reader manual passes
run in the hosted release environment; this repo carries the
contracts, the honest bench and the deterministic gate.

## Next actions

1. Push, open the protected PR, wait for the five checks.
2. Squash-merge; completion record; annotated `s37-complete`.
3. S38 starts only from
   `docs/execution/desktop/S38-DESIGN-PARTNER-PRODUCTION.md`.
