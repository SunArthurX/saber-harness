# S12 Cross-model Execution Handoff

This is the pause point after the S11 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s11-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S12-cax-importers`
- S12 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S12：CAX 与首批 Importer"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s11-complete
git rev-parse 's11-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s11-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-011` (S09 scope/sensitivity semantics the importers must feed)
7. FR-CONT-001/002/004 entries in `docs/traceability.yaml`

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s11.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S12-cax-importers origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S12 `in_progress` state before the first implementation checkpoint.

## S12 objective

Define the Canonical Agent Exchange (CAX) — a versioned schema representing external agent records with source references and hashes — and the first importers that turn observable conversations and artifacts from supported external coding agents into CAX records with recomputable evidence, without inventing hidden reasoning (INV-02).

Required deliverables (per the roadmap and FR-CONT-001/002/004):

1. A versioned CAX schema (record envelope: source references, content hashes, actor/session metadata, provenance and trust defaults) with deterministic validation and Rust/TS parity through the existing codegen path.
2. First importers for at least two external agent transcript formats, producing CAX records whose evidence is recomputable from the raw source (hash chain from raw bytes to record).
3. Deterministic re-import, revoke and delete of imported sources while preserving minimal audit provenance.
4. Imported records enter the knowledge fabric as `Untrusted` trust with full provenance (S09 admission path).
5. A S12 verifier and strict remote verifier preserving every S00-S11 gate.

## Adversarial acceptance (minimum)

- record hash mismatch (tampered source or record) fails closed;
- importer cannot invent content absent from the raw source (recomputation equality);
- re-import of the same source is idempotent (no duplicate records);
- revoke removes records from queries while provenance survives;
- cross-workspace import injection fails;
- unknown schema versions fail closed.

## Segment publication protocol

Unchanged from S11: one Segment branch, explicit staging, full local gate (`cargo fmt --check`, strict clippy, `cargo test --workspace --locked`, `pnpm verify`, `pnpm acceptance:new-machine`), truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S12 verification, atomic completion record through a second protected PR, then annotated `s12-complete`.

Never mark S12 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
