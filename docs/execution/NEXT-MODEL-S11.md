# S11 Cross-model Execution Handoff

This is the pause point after the S10 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s10-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S11-codeoss-ide-loop`
- S11 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S11：Code-OSS 纵向 IDE 闭环"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s10-complete
git rev-parse 's10-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s10-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-011` and `docs/adr/ADR-012`
7. FR-CONT and IDE-related entries in `docs/traceability.yaml`

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s10.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S11-codeoss-ide-loop origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S11 `in_progress` state before the first implementation checkpoint.

## S11 objective

Deliver the vertical IDE closure over the Code-OSS shell: the renderer talks exclusively to the trusted Core through the S03 control protocol (versioned schema, actor identity, size/deadline, policy); a renderer crash never kills a Run (the run lives in the Core); IDE-side chat, diffs, approvals and context explanations consume the S05-S10 contracts rather than reimplementing them.

Required deliverables (per the roadmap):

1. A versioned IDE client contract (schema-generated TypeScript types) with no direct host access: every effect routes through the Core PEP boundary.
2. Run-view resilience: UI lifecycle is fully decoupled from Run lifecycle (reconnect/replay semantics over the durable event store).
3. Approval UI surface bound to the S05 approval contract (exact scope, TTL, minimum alternatives, no dark patterns).
4. Context explanation surface bound to the S09 explain contract (nutrition labels, redactions, exclude/revoke actions).
5. A simulated-IDE integration harness proving UI crash/restart does not affect run state.
6. A S11 verifier and strict remote verifier preserving every S00-S10 gate.

## Adversarial acceptance (minimum)

- renderer crash/restart mid-run leaves run state untouched and replayable;
- no renderer-originated effect bypasses policy/sandbox/egress (TB-01);
- approval UI cannot render a broader scope than the request;
- context explanations cannot display redacted fields;
- schema/version mismatch fails closed at the protocol boundary.

## Segment publication protocol

Unchanged from S10: one Segment branch, explicit staging, full local gate (`cargo fmt --check`, strict clippy, `cargo test --workspace --locked`, `pnpm verify`, `pnpm acceptance:new-machine`), truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S11 verification, atomic completion record through a second protected PR, then annotated `s11-complete`.

Never mark S11 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
