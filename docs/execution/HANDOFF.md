# S16 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-28
Branch: `segment/S16-completion`
Implementation branch: `segment/S16-code-capsule` @ `ded8db4f2b1bd744d511830ce08c093487b07854`
Merged main: PR #43 squash-merged as `f676955a0fcd1ebde987558d242cdba62b2dad09`

## Objective

Generated code as capability (E4) only through isolated typed Code Capsules with digest-pinned dependencies, declared closed-vocabulary grants, sandbox realms, budget bounds and supersession history (FR-EVO-005, INV-04, INV-07).

## What shipped (PR #43)

- ADR-018 froze the design.
- `crates/code-capsule` (`saber-code-capsule`):
  - Versioned capsule envelope (schema 1.0.0): source digest, digest-pinned dependency locks, declared grants (S05 action + S14 selector), target S06 realm, budgets, capsule digest + derived id — validation recomputes everything; tampering and unpinned locks fail closed.
  - Admission rides the S15 workshop (`EvolutionKind::Code`): quarantine → evaluation → explicit review promotion unchanged; only workshop-Promoted capsules execute — candidate and evaluated-only states refused.
  - Execution eligibility checked, not assumed: promotion state, grants-within-declared, dependencies-within-locks, remaining budget → realm/budget-bound sandbox plan for the S06 SPI; undeclared grants, unpinned dependencies and exhausted budgets fail closed with zero effects.
  - Supersession never widens: new versions' grants must sit within the previous version's; full history retained; explicit clean rollback.
- `verify-s16.mjs` (54 checks) and `verify-remote-s16.mjs` wired into `pnpm verify` and the repository-verification workflow; FR-EVO-005 implemented with evidence.

## Verified evidence

- Full local gate: fmt, strict clippy, 35 Rust test suites (7 code-capsule adversarial tests), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI: push runs `33064376530`/`33064376579` green on all five required contexts at `ded8db4` on the first push.
- Protected integration: PR #43 merged after every required check; merge SHA `f676955`.
- Main workflows at `f676955`: provenance `33064999109`, repository verification `33064999082`, Monorepo CI `33064999074` all passed.
- Clean clone: anonymous HTTPS clone at `f676955` passed `pnpm acceptance:new-machine` in 87 seconds.
- Strict remote S16 verification passed at `f676955`.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s16.mjs --repository SunArthurX/saber-harness --branch main` (already green at the implementation SHA).
3. Create annotated `s16-complete` on the final commit.
4. Hand the next model `docs/execution/NEXT-MODEL-S17.md`.

## Non-negotiable review points

- Unpromoted capsules never execute; candidate is not capability.
- Grants never widen across versions; supersession only attenuates.
- Dependencies are digest-pinned or refused.
- Execution composes the S06 boundary stack; nothing here weakens it.

## Next action

Finish the publication protocol above; do not begin S17 in this session.
