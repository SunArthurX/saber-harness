# S14 Cross-model Execution Handoff

This is the pause point after the S13 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s13-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S14-goal-dag-subagents`
- S14 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S14：Goal DAG/Subagents"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s13-complete
git rev-parse 's13-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s13-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-015`
7. FR-RUN-007 and related entries in `docs/traceability.yaml`

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s13.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S14-goal-dag-subagents origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S14 `in_progress` state before the first implementation checkpoint.

## S14 objective

The Goal DAG and subagent delegation: decompose goals into a typed dependency DAG of tasks, delegate subagents with attenuated task-scoped capabilities, budgets and isolated failure domains, and judge task completion by verified evidence — never by a subagent's self-report (TM-08).

Required deliverables (per the roadmap and FR-RUN-007):

1. A typed Goal DAG: tasks with dependencies, cycle detection, deterministic scheduling order; no task runs before its dependencies are evidence-complete.
2. Subagent delegation with attenuated authority: task-scoped capability grants strictly narrower than the parent's (never wider), bounded budgets and isolated failure domains.
3. Evidence-based completion: a task is complete only when its declared acceptance evidence verifies (no forged success at the orchestration layer).
4. Failure domains: a subagent crash/budget exhaustion fails its task, not the goal; retries are bounded and never widen authority.
5. Cancellation propagates through the DAG deterministically.
6. A S14 verifier and strict remote verifier preserving every S00-S13 gate.

## Adversarial acceptance (minimum)

- DAG cycles rejected; dependency-order violations impossible;
- a subagent cannot exercise capabilities beyond its attenuation;
- self-reported success without evidence is rejected;
- budget exhaustion fails the task without leaking into siblings;
- forged subagent results (spoofed identity/artifacts) rejected (TM-08);
- cancellation stops all in-flight descendants exactly once.

## Segment publication protocol

Unchanged from S13: one Segment branch, explicit staging, full local gate (`cargo fmt --check`, strict clippy, `cargo test --workspace --locked`, `pnpm verify`, `pnpm acceptance:new-machine`), truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S14 verification, atomic completion record through a second protected PR, then annotated `s14-complete`.

Never mark S14 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
