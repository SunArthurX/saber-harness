# S17 Cross-model Execution Handoff

This is the pause point after the S16 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s16-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S17-e2ee-sync`
- S17 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S17：E2EE Sync"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s16-complete
git rev-parse 's16-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s16-complete^{}` must be an ancestor of `origin/main`. Then read AGENTS.md, STATE.yaml, HANDOFF.md, EVIDENCE.json, ROADMAP.md, ADR-018 and the SEC-SYNC entries in `docs/traceability.yaml`. Verify the inherited boundary:

```sh
node scripts/verify-remote-s16.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those pass: `git switch -c segment/S17-e2ee-sync origin/main`, then immediately update STATE.yaml, HANDOFF.md and EVIDENCE.json to truthful S17 `in_progress` state.

## S17 objective

Client-held-key end-to-end-encrypted sync: events, memories and artifacts synchronize as client-encrypted immutable objects; the ordinary server sees no plaintext, embeddings or content keys (INV-06, TB-06, TM-12).

Required deliverables (per the roadmap and SEC-SYNC):

1. A sync object model: content-addressed encrypted blobs (AEAD), per-object content keys wrapped under the client master key, signed manifests with Merkle roots and anti-rollback epochs.
2. Deterministic serialize/encrypt/decrypt round-trips with authenticated metadata (workspace, classification, media type, plaintext hash) preventing ciphertext substitution and classification downgrade.
3. An anti-rollback epoch ledger: replayed or rolled-back manifests are detected and refused.
4. Revocation semantics: revoking a device's access cannot erase plaintext already copied, and the system says so honestly.
5. Metadata-only audit of sync operations (no plaintext, no keys).
6. A S17 verifier and strict remote verifier preserving every S00-S16 gate.

## Adversarial acceptance (minimum)

- wrong-key decryption fails closed;
- tampered ciphertext / substituted blobs fail authentication;
- classification downgrade via metadata forgery refused;
- manifest rollback to an older epoch refused;
- server-visible bytes never contain plaintext or content keys (canary test);
- revoked device keys cannot unwrap new objects.

## Segment publication protocol

Unchanged from S16: one Segment branch, explicit staging, full local gate, truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S17 verification, atomic completion record through a second protected PR, then annotated `s17-complete`.

Never mark S17 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
