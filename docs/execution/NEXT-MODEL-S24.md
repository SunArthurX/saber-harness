# S24 Cross-model Execution Handoff

This is the pause point after the S23 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s23-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S24-production-gate`
- S24 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S24：Production Gate/E6 实验"

## Mandatory startup

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s23-complete
git rev-parse 's23-complete^{}'
git rev-parse origin/main
```

The worktree must be clean; the tag must be annotated and an ancestor of `origin/main`. Read AGENTS.md, STATE.yaml, HANDOFF.md, EVIDENCE.json, ROADMAP.md, ADR-025 and the E0-E7 boundary in the master plan. Verify the inherited boundary:

```sh
node scripts/verify-remote-s23.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those pass: `git switch -c segment/S24-production-gate origin/main`, then immediately update STATE.yaml, HANDOFF.md and EVIDENCE.json to truthful S24 `in_progress` state.

## S24 objective

The Production Gate: an auditable, deterministic readiness review proving that every prior segment's invariant holds on main, plus the explicitly gated E6 experiment boundary (Gate: 独立安全审查). S24 does not add features; it certifies the whole.

Required deliverables:

1. A production-gate evaluator: a pure audit over the repository state asserting the full invariant checklist (S00-S23 contracts present, verifiers chained, tags resolving, CI green history, no stale members, ADR coverage for every boundary change).
2. A readiness report model: pass/fail per invariant family with evidence references — exportable, metadata-only.
3. The E6 experiment boundary: E6 (self-modification of product code) remains proposal-only (protected PR with independent review); the gate asserts no autonomous E6/E7 path exists in the codebase surface.
4. An independent security review checklist mapped to the threat register (TM-01..TM-16 each with a covering control and test reference).
5. A S24 verifier and strict remote verifier preserving every S00-S23 gate; the final `s24-complete` tag marks the full 25-segment roadmap complete.

## Adversarial acceptance (minimum)

- a missing contract/verifier/tag fails the gate (proven with a negative fixture);
- the gate is deterministic across runs;
- every TM entry maps to a covering control;
- no autonomous E6/E7 path exists (structural assertion);
- the readiness report contains no secrets or plaintext content.

## Segment publication protocol

Unchanged from S23: one Segment branch, explicit staging, full local gate, truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S24 verification, atomic completion record through a second protected PR, then annotated `s24-complete`.

Never mark S24 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
