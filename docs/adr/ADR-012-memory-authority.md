# ADR-012 — Single-Writer Memory Authority

Status: accepted
Date: 2026-08-27
Deciders: repository owner and S10 architecture review

## Context

Durable memory is the highest-leverage poisoning surface (TM-06): imported
content, tool output or a compromised run that could write "memory" as
truth would steer every future decision. The roadmap requires one Memory
Authority per workspace promoting typed candidates through conflict,
revision, TTL and revocation rules; INV-03 already fixed that candidate,
review and promotion are distinct states nothing may skip.

## Decision

### One authority, one write path

Each workspace owns exactly one `MemoryAuthority`. Every mutation — propose,
promote, revoke, expire — is a method on it with a monotonic write sequence,
so concurrent writers serialize through the single authority and no update
is lost. There is no API that mutates memory from outside the authority.

### Candidate is not promoted (typed, not documented)

Proposals enter as `Candidate` regardless of provenance confidence.
Promotion requires an explicit `ReviewAuthority` value — a human review id
or a named policy rule — and the type has no runtime-evidence variant at
all: a run cannot promote its own output because no such authority can be
constructed. Unclassified proposals (missing sensitivity or origin) and
cross-workspace injections are rejected at admission.

### Conflicts produce revisions, never overwrites

Memory is keyed; promoting a value that contradicts the current promoted
revision appends a new revision and marks the previous one superseded with
a conflict link. History is immutable and queryable; nothing is silently
replaced. Identical re-promotions are idempotent no-ops. Conflict outcomes
are deterministic for identical inputs (stable entry ids derived from
key/value/origin/revision).

### Staleness and revocation are states, not deletions

Expired TTL transitions entries to `Stale`; stale memories never surface as
truth in queries (the revision history remains inspectable). Revocation
moves entries to `Revoked` and removes them from every query immediately
while retaining the audit trail. Both carry stable event names
(`memory.proposed`, `memory.promoted`, `memory.revoked`, `memory.stale`)
with metadata-only payloads for the durable journal.

### Queries honor scope, state and classification

Truth queries return only `Promoted`, non-expired entries of the
authority's own workspace within the asker's classification ceiling — the
same semantics the S09 fabric enforces for context, so memory and context
cannot disagree about visibility.

## Consequences

- Memory volume grows with revision history; compaction is a future,
  explicitly reviewed operation, never automatic deletion.
- Automatic memory formation (distillation pipelines) always lands in the
  candidate pool and waits for review authority; latency of promotion is a
  product choice, not a safety compromise.
- The authority is pure state; persistence rides the S04 event store via
  the recorded event trail in later integration.

## Rejected alternatives

- Auto-promotion with confidence thresholds: a poisoned metric becomes
  truth (TM-06).
- Last-write-wins with tombstones: contradicts revision history and
  deterministic conflict resolution.
- Per-module memory writers: reintroduces ambient writes and lost updates.

## Verification

- Poisoned/untrusted candidates never leave the candidate pool without an
  explicit review authority.
- Concurrent proposals serialize; no lost updates; deterministic ids.
- Contradicting promotions create linked revisions with intact history;
  identical promotions are idempotent.
- TTL expiry and revocation remove entries from queries immediately.
- Cross-workspace injections and unclassified proposals fail closed.
- S10 verifier and strict remote verifier preserve every S00-S09 gate.
