# S13 Cross-model Execution Handoff

This is the pause point after the S12 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s12-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S13-resumption-capsule`
- S13 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S13：Resumption Capsule/续接"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s12-complete
git rev-parse 's12-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s12-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-014`
7. FR-CONT-003 in `docs/traceability.yaml`

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s12.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S13-resumption-capsule origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S13 `in_progress` state before the first implementation checkpoint.

## S13 objective

The Resumption Capsule: a verifiable capsule preserving goal, task, artifact, decision and causal lineage so work can continue across model, agent or session changes — with environment drift discoverable rather than silently tolerated.

Required deliverables (per the roadmap and FR-CONT-003):

1. A versioned capsule schema: goal/task lineage, referenced artifacts (content-addressed), decision pointers and a causal-chain digest binding it all; deterministic validation.
2. Capsule creation from the durable event store's authoritative facts (no invented state) and verification against it.
3. Continuation semantics: a new session/task continues from a capsule with full lineage, not a prompt replay.
4. Environment drift detection: workspace fingerprint and referenced-artifact verification at resume; drift is an explicit reconcile state (per the S07 worktree semantics), never silently ignored.
5. Capsule portability is evidence-bound: any consumer can re-verify the capsule digests without trusting the producer.
6. A S13 verifier and strict remote verifier preserving every S00-S12 gate.

## Adversarial acceptance (minimum)

- capsule digest mismatch (tampered capsule) fails closed;
- capsules referencing unknown or mutated artifacts fail verification;
- resumed lineage equals the recorded lineage (no silent truncation or extension);
- environment drift between capsule and current workspace surfaces as reconcile, not silent continue;
- cross-workspace capsule injection fails;
- unknown capsule versions fail closed.

## Segment publication protocol

Unchanged from S12: one Segment branch, explicit staging, full local gate (`cargo fmt --check`, strict clippy, `cargo test --workspace --locked`, `pnpm verify`, `pnpm acceptance:new-machine`), truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S13 verification, atomic completion record through a second protected PR, then annotated `s13-complete`.

Never mark S13 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
