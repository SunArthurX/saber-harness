# S20 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-29
Branch: `segment/S20-completion`
Implementation branch: `segment/S20-remote-execution-realm` @ `e156b30a969cee58742734dc85c86fe14fdcc95a`
Merged main: PR #51 squash-merged as `2c30ad248c948bbafaa59c7101bf6443e12c120e`

## Objective

Remote execution capacity under local sovereignty: policy envelopes travel, decisions stay local, remote failures never spread, results re-enter as verified evidence (Gate: 远程故障不扩散).

## What shipped (PR #51)

- ADR-022 froze the design.
- `crates/remote-realm` (`saber-remote-realm`):
  - Digest-chained `PolicyEnvelope` (workspace, closed-vocabulary grant, data class, deadline): transit tampering including grant escalation fails closed; realms never re-decide policy.
  - Deterministic remote state machine (submitted/running/succeeded/failed/cancelled) with heartbeat leases: expired leases reaped; crashed realms never report success; stale successes refused; skips refused.
  - Evidence-grade result admission: digests recomputed from received bytes; mismatches refused; nonzero exits terminal; results taint-labeled untrusted-source.
  - Cell-contained failures; deterministic terminal cancellation.
- `verify-s20.mjs` (43 checks) and `verify-remote-s20.mjs` wired into gates.

## Verified evidence

- Full local gate: fmt, strict clippy, 43 Rust test suites (7 adversarial), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI green on all five contexts at `e156b30` first push; PR #51 merged at `2c30ad2`; main workflows green; clean clone 88 s; strict remote S20 verification passed.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s20.mjs --repository SunArthurX/saber-harness --branch main`.
3. Create annotated `s20-complete`; hand the next model `docs/execution/NEXT-MODEL-S21.md`.

## Non-negotiable review points

- Local policy is the only decision point; the envelope travels, authority does not.
- Crashed realms never report success; results are evidence, not truths.

## Next action

Finish the publication protocol above; do not begin S21 in this session.
