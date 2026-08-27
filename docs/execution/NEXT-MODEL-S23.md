# S23 Cross-model Execution Handoff

This is the pause point after the S22 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness.git`
- Completed tag: `s22-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S23-design-partner-beta`
- S23 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S23：跨平台 Design Partner Beta"

## Mandatory startup

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s22-complete
git rev-parse 's22-complete^{}'
git rev-parse origin/main
```

The worktree must be clean; the tag must be annotated and an ancestor of `origin/main`. Read AGENTS.md, STATE.yaml, HANDOFF.md, EVIDENCE.json, ROADMAP.md and ADR-024. Verify the inherited boundary:

```sh
node scripts/verify-remote-s22.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those pass: `git switch -c segment/S23-design-partner-beta origin/main`, then immediately update STATE.yaml, HANDOFF.md and EVIDENCE.json to truthful S23 `in_progress` state.

## S23 objective

The Design Partner Beta: real projects on all three platforms with SLO measurement — startup time, memory, end-to-end task latency, CI time — plus telemetry (opt-in, metadata-only), a beta onboarding flow and a feedback loop into the evolution workshop (Gate: 真实项目 SLO).

Required deliverables:

1. A benchmark harness: deterministic, reproducible SLO measurement suites for startup, memory and task latency that run on CI (three platforms) and locally.
2. SLO budgets as tested contracts: startup/memory/latency ceilings fail CI when exceeded (no silent regressions).
3. Opt-in metadata-only telemetry contracts (no plaintext, no content).
4. Beta onboarding: a single-command bootstrap bringing a new machine from clone to green acceptance.
5. A feedback intake that routes partner issues into the S15 evolution workshop as candidates (never direct capability).
6. A S23 verifier and strict remote verifier preserving every S00-S22 gate.

## Adversarial acceptance (minimum)

- SLO regression beyond budget fails the gate (proven with an intentionally over-budget case);
- telemetry payloads contain no plaintext/credentials (canary);
- feedback intake cannot promote itself (candidates only);
- benchmarks are deterministic across runs on the same platform;
- onboarding works from a clean clone with no network beyond the package registry.

## Segment publication protocol

Unchanged from S22: one Segment branch, explicit staging, full local gate, truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S23 verification, atomic completion record through a second protected PR, then annotated `s23-complete`.

Never mark S23 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
