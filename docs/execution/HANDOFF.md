# S04 Handoff

Status: in progress
Date: 2026-08-25
Branch: `segment/S04-event-store`
Base: `s03-complete` / `e673a18ba12fac1aabb42e1e1ed31d7c30e961dd`

## Objective

Implement the encrypted local fact store, append-only causal event log, transactional projections/outbox and trusted Run state machine, including recovery and fault-injection evidence.

## Implemented locally

- Added an independent Rust `saber-event-store` crate using exact `rusqlite 0.40.2` with bundled SQLCipher and vendored OpenSSL.
- Database open fails closed when the SQLCipher codec is unavailable; foreign keys, secure delete, in-memory temporary storage and bounded busy waiting are enabled.
- Database keys cross an explicit provider boundary, are redacted from `Debug`, and are zeroized on drop; the production OS adapter remains pending.
- Added events, runs, projections, outbox, idempotency, artifacts and blobs tables in one migration transaction.
- Run creation and transition append an event, update the projection and record idempotency in one SQL transaction.
- The trusted state machine rejects illegal transitions and requires bound acceptance evidence before `succeeded`.
- Exact idempotency replays return the original event; conflicting reuse fails closed.
- Events form a length-delimited SHA-256 predecessor chain with full verification.
- A forced projection constraint failure proves the event append is rolled back atomically.

## Current evidence

- Three focused SQLCipher tests pass and strict clippy with all targets/features passes.
- FR-RUN-002 and RES-HEAL-001 are `implemented-local`; remaining S04 requirements stay planned until their complete behaviors and tests exist.
- Production key custody, artifact/blob commit APIs, outbox reconciliation, replay/rebuild, crash-tail repair, wrong-key/key-rotation/migration and kill-9/disk-full/DB-busy injection remain pending.

## Next action

1. Implement native OS credential-store adapters without argv/env/log fallbacks.
2. Add artifact/blob integrity and durable side-effect intent/result APIs.
3. Add replay, repair and external-process fault-injection tests before the full local Gate.
