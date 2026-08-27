# S16 Cross-model Execution Handoff

This is the pause point after the S15 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s15-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S16-code-capsule`
- S16 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S16：Code Capsule"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s15-complete
git rev-parse 's15-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s15-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-017`
7. FR-EVO-005 in `docs/traceability.yaml` (realigned to S16 by DEC-0014)

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s15.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S16-code-capsule origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S16 `in_progress` state before the first implementation checkpoint.

## S16 objective

The Code Capsule: E4-level self-evolution where generated code runs as capability. Generated code ships only as an isolated, typed capsule with locked dependencies, explicit declared capabilities and resource budgets — executed inside the S06 sandbox realms, admitted through the S15 evolution lifecycle, and never acquiring ambient authority.

Required deliverables (per the roadmap and FR-EVO-005):

1. A versioned `CodeCapsule` schema: source digest, locked dependency list (digest-pinned), declared capabilities (closed action+selector vocabulary), resource budgets and the target sandbox realm.
2. Capsule admission: capsule digests verified; undeclared dependencies and capabilities refused; admission lands in the S15 workshop as an `EvolutionCandidate` (kind extension or payload contract) — promotion follows the S15 review path.
3. Capsule execution: promoted capsules run only through the S06 sandbox SPI at their declared realm with their declared budgets; capability checks enforce the capsule's declared grants (attenuated from the parent by the S14 rules).
4. Isolation guarantees: capsule code cannot widen its grants, exceed budgets or escape its realm (composition of existing boundaries — do not weaken them).
5. Supersession/rollback: a newer capsule version supersedes the older with full history retained.
6. A S16 verifier and strict remote verifier preserving every S00-S15 gate.

## Adversarial acceptance (minimum)

- capsule with tampered source/digest mismatch fails admission;
- undeclared dependency or capability requests fail closed at execution;
- budget exhaustion terminates the capsule without side effects leaking;
- a capsule cannot widen its grants across versions;
- unpromoted (candidate-state) capsules never execute;
- supersession keeps history and rolls back cleanly.

## Segment publication protocol

Unchanged from S15: one Segment branch, explicit staging, full local gate (`cargo fmt --check`, strict clippy, `cargo test --workspace --locked`, `pnpm verify`, `pnpm acceptance:new-machine`), truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S16 verification, atomic completion record through a second protected PR, then annotated `s16-complete`.

Never mark S16 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
