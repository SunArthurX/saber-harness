# S10 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-27
Branch: `segment/S10-completion`
Implementation branch: `segment/S10-memory-authority` @ `6e66b25e2919343f9982c98978b693911b6c95a5`
Merged main: PR #31 squash-merged as `ef00a55ecf71f488bc45db54c29b1357be99a916`

## Objective

One governed Memory Authority per workspace promoting typed candidates through conflict, revision, TTL and revocation rules with poisoning defenses (TM-06, INV-03).

## What shipped (PR #31)

- ADR-012 froze the single-writer design; DEC-0013 realigned FR-MEM-003 to `crates/memory-authority`.
- `crates/memory-authority` (`saber-memory-authority`): every mutation (propose/promote/revoke) serializes through one authority with a monotonic write sequence — concurrent writers never lose updates and no API mutates memory from outside.
- Promotion authority is typed: `ReviewAuthority` offers only `HumanReview` and `ExplicitPolicy`; no runtime-evidence variant exists, so a run cannot promote its own output. Candidates never auto-promote regardless of provenance confidence.
- Conflicts produce linked revisions with conflict links and intact history — never overwrites; identical re-proposals are duplicate-rejected by content-derived entry ids (key+value+origin; revision is positional).
- TTL expiry transitions entries to Stale (never surfaced as truth); revocation excludes from every query immediately while retaining the audit trail; stable event names (`memory.proposed`/`promoted`/`revoked`/`stale`) with metadata-only payloads.
- Admission fails closed on unclassified proposals and cross-tenant/workspace injections; malformed keys rejected; queries honor scope, state and classification ceiling (S09-fabric-parity visibility).
- `verify-s10.mjs` (75 checks) and `verify-remote-s10.mjs` wired into `pnpm verify` and the repository-verification workflow.

## Verified evidence

- Full local gate: fmt, strict clippy, 25 Rust test suites (12 memory-authority adversarial tests), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI: push run `33032601755` green on all five required contexts at `6e66b25` on the first push.
- Protected integration: PR #31 merged after every required check; merge SHA `ef00a55`.
- Main workflows at `ef00a55`: provenance `33033035817`, repository verification `33033035792`, Monorepo CI `33033035878` all passed.
- Clean clone: anonymous HTTPS clone at `ef00a55` passed `pnpm acceptance:new-machine` in 85 seconds.
- Strict remote S10 verification passed at `ef00a55`.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s10.mjs --repository SunArthurX/saber-harness --branch main` (already green at the implementation SHA).
3. Create annotated `s10-complete` on the final commit.
4. Hand the next model `docs/execution/NEXT-MODEL-S11.md`.

## Non-negotiable review points

- No auto-promotion, ever; explicit review authority only.
- Revisions accumulate; nothing is silently replaced or deleted.
- Stale and revoked memory never surfaces as truth.
- The authority is the only write path into durable memory.

## Next action

Finish the publication protocol above; do not begin S11 in this session.
