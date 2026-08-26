# ADR-008 — Fail-Closed Sandbox, Secret Broker and Egress Boundaries

Status: accepted
Date: 2026-08-26
Deciders: repository owner and S06 architecture review

## Context

S05 made every side effect pass a deterministic default-deny policy decision with audit-before-effect, but the decision is not yet enforced at the operating-system and network boundaries. A permitted `process.spawn` could still inherit the host environment, read ambient credentials, traverse outside the workspace or open arbitrary network connections. INV-04 states that workspace/CWD restrictions and approvals are not isolation, and unavailable enforcement must fail closed. The three CI platforms (macOS, Linux, Windows) offer different real isolation mechanisms, so backend capability must be explicit and honestly reported rather than assumed.

## Decision

### Sandbox Backend SPI

One versioned, pure-Rust service-provider interface with the closed operation set `create`, `exec`, `mount`, `network`, `kill`, `snapshot`, `destroy` and `health`. Plans are typed pure data (`SandboxPlan`) validated before any backend is contacted, and every backend publishes a `BackendDescriptor` (identifier, version, platform, enforced capabilities, realm support). Selection is deterministic: a plan is admitted only when a healthy backend on the current platform demonstrably covers the plan's realm and enforcement requirements; otherwise the effect is denied (`backend_unavailable`), or degraded to safe read-only behavior when the plan is read-only. A backend is never selected implicitly by availability alone, and a command wrapper or working-directory restriction is never reported as OS isolation.

### Execution realms

- **S0 pure** — in-core typed computation, no process, no host access.
- **S1 guarded read** — in-core reads through the path guard with canonicalization and post-open identity verification; no child process.
- **S2 isolated read-only exec** — child process in an OS-isolated realm with read-only workspace mounts, allowlisted environment, resource budgets and no network.
- **S3 isolated overlay exec** — S2 plus an explicitly mounted writable overlay/worktree; no network.
- **S4 egress-mediated exec** — S3 plus network that is only reachable through the in-core Egress PEP; the child itself never receives raw unrestricted sockets.

Higher realms inherit every lower realm constraint; there is no path that drops a constraint.

### Platform capability matrix (honest, fail-closed)

| Platform | Backend | Filesystem confinement | Network confinement | S06 status |
|---|---|---|---|---|
| macOS | `darwin-seatbelt` via `sandbox-exec` | enforced by profile | enforced (deny) | selected only when the binary and a profile apply cleanly |
| Linux | `linux-bwrap` via bubblewrap when present | enforced (bind mounts read-only, tmpfs overlay) | enforced (unshare netns) | selected only when `bwrap` resolves |
| Windows | none admitted in S06 | — | — | S2+ denied fail-closed; read-only degradation only |
| any | `fake://` deterministic backend | simulated | simulated | tests only; never registered as production |

Unhealthy, missing or unsupported backends never fall back to plain host execution. Tests exercise real child-process lifecycle (scrubbed environment, budgets, kill, orphan reaping) through the guarded process backend restricted to S1-equivalent semantics, while S2+ confinement is asserted through the SPI with fake backends and platform backends that fail closed when their prerequisites are absent.

### Filesystem path guard

Workspace is read-only by default; mutation targets must live inside an explicitly mounted overlay root. Every path is rejected unless each component is canonical, non-traversing, non-NUL, and the final open re-verifies the descriptor identity (device/inode or resolved descriptor path) against the pre-open canonical form, defeating symlink-parent swap races. Mount/bind confusion is prevented by requiring mount targets to sit under the realm root and refusing overlapping conflicting mounts.

### Secret Broker

Secrets enter only as opaque `credential://broker/<ref>` references. Material lives behind the broker, is never placed in model context, requests, argv-visible structures, events or audit, and is issued as a short-lived lease bound to one request digest, one purpose and explicit injection channels (environment variable or file descriptor), with TTL, single-consumption replay protection, revocation, crash-safe expiry sweep and zeroization on drop. Tool stdout/stderr/artifacts pass through redaction that masks leased material before any persistence. Lease lookup, issue or redaction failure fails the effect closed.

