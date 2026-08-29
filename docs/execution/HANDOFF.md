# S30 Handoff — Governed Agent Run (RT-1 MVP)

Status: completed — PR #79 merged (5c85980) with all five required checks green (monorepo legs ran the real-Core e2e) and all six main contexts green; this record closes S30 and the RT-1 MVP vertical. The annotated s30-complete tag follows this record's merge; S31 starts from its runbook in a new execution round
Date: 2026-08-29
Branch: `segment/S30-governed-agent-run`
Base main: `f169e57498cc35bd5f479302eb345a075339ea31` (`s29-complete`)
Runbook: `docs/execution/desktop/S30-GOVERNED-AGENT-RUN.md`

## Objective

A user turns a conversation into an editable Goal and Plan, starts a
real Agent Run, observes durable Tool events, grants only exact
approvals, and can pause, steer, cancel, resume or fork without losing
causal history.

## What landed

- **Core engine** (`crates/saber-core/src/run_engine.rs`): goals with
  frozen acceptance; immutable plan versions; run start bound to plan
  version, model route, Realm, worktree, policy snapshot and
  idempotency key; a deterministic fixture executor (file read/edit,
  node-only exact-argv commands inside the canonicalized worktree);
  network effects denied by policy BEFORE any attempt; exact one-shot
  approval cards (digest, expiry, plan version, scope narrowing,
  changed-resource) with every adversarial path failing closed; the
  independent verifier evaluating frozen acceptance with bound
  evidence; pause at safe boundaries; resume with policy-snapshot
  revalidation; steer as causal control events; cancel with
  compensation; fork/retry as explicit lineage. The engine index is a
  disposable projection rebuilt by replay.
- **Store**: exactly one additive `append_core_event` — transactional,
  idempotent, hash-chained like every other append.
- **Transport**: both the unix socket and the Windows named pipe server
  dispatch run methods through the shared `run_dispatch` module and
  advertise the capabilities in `core.initialize`.
- **Protocol**: six new methods (`goal.create`, `plan.freeze`,
  `run.start`, `run.pause`, `run.resume`, `approval.resolve`) in the
  schema, generated Rust/TS, agent-runtime and ide-client registries;
  mutations carry context idempotency keys (validated after the
  frame-size contract to preserve earlier ordering).
- **Projections**: `goalPlan.js` (immutable versions with diff facets,
  acceptance changes always visible, binding tuple),
  `runTimeline.js` (eleven UX states, cursor dedup, stale events
  cannot regress terminals, exact tool summaries, no invented
  progress), `approvalGate.js` (complete cards, deny always,
  narrowing cannot broaden, every adversarial preflight),
  `runControls.js` (pause/steer/cancel/resume/fork semantics, one
  projection for every surface, truthful quit options).
- **Evidence**: `desktop:test:goal-plan` (5), approval-adversarial (5),
  run-controls (9); `desktop:e2e:governed-run` — 27/27 against the
  real Core over the real socket through `fixtures/repos/basic`
  including a Core restart that preserves the whole journal;
  `verify-s30` (106 checks). The monorepo CI matrix now builds the
  Core and runs the e2e on every leg.

## Honest limits

- The model route is the deterministic fixture executor; provider-backed
  runs arrive in later segments.
- The e2e drives the Core binary directly; the packaged-desktop journey
  stays hosted desktop:build evidence.
- Sandbox realm integration (the S24 registry) is not yet wired into
  the run engine; commands run node-only exact argv inside the
  canonicalized worktree as an intermediate, policy-checked boundary.

## Next actions

1. Create annotated `s30-complete` on this record's merge commit;
   verify the peeled SHA equals that main commit locally and remotely.
2. S31 (change evidence review) starts only from
   `docs/execution/desktop/S31-CHANGE-EVIDENCE-REVIEW.md` in a new
   execution round.
