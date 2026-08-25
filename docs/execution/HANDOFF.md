# S03 Handoff

Status: in progress
Date: 2026-08-25
Branch: `segment/S03-domain-protocol`
Base: `s02-complete` / `333272ce33fb54316a08ce8014ae63081c080a8c`

## Objective

Make JSON Schema 2020-12 the canonical Saber wire vocabulary, generate Rust and TypeScript types deterministically, and implement a bounded JSON-RPC 2.0 local protocol contract for Unix sockets and Windows named pipes.

## Implemented locally

- Defined Workspace, Goal, Task, Run, Artifact, Decision, Memory, Capability, Incident, EvolutionCandidate and EventEnvelope.
- Event envelopes carry version, actor, workspace, causation/correlation, sensitivity, policy snapshot and payload fields.
- Added V1 and frozen N-1 protocol declarations with a closed request context and five lifecycle methods.
- Added deterministic checked-in Rust and TypeScript code generation from the canonical schemas.
- Rust and TypeScript decoders enforce 1 MiB frames, N/N-1, deadlines, closed metadata, known methods and mutation idempotency.
- Rust provides exact-replay/conflict semantics and platform-specific Unix socket/named-pipe address construction.
- Shared fixtures cover cross-language control and domain contracts; malformed-frame loops exercise the decoder boundary.

## Current evidence

- Six Rust protocol tests pass; five TypeScript runtime tests and the CLI smoke test pass.
- Rust fmt/clippy, deterministic generation, Biome, typecheck, build and license policy pass.
- S00 regression passed 525 checks, S01 passed 68, S02 passed 66, S03 passed 71 and repository governance passed 15 tests.
- The pinned-toolchain new-machine acceptance Gate passed locally in 8 seconds.
- Hosted CI, protected integration and clean-clone acceptance remain pending.

## Next action

1. Review and commit the complete Segment diff.
2. Push and verify the branch SHA and hosted Linux/macOS/Windows gates.
3. Use the protected PR and clean-clone completion flow.
