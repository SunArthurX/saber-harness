# S15 Cross-model Execution Handoff

This is the pause point after the S14 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s14-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S15-evolution-workshop`
- S15 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S15：Evolution Workshop"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s14-complete
git rev-parse 's14-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s14-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-016`
7. FR-EVO and TM-07 entries in `docs/traceability.yaml` and `docs/security/THREAT-MODEL-v0.md`
8. The E0-E7 evolution boundary description in `docs/architecture/INVARIANTS.md` neighbors

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s14.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S15-evolution-workshop origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S15 `in_progress` state before the first implementation checkpoint.

## S15 objective

The Evolution Workshop: a governed pipeline where runtime evidence proposes evolution candidates (skills, memories, rules, workflows — and later code capsules in S16), candidates are quarantined, evaluated deterministically, reviewed by explicit human/policy authority, and promoted with provenance — candidates can never bypass review into capability (INV-03, TM-07).

Required deliverables (per the roadmap and FR-EVO):

1. A typed EvolutionCandidate lifecycle: proposed (from evidence with provenance) → quarantined → evaluated → reviewed → promoted/rejected, with revocation; states never skip.
2. Deterministic evaluation harness inputs/outputs recorded as evidence; scanner-success is never promotion.
3. Promotion authority mirrors the S10 lesson: explicit review identities only — no runtime-evidence auto-promotion; candidates carry full provenance back to their source events.
4. Promotion emits a signed-style digest chain (digest-bound candidate content; full signing keys arrive with S22 TUF).
5. Revocation of a promoted candidate removes its effect from queries immediately (fabric/memory parity).
6. A S15 verifier and strict remote verifier preserving every S00-S14 gate.

## Adversarial acceptance (minimum)

- candidates skipping states (proposed→promoted) are structurally rejected;
- evaluation failure or missing evidence blocks promotion;
- auto-promotion paths do not exist (type-level, like S10's ReviewAuthority);
- poisoned evidence (untrusted provenance) cannot promote without explicit review;
- tampered candidate content fails the digest chain;
- revoked promotions disappear from queries immediately.

## Segment publication protocol

Unchanged from S14: one Segment branch, explicit staging, full local gate (`cargo fmt --check`, strict clippy, `cargo test --workspace --locked`, `pnpm verify`, `pnpm acceptance:new-machine`), truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S15 verification, atomic completion record through a second protected PR, then annotated `s15-complete`.

Never mark S15 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
