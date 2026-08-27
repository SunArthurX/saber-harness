# S18 Cross-model Execution Handoff

This is the pause point after the S17 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s17-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S18-health-safemode`
- S18 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S18：Health/Safe Mode/自愈"

## Mandatory startup

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s17-complete
git rev-parse 's17-complete^{}'
git rev-parse origin/main
```

The worktree must be clean; the tag must be annotated and an ancestor of `origin/main`. Read AGENTS.md, STATE.yaml, HANDOFF.md, EVIDENCE.json, ROADMAP.md, ADR-019 and the RES-HEAL entries in `docs/traceability.yaml`. Verify the inherited boundary:

```sh
node scripts/verify-remote-s17.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those pass: `git switch -c segment/S18-health-safemode origin/main`, then immediately update STATE.yaml, HANDOFF.md and EVIDENCE.json to truthful S18 `in_progress` state.

## S18 objective

The immune system: H0-H4 reflex levels, Safe Mode and containment-first repair. Automatic responses are bounded, deterministic and evidence-preserving; anything beyond them escalates instead of improvising (INV-08, TM-15).

Required deliverables (per the roadmap and RES-HEAL):

1. A typed health signal model: detectors feeding a severity-labeled signal bus (H0 reflection through H4 external-medicine escalation).
2. Bounded deterministic reflexes: rate limiting, circuit breaking, budget suspension and quarantine — each with cooldowns and blast-radius limits; reflexes that could worsen an incident are forbidden.
3. Safe Mode: a degraded state that disables non-essential subsystems while preserving evidence and core authority; deterministic entry/exit conditions with operator confirmation for exit.
4. Contain-before-diagnose: evidence preservation is mandatory before any repair; LLM diagnosis only runs after deterministic containment.
5. Escalation: incidents needing broader privilege/data scope or trust-root involvement produce a minimal diagnostic bundle for external authority and stop.
6. A S18 verifier and strict remote verifier preserving every S00-S17 gate.

## Adversarial acceptance (minimum)

- a failing reflex cannot disable audit or policy enforcement;
- health subsystem faults cannot amplify (containment of the health system itself);
- Safe Mode entry is idempotent and exit requires explicit operator action;
- repair attempts beyond blast-radius limits are refused;
- escalation stops autonomous action (no improvising repairs with wider scope);
- game-day: a cascade of injected faults results in bounded, evidence-preserving containment.

## Segment publication protocol

Unchanged from S17: one Segment branch, explicit staging, full local gate, truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S18 verification, atomic completion record through a second protected PR, then annotated `s18-complete`.

Never mark S18 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
