# S11 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-27
Branch: `segment/S11-completion`
Implementation branch: `segment/S11-codeoss-ide-loop` @ `803ab40fcb8eee9e6bbfbcc7b0fd34468112d759`
Merged main: PR #33 squash-merged as `5761d24b449300a4b642c0c56df0c1b447278258`

## Objective

Close the vertical IDE loop: the renderer is an untrusted protocol client, the run view is a crash-safe replayable projection, approvals and context explanations consume the S05/S09 contracts, and a UI crash never kills a Run.

## What shipped (PR #33)

- ADR-013 froze the untrusted-renderer and crash-safe-run-view design.
- `packages/ide-client` (`@saber/ide-client`): versioned protocol client (validated frames with actor identity, request id, deadline and idempotent sequence; unknown methods, oversized frames, expired deadlines, invalid identities and version mismatches fail closed pre-send; the client surface exposes only `request` — send is the sole capability).
- Crash-safe `RunView`: a pure replayable cursor projection over the Core's durable event stream; the view holds no run state, so crashing the renderer destroys only a local buffer and a restarted client replays from any cursor into the identical presentation.
- Approval cards bound to the S05 contract: displayed scope may equal or narrow the request scope, never widen it; TTL death at construction; deny alternative mandatory (TM-10); resolution is a protocol intent.
- Context panel bound to the S09 explain contract: redacted fields render only the stable marker, raw values under redacted paths fail closed, exclude/revoke are protocol intents.
- `verify-s11.mjs` (66 checks) and `verify-remote-s11.mjs` wired into `pnpm verify` and the repository-verification workflow; the package joined `pnpm build` and `typecheck`.

## Verified evidence

- Full local gate: fmt, strict clippy, 25 Rust test suites plus the TS suites (5 ide-client adversarial tests), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI: push run `33034430493` green on all five required contexts at `803ab40` on the first push.
- Protected integration: PR #33 merged after every required check; merge SHA `5761d24`.
- Main workflows at `5761d24`: provenance `33034884702`, repository verification `33034884688`, Monorepo CI `33034884686` all passed.
- Clean clone: anonymous HTTPS clone at `5761d24` passed `pnpm acceptance:new-machine` in 84 seconds.
- Strict remote S11 verification passed at `5761d24`.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s11.mjs --repository SunArthurX/saber-harness --branch main` (already green at the implementation SHA).
3. Create annotated `s11-complete` on the final commit.
4. Hand the next model `docs/execution/NEXT-MODEL-S12.md`.

## Non-negotiable review points

- The renderer owns no authority; every effect is a validated protocol request.
- UI lifecycle is never run lifecycle; runs live in the Core's durable store.
- Approval display can only narrow, never widen; deny is always offered.
- Redacted content never renders; explanations show markers and labels only.

## Next action

Finish the publication protocol above; do not begin S12 in this session.
