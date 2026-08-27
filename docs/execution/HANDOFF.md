# S12 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-28
Branch: `segment/S12-completion`
Implementation branch: `segment/S12-cax-importers` @ `c843abd909bff854d23ce48230c0cb52e8f5e593`
Merged main: PR #35 squash-merged as `e213e5d53c66f38d3c0a5ee349573238fe1571eb`

## Objective

The Canonical Agent Exchange: a versioned schema for external agent records with source references and hashes, plus first importers producing records with recomputable evidence — no invented content, idempotent re-import, revocable sources, untrusted admission.

## What shipped (PR #35)

- ADR-014 froze the recomputable-evidence design; FR-CONT-001/002/004 realigned to S12 and implemented with evidence.
- `crates/cax` (`saber-cax`): versioned `CaxRecord` envelope (schema 1.0.0 with JSON Schema at `schemas/exchange/v1/cax.schema.json`) binding scope, source reference (origin URI, format, raw digest), session metadata, ordered entries and a record digest over the canonical body; validation recomputes every digest so tampered sources, tampered records and unknown versions fail closed.
- Hash chain from raw bytes to record: entry digests hash only verbatim-present content, so importers cannot invent content without breaking the chain; an independent verbatim-presence check proves it.
- First importers: JSONL and Markdown transcripts — pure, deterministic, format-identified parsers.
- `CaxLibrary`: idempotent re-import keyed by raw digest; evolved sources create distinct records; revocation removes records from every query while retaining tombstone provenance; revoked sources stay revoked; cross-workspace injection rejected.
- Untrusted fabric admission: records mint `Untrusted`-trust S09 labels with source provenance; the fabric's scope/sensitivity/visibility rules apply unchanged (INV-02, TM-06).
- `verify-s12.mjs` (68 checks) and `verify-remote-s12.mjs` wired into `pnpm verify` and the repository-verification workflow.

## Verified evidence

- Full local gate: fmt, strict clippy, 27 Rust test suites (9 CAX adversarial tests), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI: push run `33036366007` green on all five required contexts at `c843abd` on the first push.
- Protected integration: PR #35 merged after every required check; merge SHA `e213e5d`.
- Main workflows at `e213e5d`: provenance `33036787695`, repository verification `33036787724`, Monorepo CI `33036787710` all passed.
- Clean clone: anonymous HTTPS clone at `e213e5d` passed `pnpm acceptance:new-machine` in 86 seconds.
- Strict remote S12 verification passed at `e213e5d`.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s12.mjs --repository SunArthurX/saber-harness --branch main` (already green at the implementation SHA).
3. Create annotated `s12-complete` on the final commit.
4. Hand the next model `docs/execution/NEXT-MODEL-S13.md`.

## Non-negotiable review points

- Evidence is recomputable or it is not evidence: digest chains verified end to end.
- Importers are pure parsers; invention breaks the chain.
- Imported content enters the fabric as untrusted with full provenance.
- Revoked sources stay revoked; tombstones preserve audit facts.

## Next action

Finish the publication protocol above; do not begin S13 in this session.