### Child environment

Children receive a minimal allowlisted environment constructed by the broker. Whole-environment inheritance is impossible by construction: `HOME`, `USER`-adjacent identity, shell profiles, Core IPC endpoints, SSH agent sockets, cloud credential files, keychain/KMS handles and signing material are excluded unless an explicit per-plan allowlist names a non-sensitive entry. The deny-set is tested by canary discovery: a scanning probe must find zero sensitive host variables.

### Egress PEP

Network egress is deny-by-default. Each request binds purpose, destination, policy snapshot, data classification and taint set. Enforcement rejects: unmatched purpose, unmatched host, private/loopback/link-local/unique-local/reserved/multicast ranges, alternate IP literal encodings (decimal/octal/hex integer forms), localhost synonyms, cloud metadata endpoints, DNS rebinding (every resolved address re-validated and pinned), cross-host redirect chains, classifications above the rule ceiling and secret-tainted payloads. The decision is deterministic and pure so it is exhaustively testable without sockets; transport adapters (S08+) may only connect using a PEP-issued authorization bound to the validated destination.

### Plugin and generated-code hosts

Plugins and generated code run only through a manifest-admission path (stable id, version, content digest, declared closed-vocabulary actions, realm and budgets) inside the sandbox SPI. A per-plugin fault domain keeps a deterministic circuit breaker: consecutive failures, budget breach or kill-switch activation opens the circuit and quarantines the plugin; a quarantined host executes zero effects regardless of policy permits. This satisfies SEC-ISO-005 containment without the S19 marketplace.

### Broker composition with S05/S04

The single composition point wraps `PolicyEnforcer::execute`: after a durable Allow decision (and approval consumption), the broker allocates the sandbox realm, acquires secret leases, executes the isolated effect, redacts output and records the S04 durable intent/result ordering. Policy, sandbox health, secret custody, egress or audit failure produces zero effects, and one-shot approvals are consumed only after the decision is durable and before any effect, matching S05 semantics.

## Consequences

- Requiring S2+ isolation on a platform without an admitted backend denies execution rather than weakening the realm.
- Backend descriptors make capability drift visible: adding or downgrading a platform backend is a reviewable ADR-level change.
- Secret leases impose strict lifetime plumbing; long-running tools must renew rather than hold material.
- Egress purity means DNS/redirect enforcement logic is proven by tests now; transports later inherit the same decisions without reinterpretation.
- `unsafe_code` remains forbidden; OS isolation is reached through supported external mechanisms (`sandbox-exec`, `bwrap`) or explicit future ADRs.

## Rejected alternatives

- Plain `std::process` with cwd restriction presented as a sandbox: no confinement; violates INV-04.
- Whole-environment pass-through with a denylist: ordering and provenance of host variables cannot be enumerated safely.
- Secrets as redacted strings inside model context then re-hydrated: any context persistence becomes a credential store.
- Egress allowlist on hostname strings only: DNS rebinding, IP literals and redirects bypass it.
- Optimistically claiming Windows AppContainer support without a verified backend in CI: false isolation claims are a release-blocking architecture failure.

## Verification

- SPI contract tests: every operation's failure mode is observable; fake backend exhaustively covers realm/mount/env/network plan validation.
- Escape suite: absolute/relative/encoded traversal, symlink parent and swap races, mount-target escape, bind confusion.
- Environment canary: probe child discovers zero sensitive host variables.
- Secret suite: reference-only API shape, lease scope/TTL/replay/revocation, zeroization, redaction across stdout/stderr/artifacts/temp files.
- Egress suite: default deny, purpose/host binding, private-range and metadata rejection, IP literal encodings, DNS rebinding pinning, redirect chains, taint/DLP.
- Zero-effect suite: PDP, audit, sandbox, broker or egress unavailability runs zero effects.
- Plugin fault suite: crash/OOM/runaway stays inside the fault domain; quarantine is terminal until explicit operator action.
- Requirements: SEC-ISO-001 through SEC-ISO-006.
