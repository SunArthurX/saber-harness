# S07 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-27
Branch: `segment/S07-completion`
Implementation branch: `segment/S07-tool-broker` @ `b7cf964517ede8bc80cc1593f5ae7677edcc122f`
Merged main: PR #24 squash-merged as `289f41c62ca55041feec48c68e0f1089d1de0120`

## Objective

Give every tool-mediated modification a uniform, recoverable lifecycle. Tools describe their contract before authorization, execute only through the S06 broker boundary and the S05/S04 ordering, and every mutation lands in an explicitly mounted worktree/overlay checkpoint so failures roll back or surface as explicitly non-retriable.

## What shipped (PR #24)

- ADR-009 froze the verified tool lifecycle; DEC-0011 realigned FR-RUN-006 to S08; DEC-0012 serves FR-RUN-005 artifact integrity from the tool broker.
- `crates/tool-broker` (`saber-tool-broker`): six typed phases — `describe` (frozen per-tool contract gating arguments, action binding and overlay declaration before any authorization), `authorize`+`execute` (unchanged S06 effect broker), `prepare` (worktree lock, full-content checkpoint, git-status fingerprint), `verify` (independent recomputation of content hashes, stat, inventory delta or exit status) and `compensate` (exact checkpoint restore).
- No forged success: declared outputs that never appeared, hash mismatches and exit-status-only claims fail closed as `NonRetriable`.
- Verification is journaled as its own durable effect (intent -> verify -> result) with a stable verdict label; a crash between intent and result replays exactly once under the idempotency key through the real encrypted store.
- External edits and Git-index drift classify the run as `NeedsReconcile` with compensation evidence instead of a retry; compensation failure stays durably non-retriable.
- Read-only tools `read`/`stat`/`hash`/`git status`/`git diff` verify by independent recomputation; `patch` is the verified whole-file mutation primitive; `shell`/`test` run inside S2/S3 realms with declared outputs.
- `verify-s07.mjs` and `verify-remote-s07.mjs`, wired into `pnpm verify` and the repository-verification workflow.

## Verified evidence

- Full local gate: fmt, strict clippy, 19 Rust test suites (17 tool-broker adversarial tests + 2 real-EventStore crash-replay tests), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI: push run `32997365321` green on all five required contexts at `b7cf964` on the first push.
- Protected integration: PR #24 merged only after every required check passed; merge SHA `289f41c`.
- Main workflows at `289f41c`: provenance `32998259915`, repository verification `32998259153`, three-platform Monorepo CI `32998260012` all passed.
- Clean clone: anonymous HTTPS clone at `289f41c` passed `pnpm acceptance:new-machine` in 80 seconds.
- Strict remote S07 verification passed at `289f41c`.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s07.mjs --repository SunArthurX/saber-harness --branch main` (already green at the implementation SHA).
3. Create annotated `s07-complete` on the final commit.
4. Hand the next model `docs/execution/NEXT-MODEL-S08.md`.

## Non-negotiable review points

- A tool may never self-report success: verification evidence is independently recomputed.
- Mutations land only in a declared writable overlay; the workspace root stays read-only (INV-04, ADR-008).
- Compensation failure and verification mismatch are terminal, durably recorded, never auto-retried; external drift requires explicit reconciliation.
- The journal and the overlay must never share a directory (compensation restores the overlay exactly).

## Next action

Finish the publication protocol above; do not begin S08 in this session.
