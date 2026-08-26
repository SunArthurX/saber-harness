# S06 Cross-model Execution Handoff

This is the user-requested pause point. The previous model completed S05 and must not begin S06. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Visibility: public, proprietary license
- Completed tag: `s05-complete`
- Next branch: `segment/S06-sandbox-secret-egress`
- S06 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section “S06：Sandbox、Secret Broker 与 Egress”

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s05-complete
git rev-parse 's05-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s05-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-007-deterministic-monotonic-policy-enforcement.md`
7. `docs/security/THREAT-MODEL-v0.md`
8. `docs/security/TRUST-BOUNDARIES.md`
9. `docs/architecture/INVARIANTS.md`
10. S06 and SEC-ISO entries in `docs/traceability.yaml`

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s05.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S06-sandbox-secret-egress origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S06 `in_progress` state before the first implementation checkpoint.

## Scope collision that must be resolved first

There is a pre-existing numbering conflict. The authoritative execution roadmap assigns S06 to Sandbox/Secret/Egress and assigns Context/Knowledge/Memory to later Segments. Some legacy FR-MEM entries in `docs/traceability.yaml` still say `segment: S06` and use `S06-*` test names.

Do not silently combine both large bodies of work. Record the reconciliation in `docs/execution/DECISIONS.md` (and an ADR if ownership or interfaces change), then align those FR-MEM schedule/test identifiers with the authoritative execution roadmap. Unless the user explicitly changes priority, S06 implements only the deterministic isolation boundary described below.

## S06 objective

Make the S05 policy decision enforceable at the operating-system and network boundaries. No untrusted Tool, plugin, generated process, model adapter or external Agent may obtain ambient host authority, raw credentials or unrestricted network access.

Required deliverables:

1. A versioned Sandbox Backend SPI with at least `create`, `exec`, `mount`, `network`, `kill`, `snapshot`, `destroy` and `health` operations.
2. Explicit S0-S4 execution realms, resource budgets and fail-closed backend selection for macOS, Linux and Windows. Unsupported/unavailable isolation must degrade to safe read-only behavior or deny execution, never silently run on the host.
3. Workspace read-only by default. Mutations occur only in an explicitly mounted worktree/overlay. Canonical-path and post-open checks must prevent path traversal, symlink-parent races, bind/mount confusion and escape outside allowed roots.
4. A Secret Broker that accepts only opaque `credential_ref` values, obtains secrets outside model context, issues short-lived scoped leases, injects them out of band, redacts output and revokes/zeroizes material after use.
5. A minimal allowlisted child environment. Never inherit the complete host environment, home directory, Core IPC endpoints, SSH agents, cloud credentials or signing material.
6. An Egress PEP that denies by default and binds destination, purpose, policy snapshot, taint and data classification. It must control DNS resolution/rebinding, redirects, IP literals, private/link-local/loopback ranges, localhost and cloud metadata endpoints.
7. Broker integration with the S05 `CapabilityRequest`, `PolicyEngine` and `PolicyEnforcer`, and with the S04 durable intent/result/audit path. Policy, sandbox health, secret custody, egress or audit failure must execute zero effects.
8. Isolated plugin/generated-code hosts with declared manifests/digests, resource limits, kill switches and fault containment sufficient to satisfy SEC-ISO-005 without implementing the later full plugin marketplace.
9. A S06 verifier and strict remote verifier that preserve every S00-S05 gate.

## Adversarial acceptance

At minimum, add deterministic tests for:

- absolute/relative traversal, encoded traversal, symlink parent/swap and mount/bind escape;
- process fork/daemon/orphan handling, signal/kill and resource exhaustion;
- unavailable or unhealthy sandbox backend and unsupported-platform behavior;
- inherited environment, home, IPC, SSH agent, keychain/KMS/signing and credential-file discovery;
- raw secret exposure through request fields, argv, environment, stdout/stderr, events, audit, crash artifacts and temporary files;
- lease scope, expiry, revocation, replay and cleanup after crash/cancel;
- DNS rebinding, redirect chains, alternate IP encodings, loopback/private/link-local/IPv6 and metadata endpoints;
- tainted or high-sensitivity content crossing an egress policy/DLP boundary;
- plugin crash/OOM/runaway behavior remaining inside its fault domain;
- zero effect when PDP, audit, sandbox, secret broker or egress enforcement is unavailable.

The Segment Gate is: known escape and secret-exposure tests report zero bypasses, default network denial is enforced, and unavailable production isolation is read-only or fail-closed on all three CI platforms.

## Recommended implementation order

1. Freeze S06 contracts, threat cases, platform capability matrix and ADR before backend code.
2. Implement pure typed plans/validators and fake backends so policy-to-broker behavior is deterministic and exhaustively testable.
3. Implement process/environment/filesystem isolation and lifecycle cleanup.
4. Implement secret lease custody/injection/redaction without raw secret persistence.
5. Implement egress resolution/redirect/DLP enforcement.
6. Wire durable decision, intent, effect and result ordering across policy and event store.
7. Add platform integration tests, fault injection and same-SHA verifiers.

Do not claim a production backend merely because a command wrapper or working-directory restriction exists. Approval, workspace roots, prompts and allowlists are not substitutes for OS isolation.

## Segment publication protocol

Use one Segment branch and explicit staging. Before every model/provider change or stop:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
pnpm verify
pnpm acceptance:new-machine
```

Then update `STATE.yaml`, `HANDOFF.md`, `EVIDENCE.json`, traceability and any ADR/decision; commit with S06 in the message; push without force; verify remote SHA equals local HEAD; wait for every required CI context; merge only through protected main; run clean-clone and strict remote S06 verification; publish the atomic completion record through a second protected PR; verify final main workflows; only then create annotated `s06-complete`.

Never mark S06 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
