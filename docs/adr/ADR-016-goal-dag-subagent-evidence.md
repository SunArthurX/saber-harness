# ADR-016 — Goal DAG, Attenuated Subagents and Evidence Judgment

Status: accepted
Date: 2026-08-28
Deciders: repository owner and S14 architecture review

## Context

Goals must decompose into parallelizable work, but orchestration is a
privileged surface: a subagent that could widen its own authority, fake a
sibling's result, or mark its own task complete by self-report would
recreate the trust holes S05-S13 closed (TM-08, TM-09, INV-01). The
roadmap requires a typed Goal DAG, attenuated task-scoped delegation with
budgets and isolated failure domains, and evidence-judged completion
(S14 gate: 证据判定完成).

## Decision

### The DAG is typed and total

A `GoalDag` maps task ids to nodes carrying dependencies and declared
acceptance evidence. Validation is total before any scheduling: unknown
dependency references and cycles (DFS over the graph) are rejected. The
scheduler exposes only tasks whose dependencies are all
evidence-complete; ordering among simultaneously ready tasks is
deterministic (sorted by task id). A task cannot run before its
dependencies by construction — there is no API that starts an unready
task.

### Delegation only attenuates

A delegation request is a set of capability grants (action + resource
selector). The orchestrator issues a delegation only when every requested
grant sits strictly within a parent grant: same action, and a selector
that is equal to or narrower than the parent's. Retries re-derive
attenuation from the parent each time — an exhausted or failed delegation
can never come back wider. Delegations carry a token budget and a failure
domain scoped to their task.

### Completion is judged, not reported

A subagent reports evidence items; a task completes only when the
reported evidence matches the task's declared acceptance evidence
exactly — artifact digests recomputed by the judge, command outcomes
verified — and the report carries the subagent identity the delegation
assigned. Self-reported success without evidence, evidence missing from
the declaration, mutated digests and spoofed identities are rejected
(TM-08); rejected reports may retry within bounds, never with more
authority.

### Failure domains and cancellation

Budget exhaustion or subagent failure fails that task alone; sibling
tasks and the goal continue. Retries are bounded per task. Cancellation
marks the target task and every transitive descendant cancelled — exactly
once, idempotently — without touching unrelated branches.

## Consequences

- Orchestration is a pure state machine: schedulability, judgment and
  cancellation are deterministic and exhaustively testable without I/O.
- The S05/S06 boundaries remain the effect path; the orchestrator only
  decides who may attempt what and whether it counted.
- Parallelism is bounded by DAG shape, not by subagent appetite.

## Rejected alternatives

- Self-assessed completion: the forged-success hole (TM-08).
- Delegating parent authority wholesale: ambient authority reborn.
- Retrying with escalated grants on failure: failure would widen
  authority — the exact inversion of least privilege.

## Verification

- Cycles and unknown dependencies rejected; dependency-order violations
  impossible through the scheduler API.
- Delegations beyond parent attenuation refused; retries never widen.
- Reports without matching declared evidence rejected; forged identities
  and mutated digests rejected.
- Budget exhaustion fails only its task.
- Cancellation cascades to descendants exactly once.
