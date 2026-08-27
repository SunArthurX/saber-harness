# S10 Cross-model Execution Handoff

This is the pause point after the S09 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s09-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S10-memory-authority`
- S10 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S10：Memory Authority"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s09-complete
git rev-parse 's09-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s09-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-011-context-engine-knowledge-mesh.md`
7. FR-MEM-003 and TM-06 entries in `docs/traceability.yaml` and `docs/security/THREAT-MODEL-v0.md`

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s09.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S10-memory-authority origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S10 `in_progress` state before the first implementation checkpoint.

## S10 objective

Implement the Memory Authority: one governed memory writer per workspace promoting typed candidates through conflict, revision, TTL and revocation rules, with poisoning defenses (TM-06): untrusted sources propose candidates that never auto-promote, provenance and scope follow every memory, and cross-workspace memory stays isolated.

Required deliverables (per the roadmap and FR-MEM-003):

1. One Memory Authority per workspace: single-writer state machine over memory entries (candidate -> reviewed -> promoted, plus revoked/stale).
2. Typed memory candidates with provenance, scope, sensitivity and nutrition-label parity with S09.
3. Conflict resolution: contradicting facts create revisions, never silent overwrites; deterministic conflict detection.
4. TTL/staleness and revocation rules; stale memories surface as stale, not as truth.
5. Promotion requires explicit review authority (no runtime evidence auto-promotes memory).
6. Memory queries flow through the S09 fabric semantics (scope, sensitivity, redaction, explanation).
7. A S10 verifier and strict remote verifier preserving every S00-S09 gate.

## Adversarial acceptance (minimum)

- poisoned candidate from untrusted provenance never promotes without explicit review;
- concurrent writers serialize through the single authority (no lost updates);
- contradicting promotions create revisions with full history, never overwrite;
- TTL expiry and revocation remove memories from query results immediately;
- cross-workspace memory injection attempts fail;
- deterministic conflict resolution for identical inputs.

## Segment publication protocol

Unchanged from S09: one Segment branch, explicit staging, full local gate (`cargo fmt --check`, strict clippy, `cargo test --workspace --locked`, `pnpm verify`, `pnpm acceptance:new-machine`), truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S10 verification, atomic completion record through a second protected PR, then annotated `s10-complete`.

Never mark S10 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
