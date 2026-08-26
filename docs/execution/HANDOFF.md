# S06 Handoff

Status: in progress — implementation complete, local gate green, publication pending
Date: 2026-08-26
Branch: `segment/S06-sandbox-secret-egress`
Base: `s05-complete` / `129fd31fe48af3494484b03edc5d5c0c79725722`

## Objective

Make the S05 policy decision enforceable at the operating-system and network boundaries: sandbox realms, a reference-only Secret Broker with short-lived leases, a default-deny Egress PEP and fault-contained plugin/generated-code hosts. No untrusted code obtains ambient host authority, raw credentials or unrestricted network access.

## Completed in this branch

- Resolved the pre-existing numbering collision: FR-MEM-002/004/005/006 moved to S09, FR-MEM-003 to S10 with renamed test IDs (DEC-0010). S06 implements only the isolation boundary.
- Froze the contracts in ADR-008: Sandbox Backend SPI (`create`/`exec`/`mount`/`network`/`kill`/`snapshot`/`destroy`/`health`), S0–S4 execution realms, honest platform capability matrix, path guard, secret lease custody, child environment allowlisting, egress PEP and plugin fault containment.
- Implemented `crates/sandbox` (`saber-sandbox`): typed plans with total validation, canonical path guard with symlink-swap race detection, allowlisted child environment with sensitive-key policy, deterministic fake backend, guarded process backend with deadline kill/output caps, macOS Seatbelt and Linux bubblewrap backends with live confinement self-tests, and the fail-closed registry. Windows intentionally admits no confinement backend; S2+ plans fail closed there.
- Implemented `crates/secret-broker` (`saber-secret-broker`): opaque `credential://broker/<id>` references, scope/purpose/digest-bound single-consumption leases with TTL, revocation, crash-recovery sweep, zeroized material, debug-redacted values and output redaction.
- Implemented `crates/egress` (`saber-egress`): deny-by-default authorization binding purpose/destination/classification/taint, IP-literal parsing across integer encodings, private/link-local/metadata ranges, DNS-rebinding pinning, redirect policy and connection verification.
- Implemented `crates/effect-broker` (`saber-effect-broker`): the single composition point wiring sandbox selection, egress authorization, realm allocation, prepared `sandboxed=true` requests, durable S04 intent/result journaling (with a real `EventStore` adapter and integration tests), S05 audit-before-effect enforcement, lease injection, output redaction and realm teardown; plus the plugin host with manifest/digest admission, circuit breaker and terminal quarantine.
- Added `schemas/sandbox/v1/platform-matrix.json` + `matrix.json` with a Rust parity test, `scripts/verify-s06.mjs` (206 checks) and `scripts/verify-remote-s06.mjs`, wired into `pnpm verify` and the repository-verification workflow.
- Full local gate green: `cargo fmt --check`, strict clippy `-D warnings`, 16 Rust test suites, `pnpm verify`, `pnpm acceptance:new-machine` (44 s).

## Verified evidence

- Inherited boundary: annotated `s05-complete` equals `origin/main`; strict remote S05 verification and new-machine acceptance passed before the first S06 commit.
- Adversarial suites cover traversal/encoded/symlink-swap escapes, mount-confusion denials, fail-closed selection on unhealthy/absent backends, environment canary (zero sensitive host keys), deadline kill and output truncation, secret lease scope/TTL/replay/digest-binding plus zeroization and redaction across stdout/stderr/artifacts, egress default deny with alternate IP encodings, metadata endpoints, rebinding pinning, redirect chains and taint/DLP, plugin fault isolation, and zero effects on policy/journal/audit/sandbox/secret/egress failure.
- On the development macOS host the Seatbelt probes proved exec-allowed, write-outside-denied and overlay-write-allowed; CI platforms without prerequisites must assert the fail-closed path.

## Remaining for completion

1. Push `segment/S06-sandbox-secret-egress`, verify remote SHA equals local HEAD.
2. Wait for every required CI context on the branch.
3. Merge through protected main; run clean-clone acceptance and `node scripts/verify-remote-s06.mjs`.
4. Publish the atomic completion record through a second protected PR.
5. Only then create annotated `s06-complete` and update this file.

## Non-negotiable review points

- A command wrapper or CWD restriction is never OS isolation; guarded backend selection stays capped at S1.
- Approval never substitutes sandbox/secret/egress controls; policy denial, journal failure, audit failure, backend unavailability, lease refusal and egress denial all execute zero effects.
- Secret material never enters model context, plans, events or audit; leases are single-consumption and digest-bound.
- Platform backends are selectable only after live self-tests prove confinement; absent prerequisites fail closed, never weaken the realm.

## Next action

Finish the publication protocol above; do not mark S06 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved.
