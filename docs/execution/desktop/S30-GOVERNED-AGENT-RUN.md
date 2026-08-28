# S30 Runbook — Governed Agent Run

Status: planned

Release train: RT-1 Governed Coding Alpha — first desktop CodingAgent MVP

Duration: 10-15 working days

Owners: Agent Architect (A), Runtime and Frontend Engineers (R), Security
Engineer (R), SDET (R)

Risk: critical

## Outcome

A user turns a conversation into an editable Goal and Plan, starts a real Agent
Run, observes durable Tool events, grants only exact approvals and can pause,
steer, cancel, resume or fork without losing causal history.

## Competitive-derived requirements

- `CDX-01`, `ZCD-01`: the project command center exposes Goals, Tasks and Run
  state without collapsing them into one chat transcript.
- `CDX-05`, `ZCD-02`, `MMX-02`, `MMX-05`: Core Goal Supervisor evaluates
  frozen Acceptance after
  every round through an independent Verifier and records continue, revise,
  pause, escalate, budget-exhausted or complete.
- `MMX-03`: the lead conversation remains responsive while work runs; control
  messages become explicit Steer events rather than contaminating worker input.
- `CDX-04`: distinguish an independent Automation Run from a Goal Heartbeat
  that returns to existing context, with overlap, missed-run and stop rules.
- `CLD-04`: proposed out-of-scope work is a reviewable Task Proposal, not a
  silently spawned session.

## Work packages

### S30-WP01 — Goal and Plan authoring

- Goal fields: objective, acceptance, constraints, budget, deadline, owner and
  evidence requirements.
- Plan has immutable versions; edits Diff tasks, dependencies, permissions,
  budget and acceptance.
- Starting a Run binds one plan version, model route, Realm, Worktree, policy
  snapshot and idempotency key.
- Agent replan is a proposal; user acceptance criteria cannot change silently.

### S30-WP02 — Run and Tool timeline

- Project queued, planning, running, waiting approval, waiting user, paused,
  verifying, succeeded, failed, cancelled and recovering states.
- Display observable events, not invented progress percentage or hidden thought.
- Cursor replay deduplicates and orders causation; late or stale events cannot
  regress terminal state.
- Tool summary states exact resource, Realm, duration, result and evidence ID.

### S30-WP03 — Approval Queue

- Card shows action, exact resource/argv, reason, boundary, network, secret
  references, expiry, one-shot scope and alternatives.
- Always show Deny; Narrow Scope cannot broaden the request.
- Expired, revoked, replayed, changed-resource and changed-plan approvals fail.
- The executed effect digest must match the approved digest and displayed card.

### S30-WP04 — Runtime control

- Pause stops scheduling new effects at a defined safe event boundary.
- Steer creates a causal user event and states whether it applies now or after
  the current effect.
- Cancel propagates to Tool, sub-process and Realm; partial effects enter
  compensation/recovery.
- Resume revalidates environment and policy; Fork creates explicit lineage.

### S30-WP05 — Desktop UX and notifications

- Run state appears in Task tree, Conversation, Timeline and Vital Bar from one
  projection.
- Notifications fire only for user action, terminal result or incident.
- Closing a window does not cancel a Run; quitting with active Runs offers
  background, pause or cancel with truthful consequences.
- Reopen lands on the active Task, not Command Center unless the user chose it.

### S30-WP06 — Real-repository vertical test

Use an owned fixture repository requiring read, edit, command, test and a denied
network attempt. Prove exact approval, event persistence, interruption, resume
and evidence linkage. Never use a private customer repository in CI.

## Verification

```sh
node scripts/verify-s30.mjs
pnpm desktop:test:goal-plan
pnpm desktop:test:approval-adversarial
pnpm desktop:e2e:governed-run
pnpm desktop:test:run-controls
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- One real fixture task completes through the packaged desktop and real Core.
- Every effect has prior policy/approval evidence and matching result digest.
- Pause, Steer, Cancel, Resume and Fork obey documented event boundaries.
- Renderer restart and app close preserve the Run.
- No UI state can assert success without Core terminal evidence.
