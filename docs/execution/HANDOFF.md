# S14 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-28
Branch: `segment/S14-completion`
Implementation branch: `segment/S14-goal-dag-subagents` @ `fc1a4d3368ab7dcedad6fc40081a94c4ca8f8849`
Merged main: PR #39 squash-merged as `d8f8610447fa856f2ad1ac21bd83f03a06a4e5ac`

## Objective

Decompose goals into a typed dependency DAG, delegate subagents with attenuated task-scoped capabilities, budgets and isolated failure domains, and judge completion by verified evidence — never self-report (TM-08).

## What shipped (PR #39)

- ADR-016 froze the design; FR-RUN-007 realigned to S14 and implemented with evidence.
- `crates/orchestrator` (`saber-orchestrator`):
  - `GoalDag`: task nodes with dependencies and declared acceptance evidence; total validation (unknown dependencies, DFS cycle detection); the scheduler exposes only dependency-complete tasks in deterministic sorted order — dependency-order violations are impossible by construction.
  - Attenuated delegation: grants (closed-vocabulary action + exact/prefix selector) issue only strictly within the parent authority; retries start fresh cycles re-derived from the parent — never wider.
  - Evidence judgment: reports must match declared evidence exactly (digests recomputed by the judge, command outcomes verified) and carry the assigned subagent identity; self-reported success without evidence, missing/undeclared evidence, mutated digests, forged identities and foreign delegations are rejected.
  - Failure domains: budget exhaustion fails its task alone; bounded rejections terminate terminally.
  - Deterministic cancellation: cascades to transitive descendants exactly once, idempotently.
- `verify-s14.mjs` (69 checks) and `verify-remote-s14.mjs` wired into `pnpm verify` and the repository-verification workflow.

## Verified evidence

- Full local gate: fmt, strict clippy, 31 Rust test suites (11 orchestrator adversarial tests), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI: push run `33039976917` green on all five required contexts at `fc1a4d3` on the first push.
- Protected integration: PR #39 merged after every required check; merge SHA `d8f8610`.
- Main workflows at `d8f8610`: provenance `33040354140`, repository verification `33040354142`, Monorepo CI `33040354177` all passed.
- Clean clone: anonymous HTTPS clone at `d8f8610` passed `pnpm acceptance:new-machine` in 85 seconds.
- Strict remote S14 verification passed at `d8f8610`.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s14.mjs --repository SunArthurX/saber-harness --branch main` (already green at the implementation SHA).
3. Create annotated `s14-complete` on the final commit.
4. Hand the next model `docs/execution/NEXT-MODEL-S15.md`.

## Non-negotiable review points

- Delegation only attenuates; retries never widen.
- Completion is judged by recomputed evidence with bound identity, never self-reported.
- A subagent failure stays in its failure domain.
- Cancellation is deterministic and idempotent.

## Next action

Finish the publication protocol above; do not begin S15 in this session.
