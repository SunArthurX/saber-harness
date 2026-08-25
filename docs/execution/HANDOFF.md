# S03 Handoff

Status: completed atomically when the S03 completion PR is merged through protected main
Date: 2026-08-25
Branch: `segment/S03-complete`
Base: `s02-complete` / `333272ce33fb54316a08ce8014ae63081c080a8c`

## Objective

Make JSON Schema 2020-12 the canonical Saber wire vocabulary, generate Rust and TypeScript types deterministically, and establish a bounded, versioned JSON-RPC 2.0 local protocol contract for Unix sockets and Windows named pipes.

## Completed

- Defined closed Workspace, Goal, Task, Run, Artifact, Decision, Memory, Capability, Incident and EvolutionCandidate entities plus a policy-aware EventEnvelope.
- Added V1 and frozen N-1 protocol declarations with request, actor, workspace, causation, deadline and idempotency metadata.
- Added deterministic checked-in Rust and TypeScript generation; CI rejects stale generated contracts.
- Rust and TypeScript decoders reject oversized frames, invalid UTF-8/JSON, unknown fields and methods, incompatible versions, expired deadlines and missing mutation idempotency.
- Rust provides exact replay/conflict semantics and platform-specific Unix socket/named-pipe endpoint construction.
- Shared fixtures and strict generated enums keep both language surfaces aligned; malformed-frame and invalid-state tests fail closed.
- Local full verification and the pinned-toolchain acceptance Gate passed before publication.
- Implementation branch `776a7d1244546ec3f5da3e15de4ada745363ae68` matched the remote; push and PR workflow sets both passed all five required contexts.
- PR #15 squash-merged through protected main as `cb16be2ee9fea1880033e3e78867f09dbd16451d`.
- Main runs `32858282014` (repository verification), `32858282033` (provenance) and `32858281980` (platform matrix and dependency audit) passed at the merge SHA.
- A standard public HTTPS clone fetched S00/S01/S02 tags and passed frozen installation plus all gates in 19 seconds from ambient Node 25 via pinned Node 24.15.0.
- Strict remote S03 verification confirmed public visibility, security controls, protected-main rules, canonical contracts and same-SHA successful workflows.

## Acceptance result

| Item | State | Evidence |
|---|---|---|
| Segment push/SHA equality | passed | branch and remote matched at `776a7d1244546ec3f5da3e15de4ada745363ae68` |
| Cross-language contract | passed | deterministic generation, 6 Rust tests, 5 TypeScript tests and shared fixtures |
| Three-platform CI | passed | Linux 46s, macOS 1m11s and Windows 1m41s on main run `32858281980` |
| Dependency and security gates | passed | pnpm audit, RustSec, secret scan, push protection and Dependabot controls |
| Protected-main integration | passed | PR #15 merged only after all required checks |
| Clean-clone acceptance | passed | public HTTPS clone passed all gates in 19s at `cb16be2...` |
| Atomic completion record | passed on merge | this state reaches main only through required CI and PR protection |

## Non-negotiable review points

- JSON Schema remains canonical; generated Rust and TypeScript wire types are not edited manually.
- Trusted authority remains in Rust; TypeScript validation cannot widen the Rust acceptance boundary.
- Protocol N/N-1, frame, deadline and idempotency checks fail closed.
- Policy, sandbox, secret, egress, audit, update and recovery controls are not weakened to accept a request.
- S04 persistence must preserve event causality and idempotency transactionally rather than relying on process-local state.

## Next action

1. Confirm the atomic S03 completion PR and resulting main workflows are green.
2. Create the `s03-complete` tag at that verified main commit.
3. Create `segment/S04-event-store` from protected `origin/main`.
