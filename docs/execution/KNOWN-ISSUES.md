# Known Issues

## KI-0001 — Git remote was missing

- Status: resolved 2026-08-25
- Evidence: private `SunArthurX/saber-harness` repository and matching Segment branch SHA
- Resolution: authenticated GitHub identity and private visibility were selected in DEC-0003

## KI-0002 — Distribution license requires a future product decision

- Severity: release blocker, not S00 blocker
- Current control: publicly readable but proprietary posture recorded in `LICENSE`
- Impact: repository must not be made public or distributed under a different license without an explicit decision
- Owner: repository owner
- Resolution: before public or third-party distribution, choose proprietary, source-available, or an approved open-source license

## KI-0003 — CI provider was undecided

- Status: resolved 2026-08-25
- Resolution: GitHub Actions selected for the S00 baseline in DEC-0003

## KI-0004 — Private main protection is unavailable on the current GitHub plan

- Status: resolved 2026-08-25 by explicit owner-approved public visibility
- Evidence: GitHub REST API returned HTTP 403 for both branch protection and repository Rulesets
- Provider response: upgrade to GitHub Pro or make the repository public
- Safety decision: do not expose private research to bypass a platform entitlement
- Compensating controls: private visibility, CODEOWNERS, squash-only merge setting, passing PR CI, main-provenance detection workflow, explicit no-force-push repository instructions
- Resolution: pre-publication history scan passed, repository visibility changed to public, and `node scripts/configure-main-protection.mjs --apply` succeeded
- Completion evidence: `node scripts/verify-remote-s00.mjs` exited 0 and proved required PR, `repository-verification`, admin enforcement, linear history, conversation resolution, no force push, and no deletion on `main`

## KI-0005 — SQLCipher codec-attach race on concurrent first key pragmas (Linux CI)

- Observed: 2026-08-27, one failure of `saber-event-store` test `artifact_blob_is_authenticated_encrypted_and_idempotent` on `monorepo-ubuntu-latest` at docs-only commit 502dd1d (run 33092189921): `sqlcipherCodecAttach: sqlcipher not initialized` followed by `PRAGMA key requires a key of one or more characters`
- Root cause: the vendored SQLCipher codec attach is not safe when several connections in one process apply their first key pragma simultaneously; the loaded Linux runner widened the window (never reproduced across 480 local suite executions on macOS; the same code was green on all three platforms at 7e25f84 and bcb7b94)
- Status: resolved 2026-08-27
- Resolution: `apply_key_pragma` now serializes the pragma process-wide behind a `OnceLock<Mutex<()>>` (opens are rare, heavyweight operations, so the lock is free in practice); regression guard `concurrent_first_opens_never_race_the_codec_attach` hammers 8 threads × 4 file-backed opens plus hash-chain verification
- Evidence: the failed run was rerun green (`monorepo-ubuntu-latest => success` on 502dd1d) and the fix landed through a reviewed PR afterward
## KI-0006 — macOS 15.7 sandbox-exec aborts on filtered read allowances

- Observed: 2026-08-28 while wiring the trusted agent core end-to-end run: `OsWrapperBackend::probe(DarwinSeatbelt)` reported `probe_exec_blocked` on macOS 15.7.2 (darwin 24.6); `/usr/bin/sandbox-exec` exits with SIGABRT (134) on any profile whose `allow file-read*` rules carry `subpath`/`literal`/`regex` filters when no read denies accompany them (empirical matrix; silent abort, no diagnostics)
- Impact: the seatbelt backend correctly failed closed (all `process.spawn` effects denied) but real sandboxed execution was unavailable on macOS 15.7+; on macOS 14 the previous form kept working
- Root cause: host platform profile-compiler behavior change; additionally seatbelt subpath filters match the literal path string the child opens, so unresolved macOS symlinks (`/tmp`, `/var` -> `/private/...`) made filters and opens disagree
- Status: resolved 2026-08-28 (ADR-027)
- Resolution: equivalent-strictness composition — wildcard `allow file-read*`, explicit `deny file-read*` on non-system top-level roots, canonical mount-specific re-allows (more specific allowances win); canonicalization of mount hosts (`host_mounts_of`), probe scratch and emitted filters so filters and opens agree; the guarded backend is preferred first so in-core realms never pay for a wrapper
- Evidence: `crates/sandbox/src/platform.rs` regression tests pin the composition; `crates/saber-core/tests/agent_run.rs::real_seatbelt_executes_under_confinement_on_macos` executes a real confined child and verifies the encrypted audit trail on this exact OS
## KI-0007 — probe-profile test read a concurrently rewritten file (flaky)

- Observed: 2026-08-28, one `pnpm acceptance:new-machine` exit 101 and a ~1-in-6 failure of `saber-sandbox` under repeated local runs: `seatbelt_wrapper_probe_profile_matches_the_same_composition` asserted on the PID-keyed probe profile file that concurrent `for_current_platform()` probes rewrite; a reader could observe the file mid-write (truncated) and fail the composition assertion
- Root cause: test-level TOCTOU — evidence read from a shared mutable artifact instead of the pure builder
- Status: resolved 2026-08-28
- Resolution: profile construction extracted into the pure `seatbelt_probe_profile(overlay)` used by `seatbelt_wrapper`; the regression test asserts on the pure function output and the sandbox-exec argv only, never on the shared file
- Evidence: 15/15 consecutive clean `-p saber-core -p saber-sandbox` runs after the fix (previously ~1 failure per 6); acceptance suite green
