# S04 Handoff

Status: in progress
Date: 2026-08-25
Branch: `segment/S04-event-store`
Base: `s03-complete` / `e673a18ba12fac1aabb42e1e1ed31d7c30e961dd`

## Objective

Implement the encrypted local fact store, append-only causal event log, transactional projections/outbox and trusted Run state machine, including recovery and fault-injection evidence.

## Implemented locally

- Added an independent Rust `saber-event-store` crate using exact `rusqlite 0.40.2` with bundled SQLCipher and vendored OpenSSL.
- Database open fails closed when the SQLCipher codec is unavailable, a key is wrong, integrity checks fail or a future schema is encountered; WAL, foreign keys, secure delete, in-memory temporary storage and bounded busy waiting are enabled.
- Added a production `OsKeyringProvider` backed by macOS Keychain, Windows Credential Manager or Linux Secret Service. Keys never use argv, ordinary environment or logs, are redacted from `Debug`, and are zeroized on drop.
- Key rotation stages old/new candidates before SQLCipher rekey, checkpoints and temporarily exits WAL for the page rewrite, then promotes the new key. Interrupted promotion reopens with the staged fallback.
- Added versioned migrations and events, runs, projections, outbox, idempotency, artifacts, blobs and encrypted store metadata.
- Run creation and transition append an event, update the projection and record idempotency in one SQL transaction.
- The trusted state machine rejects illegal transitions and requires bound acceptance evidence before `succeeded`.
- Exact idempotency replays return the original event; conflicting reuse fails closed.
- Events form a length-delimited SHA-256 predecessor chain with full verification.
- A forced projection constraint failure proves the event append is rolled back atomically.
- Artifact commits use XChaCha20-Poly1305 with unique nonces and authenticated workspace/classification/MIME/hash/length metadata. Encrypted files are fsynced and atomically published before transactional references.
- Side-effect intent and verified result events update the durable outbox in the same transaction; exact replay cannot create a second intent or result.
- Startup recovery verifies SQLCipher and the audit chain, rebuilds divergent Run projections from events, and surfaces pending effects for provider read-after-write reconciliation.

## Current evidence

- Sixteen focused tests pass, including wrong key, interrupted rotation, v1 migration, authenticated blob tamper, replay equivalence, kill/unfinished-outbox recovery, disk-full and database-busy cases; strict clippy passes with all targets/features.
- FR-RUN-002, FR-MEM-001, SEC-SYNC-001, RES-HEAL-001 and RES-HEAL-002 are `implemented-local`. Broader artifact lifecycle, remote E2EE sync and signed checkpoint requirements remain assigned to their later Segments.
- The earlier WIP SHA `88923b4f8b4f447d7bf83f4e21850b581ae0f0da` passed repository verification, Linux, macOS, Windows and dependency-audit CI. Current implementation changes still require a new same-SHA Gate.

## Next action

1. Run the complete local S00-S04, Rust, TypeScript, governance, license and formatting Gate.
2. Commit and push explicit S04 paths, then require all hosted checks on that exact SHA.
3. Merge through protected main, run a clean-clone acceptance drill, write the atomic completion record and tag only after all evidence is green.
