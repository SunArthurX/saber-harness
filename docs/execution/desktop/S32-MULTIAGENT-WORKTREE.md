# S32 Runbook — Multi-Agent and Worktree

Status: planned

Release train: RT-2 Collaborative Continuity Beta

Duration: 10-15 working days

Owners: Orchestration Lead (A), Git/Runtime/Editor Engineers (R), Security and
SDET (R)

Risk: critical

## Outcome

One Goal can delegate bounded Tasks to multiple Agents. Each has an explicit
Worktree, Realm, model, budget and capability set; users can follow, steer,
pause, take over and review deterministic integration without collapsing
failure domains.

## Competitive-derived requirements

- `CDX-02`, `CLD-05`: Local/Worktree/SSH/Cloud handoff and multi-repository
  selection are explicit Realm transitions with drift and trust receipts.
- `MMX-01`: a Team Value Decision explains solo/team choice from dependency
  width, risk, uncertainty, domain diversity, verification cost and budget.
- `MMX-02`, `MMX-07`: implement Leader/Worker/Verifier as runtime states with
  independent verification, bounded repair loops and human escalation.
- `ZCD-06`: every role declares model, reasoning level, tools, maximum turns,
  Realm, Worktree and budget; foreground/background changes scheduling only.
- `CLD-04`, `MMX-03`, `MMX-06`: Cross-Task Messages, Task Proposals and the
  pull-based Knowledge Board preserve source, audience, taint and receiving
  Policy while the lead remains responsive.

## Advanced harness and philosophy requirements

- `CUR-04`, `ZED-03`, `ZED-04`, `ZED-06`: parallel/local/background Agents keep
  per-Task Worktree/Realm identity, restore proof, status and governed takeover.
- `OHD-04`, `AID-02`: heterogeneous backends and Planner/Producer/Verifier
  roles share one Goal DAG, budget and Evidence grammar.
- `AID-03`: integration and rollback distinguish baseline dirty state, manual
  edits, Agent-owned edits and reviewed combined edits.
- Prove `PHL-10`: Agent consensus and cross-Task messages cannot launder
  capability, Policy or completion authority.

## Work packages

### S32-WP01 — Goal DAG UI

- Task nodes show dependency, acceptance, Agent, model, Realm, Worktree, budget,
  status and evidence Gate.
- Cycle, missing dependency and impossible budget fail before dispatch.
- Critical path and waiting reasons are computed from durable state; no vague
  percentage without a calculable plan.

### S32-WP02 — Worktree lifecycle

- Create from an explicit commit with collision-safe path and owner metadata.
- Detect dirty base, external deletion, branch move and filesystem case conflict.
- Cleanup requires terminal Task, preserved artifacts and no unreviewed changes;
  default to recoverable quarantine rather than deletion.
- Never use destructive Git reset/checkout to resolve user changes.

### S32-WP03 — Delegation and budgets

- Bind each Task to least capabilities, model route, context scope, Realm and
  token/money/time/tool budgets.
- Child cannot widen parent policy, secret, network or data scope.
- Budget exhaustion pauses with evidence; it does not silently route to a more
  expensive or less private provider.

### S32-WP04 — Follow, steer and take over

- Follow filters Timeline to one Agent while preserving Goal causality.
- Queued messages show delivery boundary and can be cancelled.
- Take over pauses the Agent and verifies the current Worktree before user edit.
- Moving Realm or model creates a revalidation boundary and Capability Diff.

### S32-WP05 — Conflict and integration

- Detect overlapping files, semantic conflicts, dependency conflicts and test
  invalidation before merge.
- Propose integration order with rationale and per-Task evidence.
- Integration occurs in a dedicated review Worktree through Core.
- Rejected Task output remains auditable and removable without deleting source
  evidence.

### S32-WP06 — Fault game day

Inject child crash, Realm loss, runaway budget, conflicting changes, stale base,
cancel cascade and malicious subagent result. Prove sibling containment,
bounded cleanup and accurate Goal state.

## Verification

```sh
node scripts/verify-s32.mjs
pnpm desktop:test:goal-dag
pnpm desktop:test:worktree-lifecycle
pnpm desktop:test:multiagent-faults
pnpm desktop:e2e:parallel-integration
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- Two or more Tasks execute concurrently without sharing Worktree authority.
- Child scope never exceeds parent scope.
- Conflict integration is reviewable, replayable and rollback-capable.
- Cancellation and failure do not corrupt sibling or Goal state.
