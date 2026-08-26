# S04 Handoff

Status: completed atomically when the S04 completion PR is merged through protected main
Date: 2026-08-26
Branch: `segment/S04-completion`
Base: `s03-complete` / `e673a18ba12fac1aabb42e1e1ed31d7c30e961dd`

## Objective

Implement the encrypted local fact store, append-only causal event log, transactional projections/outbox and trusted Run state machine, including recovery and fault-injection evidence.

## Completed

- Added the Rust `saber-event-store` crate using exact `rusqlite 0.40.2`, bundled SQLCipher and vendored OpenSSL.
- Database open fails closed when SQLCipher is unavailable, a key is wrong, integrity fails or a future schema is encountered. WAL, foreign keys, secure delete, in-memory temporary storage and bounded busy waiting are enabled.
- Added `OsKeyringProvider` backed by macOS Keychain, Windows Credential Manager or Linux Secret Service. Database keys never use argv, ordinary environment, logs or model context; key buffers are redacted and zeroized.
- Key rotation stages old/new candidates before SQLCipher rekey, checkpoints and temporarily exits WAL for the page rewrite, then promotes the new key. Interrupted promotion reopens with the staged fallback.
- Added versioned migrations plus events, runs, projections, outbox, idempotency, artifacts, blobs and encrypted store metadata.
- Run creation and transition append an event, update projections and record idempotency atomically. Illegal transitions fail closed, and `succeeded` requires bound acceptance evidence.
- Events form a length-delimited SHA-256 predecessor chain. Exact idempotency replay returns the original event; conflicting reuse is rejected.
- Artifact bodies use XChaCha20-Poly1305 with unique nonces and authenticated workspace, classification, MIME, hash and length metadata. Ciphertext is fsynced and atomically published before references commit.
- Side-effect intent and verified result events update the durable outbox in the same transaction. Startup recovery validates storage and the audit chain, repairs divergent Run projections, and surfaces pending effects for read-after-write reconciliation.

## Verified evidence

- Sixteen focused event-store tests passed, including wrong-key denial, interrupted rotation, v1 migration, authenticated blob tamper, replay equivalence, process termination, disk-full and database-busy faults.
- The full local Gate passed Rust formatting, strict workspace clippy, all Rust tests, TypeScript build/type/tests, deterministic generation, licenses, 541 S00 checks, S01-S04 verifiers and 15 governance checks.
- Implementation branch `d9a7d8a6009b85d18b826a842e5faf33ea00ff76` matched the remote. Push runs `32863869283` and `32863869278`, and PR runs `32938203678` and `32938203456`, passed all five required contexts.
- PR #17 squash-merged through protected main as `c5651455691cf75ae53bdd7e8075623b9507c82f`.
- Main runs `32938988325` (repository verification), `32938988237` (provenance) and `32938988379` (platform matrix and dependency audit) passed at the merge SHA.
- A standard unauthenticated public HTTPS clone selected pinned Node 24.15.0, pnpm 11.23 and Rust 1.98, then passed `pnpm acceptance:new-machine` in 52 seconds.
- Strict remote S04 verification confirmed the public repository settings, security controls, protected-main rules, encrypted-store contracts and successful same-SHA workflows.
- FR-RUN-002, FR-MEM-001, SEC-SYNC-001, RES-HEAL-001 and RES-HEAL-002 are `verified-main`. Broader artifact lifecycle, remote E2EE sync and signed checkpoint requirements remain assigned to later Segments.

## Acceptance result

| Item | State | Evidence |
|---|---|---|
| Segment push/SHA equality | passed | local and remote branch matched at `d9a7d8a6009b85d18b826a842e5faf33ea00ff76` |
| Encrypted fact/blob store | passed | SQLCipher, native key custody, authenticated blobs, integrity and rotation tests |
| Transactional recovery | passed | hash-chain, projection rollback/rebuild, durable outbox and fault-injection tests |
| Three-platform CI | passed | Linux 2m50s, macOS 2m12s and Windows 10m10s on main run `32938988379` |
| Dependency and security gates | passed | dependency audit 3m15s plus secret scanning, push protection and Dependabot controls |
| Protected-main integration | passed | PR #17 merged only after all required checks |
| Clean-clone acceptance | passed | public HTTPS clone passed all gates in 52s at `c565145...` |
| Atomic completion record | passed on merge | this state reaches main only through required CI and PR protection |

## Non-negotiable review points

- The SQLCipher database and encrypted blobs remain separate persistence classes with keys held outside ambient process inputs.
- Events are authoritative; projections and indexes are rebuildable derived state.
- No effect executes without durable intent, policy authority and idempotent reconciliation.
- Only the trusted Rust boundary may commit Run state, and success remains bound to acceptance evidence.
- S05 policy work must not weaken key custody, audit, recovery, sandbox, secret or egress boundaries.
- `FR-RUN-005` and `OPS-ENT-001` remain planned because S04 does not implement the full artifact review/rollback lifecycle or signed external audit anchoring.

## Next action

1. Confirm the atomic S04 completion PR and resulting main workflows are green.
2. Create the annotated `s04-complete` tag at that verified main commit.
3. Create `segment/S05-policy` from protected `origin/main` and implement the deterministic Capability, Policy and Approval boundary.
