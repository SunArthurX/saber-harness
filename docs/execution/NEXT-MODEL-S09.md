# S09 Cross-model Execution Handoff

This is the pause point after the S08 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s08-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S09-context-engine`
- S09 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S09：Context Engine/Knowledge Mesh"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s08-complete
git rev-parse 's08-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s08-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-008`, `docs/adr/ADR-009` and `docs/adr/ADR-010`
7. FR-MEM-002/004/005/006 and related entries in `docs/traceability.yaml` (realigned to S09 by DEC-0010)

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s08.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S09-context-engine origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S09 `in_progress` state before the first implementation checkpoint.

## S09 objective

Build the permission-aware Context Engine and Knowledge Mesh: one query fabric over code, conversations, documents, issues, decisions and rules with provenance, scope, sensitivity, freshness and selection-reason labels (the "nutrition label"), scope isolation without cross-workspace/tenant leakage, context explain/inspect/exclude/revoke controls, and hybrid retrieval over rebuildable derived indexes.

Required deliverables (per the roadmap and FR-MEM-002/004/005/006):

1. A versioned Context/Knowledge SPI: typed sources, scope and sensitivity binding, provenance and freshness metadata, selection-reason labels on every chunk entering model context.
2. A permission-aware query planner over one knowledge fabric: no cross-scope leakage, redaction at query time, tenant/workspace-qualified keys.
3. Context explanation surfaces: why each item entered context; user inspect/exclude/revoke.
4. Hybrid retrieval (structured + FTS + symbol) with indexes treated as rebuildable derived data.
5. Integration with the S06 egress taint/DLP boundary: exported context carries taint; untrusted-source content never enters context without classification.
6. A S09 verifier and strict remote verifier preserving every S00-S08 gate.

## Adversarial acceptance (minimum)

- cross-scope query leakage tests (tenant/workspace/sensitivity);
- poisoned or unclassified content cannot enter context unlabeled;
- selection-reason labels survive round-trips and cannot be forged;
- index corruption is recoverable by rebuild from authoritative facts;
- revocation excludes items from future context immediately;
- query-time redaction of restricted fields;
- deterministic explain output for identical selections.

## Segment publication protocol

Unchanged from S08: one Segment branch, explicit staging, full local gate (`cargo fmt --check`, strict clippy, `cargo test --workspace --locked`, `pnpm verify`, `pnpm acceptance:new-machine`), truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S09 verification, atomic completion record through a second protected PR, then annotated `s09-complete`.

Never mark S09 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
