# ADR-022 — Remote Execution Realm

Status: accepted
Date: 2026-08-29
Deciders: repository owner and S20 architecture review

## Context

Heavyweight work (long builds, big test suites, batch imports) needs
remote capacity, but the local trust boundary must stay sovereign: a
remote realm must not widen policy, fabricate success, or let its
failures spread locally (Gate: 远程故障不扩散; TM-08/TM-09 parity).

## Decision

### The policy envelope travels; decisions do not

Remote submissions carry the SAME capability envelope (action, resource
selector, data class) bound with a digest. The realm never re-decides
policy: it executes under the envelope it received, and any tampering
with the envelope in transit is detected by digest mismatch and
refused. Local policy remains the only decision point.

### Deterministic remote state machine with heartbeat leases

Remote tasks walk submitted → running → (succeeded | failed | cancelled)
with heartbeat leases. Missed heartbeats past the lease deadline reap
the task as failed — a crashed realm can never report success, and a
stale success arriving after reaping is refused.

### Results re-enter as evidence

Remote results are admitted only with matching digests of the claimed
artifacts; returned data is taint-labeled (`untrusted_source` unless
the envelope proves otherwise) before any fabric admission. No remote
output auto-promotes (INV-02/INV-03 parity).

### Failures stay in the remote cell

Timeout, divergence and hostile output fail that remote cell only; the
S18 health ladder treats remote signals like any other observation, and
local Safe Mode is never entered by a remote fault below the critical
thresholds.

## Consequences

- Remote capacity is an extension of local authority, not a second
  authority.
- Reaping is deliberately conservative: a lost heartbeat fails the
  task; idempotent resubmission is the recovery path.
- Returned data inherits taint until locally verified.

## Rejected alternatives

- Remote-side policy evaluation: two decision points, drift and
  widening risk.
- Trusting remote success claims: TM-08's false-success hole.
- Untainted ingestion of returned data: contamination vector.

## Verification

- Envelope tampering refused; crashed/timed-out realms never report
  success; stale successes refused after reaping.
- Results without matching digests refused; returns taint-labeled.
- Remote faults contained to their cell; cancellation propagates
  deterministically.
