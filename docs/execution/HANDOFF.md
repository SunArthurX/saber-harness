# S27 Handoff — Core Supervision and Transport

Status: in progress — the real Core now serves the contracted local
endpoint and the ide-client speaks it end to end with adversarial and
crash-matrix evidence; the Windows pipe, Electron main wiring and support
UX halves remain
Date: 2026-08-29
Branch: `segment/S27-core-supervision-transport`
Base main: `f4693d16ae7ca19de5fd16fa70fbd86b0ac7fe87` (`s26-complete`)
Runbook: `docs/execution/desktop/S27-CORE-SUPERVISION-TRANSPORT.md`

## Objective

The development desktop attaches to a version-compatible Saber Core over
the local versioned protocol with a one-time bootstrap handshake, reads
health and replays events from a durable cursor, and fails closed on
every forged, replayed, oversized or out-of-order input. The shell gains
no effect path.

## What landed (all verified against the real Core binary)

- **Contract parity (WP03)**: `core.initialize` and `core.health` added
  once to `schemas/control/v1/protocol.schema.json`, regenerated
  identically into `crates/core-protocol/src/generated.rs` and
  `packages/agent-runtime/src/generated/contracts.ts`, mirrored in the
  ide-client method registry; the Rust decoder classifies both as
  non-mutations (no idempotency key) and rejects anything outside the
  closed registry.
- **`saber-core serve` (WP01/WP02)**: binds the contracted
  `/tmp/saber-<workspace>.sock` with mode 0600; refuses symlinks and
  never steals a live endpoint, reaping only provably stale sockets
  (3 Rust unit tests); generates a 32-byte CSPRNG one-time bootstrap
  token and prints it exactly once on stdout (never argv/env/logs);
  one thread per connection — a serial accept loop starved the third
  connection and was found by probing and fixed; the handshake gate
  precedes every other method; `core.health` returns real store
  statistics; `events.subscribe` replays cursor-ordered pages (limit
  clamp 1..500) straight from the encrypted store through a new typed
  read-only `EventStore::replay_events`. Windows fails closed ("named
  pipe transport not implemented; refusing to serve").
- **ide-client (WP03/WP05)**: `SupervisionClient` with lazy attach
  retries (endpoint may still be booting), ten-state `nextLifecycle`
  machine (booting…stopped, safe mode wins from anywhere), 1 MiB line
  cap, request deadlines, response correlation, N/N-1 version gating at
  initialize, bounded buffering and cursor-acknowledged `replayAll`.
- **Renderer bridge (WP04)**: `bridge.js` — frozen four-intent allowlist
  (`saber.core.initialize/health`, `saber.events.subscribe`,
  `saber.workbench.status`), unknown methods and oversized payloads
  rejected before forwarding, zero host imports, no `ipcRenderer`.
- **Tests (WP06)**: ide-client transport suite (4/4: lifecycle machine,
  initialize→health→paged replay against a real audited run, forged and
  replayed tokens, pre-handshake ordering), crash matrix (1/1: renderer
  reload refused by the spent token as contracted, SIGKILL degrades
  through the machine, respawn replays identical durable state — same
  first event id and counts), bridge allowlist suite (4/4), Rust
  endpoint hardening (3/3). Unix-only tests carry explicit Windows skip
  guards.
- **Gates**: `verify-s27.mjs` (77 checks) chained into `pnpm verify:repo`
  and the hosted repository-verification workflow;
  `desktop:test:transport` / `desktop:test:crash-matrix` scripts added.
  Full battery green: cargo fmt/clippy (workspace) clean, 54 Rust suites
  ok, `pnpm verify` exit 0, `git diff --check` clean.

## What is NOT done (honest pending)

- **Windows named-pipe transport** (WP02 Windows half): `serve` fails
  closed; the client tests skip on Windows. Needs the pipe ACL +
  current-logon-identity work with its own adversarial set.
- **Electron main lifecycle wiring** (WP01 desktop half): spawn/monitor
  the Core with a piped bootstrap descriptor, per-profile single
  instance, graceful shutdown deadlines and orphan reaping.
- **Handshake-failure audit events**: rejections currently log to stderr
  without the token; persisting them into the encrypted store via the
  audit sink is next.
- **Safe Mode / support bundle UX** (WP05) and the slow-consumer +
  cursor-gap adversarial cases.
- Segment push, hosted checks and protected merge.

## Next exact commands

```sh
pnpm desktop:test:transport && pnpm desktop:test:crash-matrix   # red-green loop
# then: windows pipe transport + electron main wiring + audit sink,
# then push, hosted checks, completion record, protected merge, tag
```

## Stop rule

Do not start S28 (desktop workbench shell). S27 stays `in_progress`
until the pending items above are real; only then record completion and
tag `s27-complete`.

## Non-negotiable review points

- The token travels exactly once, on stdout, and is never logged,
  echoed in errors or accepted twice.
- No mutation method is served on the transport; there is no effect
  path from the desktop.
- The bridge allowlist stays frozen; adding an intent requires a
  reviewed change with its own static test.
