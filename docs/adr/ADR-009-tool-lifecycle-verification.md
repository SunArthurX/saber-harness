# ADR-009 — Verified Tool Lifecycle and Recoverable Modifications

Status: accepted
Date: 2026-08-27
Deciders: repository owner and S07 architecture review

## Context

S06 made every effect cross a deterministic policy, sandbox, secret and egress boundary, but tools still need a uniform lifecycle: a tool that self-reports success without independent evidence can forge completion, mutations can land outside a recoverable worktree, and external edits during a run can silently invalidate assumptions. The S07 roadmap demands `describe`/`authorize`/`prepare`/`execute`/`verify`/`compensate`, intent-before-result-before-verification ordering, overlay-only mutation, and explicit reconciliation of external drift.

## Decision

### Six-phase lifecycle as a typed state machine

One `ToolBroker` orchestrates every tool invocation. `describe` yields the frozen per-tool contract (name, bound capability action, mutating flag, argument shape) before any authorization exists. `authorize` reuses the S06 `EffectBroker` unchanged: policy decision, durable intent, sandbox realm, secret leases, egress authorization. `prepare` acquires the worktree mutation lock, snapshots the overlay inventory and records a fingerprint. `execute` runs inside the S2/S3 realm through the same boundary. `verify` independently recomputes deterministic evidence — it never trusts the tool's self-report. `compensate` restores the snapshot when verification or execution fails. Skipping or reordering phases is represented only as an explicit error, never as best-effort continuation.

### No forged success

An invocation is successful only when `verify` produced matching evidence: content hashes recomputed through the `PathGuard` for file-producing tools, exit-status evidence for shell/test tools, and inventory-delta evidence for mutations. A tool returning exit 0 without the declared artifact — or with an artifact whose hash differs from the declaration — records a failed, non-retriable result. Verification itself is journaled as its own read-only effect (intent then result) through the same S04 durable path, so ordering is intent → result → verification, each independently replayable.

### Overlay-only mutation with checkpoint compensation

Every mutating tool declares an overlay root that must appear as a writable `Overlay` mount in the validated sandbox plan. `prepare` stores a full inventory snapshot (sorted relative paths plus content hashes) plus a fingerprint (inventory digest combined with a `git status --porcelain` digest when the overlay contains a repository). `compensate` restores the inventory exactly. A compensation failure is terminal: the outcome is classified non-retriable with durable evidence, never retried silently.

### Failure taxonomy

`Retriable` (worktree busy, transient sandbox unavailability), `NonRetriable` (verification mismatch, compensation failure, invalid declaration), `NeedsReconcile` (external drift). Only `Retriable` failures may be automatically re-attempted.

### External-edit and Git-fingerprint reconciliation

After execution the observed inventory delta must equal exactly the tool's declared mutations. Any undeclared change — an external editor touching a tracked file, or a Git index/status drift between `git status --porcelain` digests — moves the worktree into a `NeedsReconcile` outcome: the tool's own changes are compensated where possible, and further mutation of that worktree requires an explicit reconcile action. Reconciliation is a distinct state, not a retry.

### Concurrency

Worktree mutation is guarded by a per-overlay-root lock inside the broker. A second concurrent mutation on the same root is refused with a retriable `WorktreeBusy` outcome rather than queued; serialization policy above single-lock refusal belongs to the future scheduler.

### Crash recovery

Execution and verification ride the S04 outbox: a crash after intent but before result leaves a pending effect that recovery replays once under its idempotency key; the verification effect cannot exist without its execution intent, so partial recovery cannot forge success.

## Consequences

- Tool authors must declare expected artifacts (paths and hashes) up front; undeclared output cannot contribute to success.
- Whole-file content patches are the S07 mutation primitive; unified-diff application joins with the IDE loop (S11) without changing this contract.
- Reconciliation requires operator/model attention; the broker never auto-resolves drift.
- Read-only tools (`read`, `stat`, `hash`, `git status`, `git diff`) still verify by independent recomputation, keeping the "no forged success" invariant uniform.

## Rejected alternatives

- Trusting tool-exit status as success: the forged-success hole this ADR exists to close.
- Verify-before-execute only: post-execution drift would be invisible.
- Queuing concurrent mutations: hides contention and complicates recovery semantics at no S07 benefit.
- Auto-retrying compensation: a failed rollback means unknown on-disk state; only explicit reconciliation is safe.

## Verification

- Forged-success, undeclared-artifact and hash-mismatch denials.
- Mutation outside a declared overlay mount fails closed before any effect.
- Crash between intent and result replays exactly once through the S04 store.
- Compensation restores inventories; compensation failure is durably non-retriable.
- Concurrent mutations on one worktree are refused.
- External edits and Git fingerprint drift produce `NeedsReconcile` with compensation evidence.
- S07 verifier and strict remote verifier preserve every S00-S06 gate.
