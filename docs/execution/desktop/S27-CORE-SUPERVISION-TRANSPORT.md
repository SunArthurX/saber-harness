# S27 Runbook — Core Supervision and Transport

Status: planned

Duration: 8-12 working days

Owners: Runtime Architect (A), Rust Runtime and Desktop Engineers (R), Security
Engineer (R), SDET (R)

Risk: critical

## Outcome

The packaged development desktop starts or attaches to a version-compatible
Saber Core, authenticates over the local versioned protocol, subscribes from a
durable cursor and recovers safely from Renderer, extension-host or Core
failure. The shell still has no authoritative effect path.

## Preconditions and non-goals

Requires S26 packages, ADR-001/002/013, generated Rust/TypeScript protocol
fixtures and a real Core binary. Agent UX and broad protocol expansion are out
of scope; add only lifecycle methods required to connect, query health and
replay an existing fixture Run.

## Work packages

### S27-WP01 — Lifecycle contract

- Define desktop states: booting, starting Core, attaching, ready,
  incompatible, reconnecting, degraded, safe mode and stopping.
- Define single-instance behavior per user profile and multi-window behavior per
  Workspace.
- Electron main may spawn/monitor and pass a one-time bootstrap descriptor; it
  may not authorize effects or parse secrets into Renderer state.
- Define graceful shutdown deadlines and orphan reaping without killing an
  intentional background Run.

### S27-WP02 — Local endpoint authentication

- macOS/Linux: user-owned runtime directory, Unix socket mode `0600`, reject
  symlink or wrong owner.
- Windows: named pipe ACL restricted to the current logon identity; reject broad
  DACL and remote pipe access.
- Generate a random one-time bootstrap token via OS CSPRNG; pass through a
  restricted inherited channel, never argv, ordinary environment or log.
- Bind handshake to protocol version, desktop build, Core build, user identity,
  Workspace and expiration.
- Replay, wrong user, wrong Workspace and stale token fail closed and audit.

### S27-WP03 — Protocol client

- Extend `packages/ide-client` with transport interfaces while keeping existing
  ViewModels pure.
- Enforce frame limit, request deadline, cancellation, idempotency, unknown
  method denial and N/N-1 compatibility.
- Implement bounded event buffering and cursor acknowledgement.
- Reconnect from the last acknowledged durable cursor; never infer missing Run
  state from UI cache.

### S27-WP04 — Renderer bridge

- Use a narrow preload/extension bridge with context isolation and sender
  validation.
- Expose typed Saber intents and event subscriptions, not generic IPC send,
  filesystem, shell or network primitives.
- Apply strict CSP; deny navigation, new windows, permission requests and
  untrusted external URLs.
- Add a static allowlist test for every exposed bridge method.

### S27-WP05 — Failure and support UX

- Renderer reload: Run continues, identical projection after replay.
- Extension-host crash: reconnect without duplicate mutation.
- Core crash before effect: show recoverable failure.
- Core crash after intent/before result: enter recovery, do not rerun blindly.
- Version mismatch: block normal operation and offer compatible update or safe
  read-only support bundle.
- Logs contain event IDs and digests, never secrets or raw private prompts.

### S27-WP06 — Adversarial verification

Test forged local client, socket replacement, symlink endpoint, broad Windows
ACL, stale token, duplicate request, oversized frame, invalid UTF-8, unknown
method, slow consumer, cursor gap, Core kill and Renderer kill.

## Planned verification

```sh
node scripts/verify-s27.mjs
pnpm --filter @saber/ide-client test
pnpm desktop:test:transport
pnpm desktop:test:crash-matrix
pnpm desktop:smoke
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- Real Core health and replay are visible in the development desktop.
- Renderer restart during a fixture Run leaves Core state and final digest
  unchanged.
- Every forged/incompatible/oversized request fails before an effect.
- The bridge exports no general host capability.
- Safe Mode and support bundle work without exposing protected content.
