# ADR-027: Trusted Agent Core Run and the macOS 15.7 Seatbelt Composition

Status: accepted

Date: 2026-08-28

Segment: post-roadmap enterprise-readiness hardening (follows S24)

## Context

The 25-segment roadmap delivered the harness as individually certified
crates, but nothing composed them into an executing run: `saber-core`
was a banner skeleton. Enterprise readiness requires one auditable
execution path that a user can start. While wiring that path, live
testing on macOS 15.7 (darwin 24.6) revealed that the seatbelt profile
form used since S06 no longer compiles: `sandbox-exec` aborts (SIGABRT)
on any `allow file-read*` rule carrying `subpath`/`literal`/`regex`
filters when no accompanying read denies exist, which made the backend
probe report `probe_exec_blocked` and the backend correctly fail closed.

## Decision

1. `saber-core` becomes the trusted agent core runner
   (`execute_run` + the `saber-core run` CLI). One run composes:
   the encrypted `SQLCipher` event store (run record first), the
   deterministic default-deny policy engine with the required
   PlatformHard tier plus operator User-tier permits, an exact,
   expiring one-shot operator approval (`process.spawn` is
   `ApprovalMode::Always`), a fail-closed realm allocation through the
   platform backend registry, and a transactional intent/result outbox
   trail. Policy denials are audited successes, not errors; sandbox
   unavailability refuses the effect instead of degrading to host
   execution; every terminal path leaves a verified hash chain.
2. The seatbelt profile switches to an equivalent-strictness
   composition compatible with macOS 15.7: a wildcard read allowance,
   explicit `deny file-read*` on every non-system top-level root
   (`/Users`, `/home`, `/opt`, `/Volumes`, `/private`, `/tmp`, `/var`),
   then canonical mount-specific re-allows (more specific allowances
   win). Reads stay confined to system trees plus declared mounts and
   writes to declared overlays — the same lattice as before.
3. Seatbelt path matching is literal: every path the child opens
   (argv, cwd, probe scratch, emitted filters) is canonicalized so the
   emitter and the opens agree (`host_mounts_of` canonicalizes mount
   hosts; the probe canonicalizes its scratch after creation).
4. `BackendRegistry::for_current_platform` prefers the lightest
   capable backend: in-core guarded realms (S0/S1) select the guarded
   backend without paying for an OS wrapper; child-execution realms
   (S2+) can only be hosted by wrapper backends because the guarded
   backend refuses command plans.
5. Local runner key custody uses a file-backed provider (owner-only
   permissions on Unix) next to the store; production deployments keep
   the OS-credential-store custodian. The store grows a public
   read-only `event_count` audit statistic.

## Rejected alternatives

- Weakening the profile to wildcard reads without denies: violates the
  S2 read-confinement invariant (AGENTS.md forbids weakening sandbox
  boundaries for test passage).
- Treating macOS 15.7 as unsupported: the composition fix preserves
  strictness and works on 14 and 15.
- Composing inside the Node CLI: the trusted core must be the Rust
  boundary (ADR-001); the CLI stays a thin shell.
- Recording intent/result outside the effect closure: would break the
  durable-intent-before-effect ordering on crashes.

## Verification

- `crates/saber-core/tests/agent_run.rs`: end-to-end allow+approve run
  executes, audits five-plus events, reopens encrypted-at-rest with a
  verified hash chain; unapproved and non-allowlisted programs are
  denied with zero effects; an empty registry refuses authorized
  effects fail-closed; the binary starts, banners, and exits 2 on
  default deny; on macOS a real seatbelt-confined `/bin/sh` execution
  round-trips stdout and a follow-up non-allowlisted command denies.
- `crates/sandbox` regression tests pin the macOS-15.7-compatible
  composition (wildcard base, denied roots, canonical mount
  re-allows) and the guarded-first registry preference.
- Full workspace gate: 256 tests, strict clippy, fmt.
