# S22 Cross-model Execution Handoff

This is the pause point after the S21 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s21-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S22-release-integrity`
- S22 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S22：TUF/SLSA/SBOM/Updater/Air-gap"

## Mandatory startup

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s21-complete
git rev-parse 's21-complete^{}'
git rev-parse origin/main
```

The worktree must be clean; the tag must be annotated and an ancestor of `origin/main`. Read AGENTS.md, STATE.yaml, HANDOFF.md, EVIDENCE.json, ROADMAP.md, ADR-023 and the OPS-ENT-003/FR-EVO-006 entries in `docs/traceability.yaml`. Verify the inherited boundary:

```sh
node scripts/verify-remote-s21.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those pass: `git switch -c segment/S22-release-integrity origin/main`, then immediately update STATE.yaml, HANDOFF.md and EVIDENCE.json to truthful S22 `in_progress` state.

## S22 objective

Verifiable release integrity: reproducible builds, SBOM, provenance, a monotonic signed target/release chain (TUF-style roles and rollback protection), staged rollout rings with last-known-good rollback, an updater that verifies before installing, and air-gap import/export (Gate: 可验证发布/回滚). This segment also completes the honest "digest-only until now" note carried by the S15 evolution chain, the S19 registry and the S21 bundles: full signing keys arrive here.

Required deliverables:

1. A release manifest model: reproducible artifact digests, SBOM (component/digest list), SLSA-style provenance statement and signature(s) over the canonical body.
2. A monotonic signed target chain with role separation (root/targets/snapshot/timestamp semantics adapted to a local-verifier model): rollback and freeze attacks detected and refused.
3. Staged rollout rings with promote/demote and last-known-good rollback.
4. An updater that verifies the full chain BEFORE any install, supports air-gap import (offline bundle) and never downgrades below a pinned floor silently.
5. The evolution/registry/bundle digest chains (S15/S19/S21) gain their long-promised signature verification hook.
6. A S22 verifier and strict remote verifier preserving every S00-S21 gate.

## Adversarial acceptance (minimum)

- tampered artifacts/manifests fail signature or digest verification;
- rollback (older signed target replay) and freeze (stale timestamp) refused;
- ring demotion restores last-known-good cleanly with history;
- updater refuses unsigned, downgraded or floor-violating bundles;
- air-gap import verifies the identical chain offline;
- reproducibility: same inputs produce identical digests.

## Segment publication protocol

Unchanged from S21: one Segment branch, explicit staging, full local gate, truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S22 verification, atomic completion record through a second protected PR, then annotated `s22-complete`.

Never mark S22 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
