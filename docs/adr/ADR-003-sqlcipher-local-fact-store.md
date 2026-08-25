# ADR-003 — SQLCipher SQLite Local Fact Store

Status: accepted
Date: 2026-08-25
Deciders: repository owner and S01 architecture review

## Context

Saber needs offline transactional facts, event ordering, projections, FTS and recovery on each device. Plain SQLite does not satisfy the local-at-rest confidentiality commitment; a remote database would violate offline ownership and enlarge the trust boundary.

## Decision

Use SQLCipher SQLite as the per-device authoritative fact store. Obtain database keys from OS secure storage or enterprise KMS wrapping; never from argv, normal environment, logs or model context. Use one writer with bounded readers, explicit migrations, WAL policy, integrity checks, backup/restore drills and encrypted temporary-file controls. Large content is stored outside the database as encrypted content-addressed blobs per ADR-005.

## Consequences

- Strong local transactions and portability with operationally simple backup.
- Native library packaging, cipher compatibility and migration testing are mandatory.
- Database encryption does not replace object authorization or endpoint security.
- Derived vector indexes remain rebuildable and separately protected.

## Rejected alternatives

- Plain SQLite plus filesystem encryption: insufficiently explicit and not portable across threat models.
- PostgreSQL as a local prerequisite: heavy, weak offline desktop ergonomics.
- Vector database as fact store: lacks required transactional and relational authority semantics.

## Verification

- Wrong-key, key-rotation, migration, crash, disk-full, restore and plaintext-leak tests.
- Requirements: FR-MEM-001, SEC-SYNC-001, RES-HEAL-001.
