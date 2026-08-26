# S07 Cross-model Execution Handoff

This is the pause point after the S06 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s06-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S07-tool-broker`
- S07 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S07：Tool Broker 与可恢复修改"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s06-complete
git rev-parse 's06-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s06-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-007-deterministic-monotonic-policy-enforcement.md`
7. `docs/adr/ADR-008-sandbox-secret-egress-fail-closed-boundaries.md`
8. S06/S07 and FR-RUN entries in `docs/traceability.yaml`

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s06.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S07-tool-broker origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S07 `in_progress` state before the first implementation checkpoint.

## S07 objective

Give every tool-mediated modification a uniform, recoverable lifecycle. Tools describe their contract before authorization, execute only through the S06 broker boundary (validated sandbox plan, secret leases, egress authorization) and the S05/S04 ordering (audit-before-effect, durable intent/result/verification), and every mutation lands in an explicitly mounted worktree/overlay checkpoint so failures roll back or surface as explicitly non-retriable.

Required deliverables:

1. A versioned Tool SPI with `describe`/`authorize`/`prepare`/`execute`/`verify`/`compensate` phases; no tool may skip a phase or self-report success without verification evidence.
2. Read-only tools first: `read`, `stat`, `hash`, `git diff`, `git status`; then mutation tools `patch` and `shell`/`test` executing inside S2/S3 realms via the S06 registry.
3. Every side effect records intent, then result, then verification through the S04 outbox; a successful effect without verified result stays a reconciliation case.
4. All mutations target overlay/worktree mounts declared in the sandbox plan; the workspace root stays read-only (INV-04, ADR-008).
5. External edits and Git fingerprint changes (index/stash/worktree drift) enter an explicit Reconcile state instead of being silently overwritten.
6. A S07 verifier and strict remote verifier preserving every S00-S06 gate.

## Adversarial acceptance (minimum)

- forged success: a tool claiming completion without artifact/verification evidence must be rejected;
- mutation outside a declared overlay mount must fail closed;
- crash between intent/result/verification must replay without duplicating external effects;
- compensation failures must be explicitly non-retriable with durable evidence;
- concurrent tool runs on one worktree must serialize or refuse;
- reconcile must detect external modification of tracked paths and Git fingerprint drift.

## Segment publication protocol

Unchanged from S06: one Segment branch, explicit staging, full local gate (`cargo fmt --check`, strict clippy, `cargo test --workspace --locked`, `pnpm verify`, `pnpm acceptance:new-machine`), truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S07 verification, atomic completion record through a second protected PR, then annotated `s07-complete`.

Never mark S07 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
