# ADR-019 — Client-Key End-to-End-Encrypted Sync

Status: accepted
Date: 2026-08-29
Deciders: repository owner and S17 architecture review

## Context

Knowledge sovereignty requires that the ordinary sync server can never
read plaintext, embeddings or content keys (INV-06, TB-06, TM-12). The
event store already encrypts at rest with client custody (S04); sync
extends that guarantee across devices: server-side bytes must be
indistinguishable from noise, replayed or rolled-back state must be
detected, and revoking a device must actually cut its access.

## Decision

### Client-encrypted immutable objects

Every synchronized item is a content-addressed encrypted object: AEAD
ciphertext (XChaCha20-Poly1305, matching the S04 blob machinery) with
authenticated metadata binding workspace, classification, media type,
plaintext digest and length. Metadata travels authenticated INSIDE the
AEAD, so ciphertext substitution, classification downgrade and length
lies all fail verification.

### Per-object data keys under a workspace KEK

Each object gets a fresh random data key; the data key is wrapped under
the workspace key-encryption key. The server sees only wrapped keys and
ciphertext. Device revocation rewraps future objects under the
post-revocation KEK epoch: a revoked device's key material cannot unwrap
anything new, while the system honestly does not claim to erase plaintext
the revoked device already copied.

### Anti-rollback epochs

Manifests carry a monotonic epoch; the client ledger refuses any manifest
at or below the last-seen epoch for that workspace — replayed and
rolled-back sync state fail closed (TM-12).

### Metadata-only audit and canaries

Sync operations audit as metadata only (object id, epoch, sizes) — never
plaintext or keys. A canary test asserts no plaintext or content-key
bytes appear anywhere in the server-visible byte stream.

## Consequences

- The sync service is a dumb object store; all intelligence stays
  client-side.
- Key hierarchy changes (rotation, escrow modes) are epoch transitions,
  not protocol forks.
- Revocation honesty: past copies remain readable to the revoked device
  until expiry of its cached material — documented, not hidden.

## Rejected alternatives

- TLS-as-E2EE: the server terminates TLS and reads everything.
- Metadata outside the AEAD: downgrade and substitution attacks.
- Tombstone-as-deletion for revoked devices: false promise (TM-12
  residual risk already documented).

## Verification

- Wrong-key decryption and tampered ciphertext fail closed.
- Classification downgrade via metadata forgery refused.
- Rollback/replay to older epochs refused.
- Server-visible bytes contain zero plaintext and zero content keys.
- Revoked device keys cannot unwrap post-revocation objects.
