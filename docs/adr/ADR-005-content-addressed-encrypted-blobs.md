# ADR-005 — Content-addressed Encrypted Blob Store

Status: accepted
Date: 2026-08-25
Deciders: repository owner and S01 architecture review

## Context

Conversations, diffs, terminal captures, artifacts and snapshots can be large, deduplicated and independently synchronized. Storing them inline bloats transactions and backups; storing plaintext paths breaks confidentiality and integrity.

## Decision

Store large content as immutable content-addressed blobs. Compute a canonical plaintext content hash for identity inside the trusted client, encrypt each object with an audited AEAD construction and unique nonce/DEK, and bind tenant/workspace, classification, media type, length and hash as authenticated metadata. SQL events contain blob references and integrity metadata. Remote sync receives ciphertext objects and signed manifests only.

## Consequences

- Efficient deduplication, integrity checks and immutable synchronization.
- Plaintext hash equality can reveal duplicate-content relationships inside an authorized scope; cross-tenant deduplication is forbidden.
- Garbage collection follows reachability, retention, legal hold and signed tombstones.
- Streaming, partial reads and corruption quarantine need explicit APIs.

## Rejected alternatives

- Inline database BLOBs for all artifacts: poor transaction, backup and sync behavior.
- Plain filesystem paths: weak integrity, portability and access control.
- Server-side content addressing over plaintext: violates zero-knowledge sync.

## Verification

- Tamper, nonce uniqueness, wrong-key, truncation, cross-tenant collision, GC/hold and restore tests.
- Requirements: FR-MEM-001, SEC-SYNC-002, SEC-SYNC-006.
