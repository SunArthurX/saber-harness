# S13 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-28
Branch: `segment/S13-completion`
Implementation branch: `segment/S13-resumption-capsule` @ `22d5a13ebb6abb0b8b71d380b185345bad2cd6f6`
Merged main: PR #37 squash-merged as `e6ac4839cb084d72d2ce21466427430ef3e6ea25`

## Objective

A verifiable Resumption Capsule preserving goal, task, artifact and decision causal lineage across model, agent or session changes, with environment drift discoverable rather than silently tolerated.

## What shipped (PR #37)

- ADR-015 froze the design; FR-CONT-003 realigned to S13 and implemented with evidence.
- `crates/resumption` (`saber-resumption`): versioned capsule envelope (schema 1.0.0) — scope, goal, ordered task lineage, content-addressed artifact references, decision pointers, workspace fingerprint at creation, `capsule_digest` over the canonical body and a derived capsule id; validation recomputes the chain so tampered capsules and unknown versions fail closed in any consumer without producer trust.
- Fact-bound creation: capsules build only from complete authoritative facts supplied by the durable event store; missing identifiers, empty lineage or malformed digests are refused — nothing is invented.
- Verification against the present world: scope gate (cross-workspace injection denied), per-artifact content digests and the workspace fingerprint; missing/mutated artifacts and fingerprint drift yield `NeedsReconcile` with exact drift evidence — never a silent continue (S07 semantics, the S13 gate 环境漂移可发现).
- Continuation is lineage, not replay: `continue_from` returns the recorded lineage verbatim only from a `Ready` verification; drifted environments must reconcile first.
- `verify-s13.mjs` (50 checks) and `verify-remote-s13.mjs` wired into `pnpm verify` and the repository-verification workflow.

## Verified evidence

- Full local gate: fmt, strict clippy, 29 Rust test suites (9 resumption adversarial tests), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI: push run `33038075282` green on all five required contexts at `22d5a13` on the first push.
- Protected integration: PR #37 merged after every required check; merge SHA `e6ac483`.
- Main workflows at `e6ac483`: provenance `33038543794`, repository verification `33038543799`, Monorepo CI `33038543832` all passed.
- Clean clone: anonymous HTTPS clone at `e6ac483` passed `pnpm acceptance:new-machine` in 84 seconds.
- Strict remote S13 verification passed at `e6ac483`.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s13.mjs --repository SunArthurX/saber-harness --branch main` (already green at the implementation SHA).
3. Create annotated `s13-complete` on the final commit.
4. Hand the next model `docs/execution/NEXT-MODEL-S14.md`.

## Non-negotiable review points

- Capsules are digest-bound fact sets, not prompts; tampering fails closed anywhere.
- Creation refuses incomplete facts; the event store remains the authority (INV-01).
- Drift is an explicit reconcile state with evidence, never a silent continue.
- Continuation carries the recorded lineage verbatim.

## Next action

Finish the publication protocol above; do not begin S14 in this session.
