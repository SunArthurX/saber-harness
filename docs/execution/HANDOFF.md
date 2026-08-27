# S15 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-28
Branch: `segment/S15-completion`
Implementation branch: `segment/S15-evolution-workshop` @ `5491bb592f0e2546eb251796a0981e8709ba44a5`
Merged main: PR #41 squash-merged as `6b166c1fd9d841549e6eb77a0e777a4b78972b73`

## Objective

Govern self-evolution: runtime evidence proposes candidates, deterministic evaluation measures them, explicit review promotes them, and revocation removes them — candidates can never bypass review into capability (INV-03, TM-07).

## What shipped (PR #41)

- ADR-017 froze the design; DEC-0014 realigned the FR-EVO schedule collision (001-004/007 → S15 implemented; 005 → S16; 006 → S22).
- `crates/evolution` (`saber-evolution`):
  - Typed lifecycle `Proposed → Quarantined → Evaluated → (Promoted | Rejected)` plus terminal `Revoked`; every transition validates the current state — skipping is structurally rejected; digest re-verification runs before **every** transition so tampering between states is detected.
  - Evaluation is evidence, never promotion: deterministic evaluation records gate promotion; failures block it.
  - Promotion authority mirrors S10: only explicit `ReviewAuthority` values exist (no runtime-evidence variant — a run cannot construct authority over its own evolution); promotions emit a digest chain binding content, reviewer, provenance and timestamp (signing keys arrive with S22 TUF, documented).
  - Provenance survives to the source event; poisoned evidence promotes only through explicit review with provenance retained on the promotion record.
  - Revocation removes capability from the active surface immediately while the audit trail remains.
- `verify-s15.mjs` (57 checks) and `verify-remote-s15.mjs` wired into `pnpm verify` and the repository-verification workflow.

## Verified evidence

- Full local gate: fmt, strict clippy, 33 Rust test suites (8 evolution adversarial tests), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI: push run `33041617481` green on all five required contexts at `5491bb5` on the first push.
- Protected integration: PR #41 merged after every required check; merge SHA `6b166c1`.
- Main workflows at `6b166c1`: provenance `33042019779`, repository verification `33042019799`, Monorepo CI `33042019766` all passed.
- Clean clone: anonymous HTTPS clone at `6b166c1` passed `pnpm acceptance:new-machine` in 86 seconds.
- Strict remote S15 verification passed at `6b166c1`.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s15.mjs --repository SunArthurX/saber-harness --branch main` (already green at the implementation SHA).
3. Create annotated `s15-complete` on the final commit.
4. Hand the next model `docs/execution/NEXT-MODEL-S16.md`.

## Non-negotiable review points

- Candidates never bypass review; no auto-promotion path exists at the type level.
- Tampering fails the digest chain before every transition.
- Untrusted provenance promotes only through explicit review, provenance retained.
- Revoked capability disappears from the active surface immediately.

## Next action

Finish the publication protocol above; do not begin S16 in this session.
