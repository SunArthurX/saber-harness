# S17 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-29
Branch: `segment/S17-completion`
Implementation branch: `segment/S17-e2ee-sync` @ `92a38c7abb9f9a6dbb7a3da525012ea035f6fb65`
Merged main: PR #45 squash-merged as `210ad5a051c53300de2be5c70cb64da3fe6284a5`

## Objective

Client-held-key end-to-end-encrypted sync: events, memories and artifacts synchronize as client-encrypted immutable objects; the ordinary server sees no plaintext, embeddings or content keys (INV-06, TB-06, TM-12).

## What shipped (PR #45)

- ADR-019 froze the design; DEC-0015 realigned SEC-SYNC-002/003/004 to S17.
- `crates/sync-e2ee` (`saber-sync-e2ee`):
  - Client-encrypted immutable objects: XChaCha20-Poly1305 AEAD with authenticated metadata (workspace, classification, media type, plaintext digest, length) INSIDE the ciphertext — substitution, downgrade and length lies fail verification; post-decryption cross-checks bind claims to actual bytes.
  - Per-object data keys wrapped under the workspace KEK; fresh random keys/nonces per object (identical plaintext → distinct ciphertexts and wrapped keys).
  - Anti-rollback epoch ledger: replays/rollbacks fail closed (TM-12); device revocation cuts pre-revocation epochs with honest non-erasure of already-copied plaintext.
  - Server-zero-plaintext canary with proven breach detection.
- `verify-s17.mjs` (35 checks) and `verify-remote-s17.mjs` wired into gates.

## Verified evidence

- Full local gate: fmt, strict clippy, 37 Rust test suites (8 adversarial), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI green on all five contexts at `92a38c7` first push; PR #45 merged at `210ad5a0`; main workflows green; clean clone 85 s; strict remote S17 verification passed.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s17.mjs --repository SunArthurX/saber-harness --branch main`.
3. Create annotated `s17-complete`; hand the next model `docs/execution/NEXT-MODEL-S18.md`.

## Non-negotiable review points

- The ordinary server never sees plaintext, embeddings or content keys.
- Metadata is authenticated inside the AEAD or it does not exist.
- Rollback and replay fail closed; revocation honesty over false erasure claims.

## Next action

Finish the publication protocol above; do not begin S18 in this session.
