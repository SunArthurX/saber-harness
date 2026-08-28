# Saber Harness

Saber is a local-first, model-neutral and governable CodingAgent IDE/runtime.

The full 25-segment roadmap (S00–S24) is complete: sandboxed execution, deterministic default-deny policy, encrypted audit, governed evolution, E2EE sync, enterprise control, release integrity and a deterministic production gate. The trusted agent core composes all of it into one auditable run, startable from the command line today.

## Quick start: run your first governed command

Requirements: Node.js 24.15.0 (for the TS gates) and a Rust 1.98 toolchain.

```sh
# 1. Build the trusted core (once)
cargo build --release -p saber-core

# 2. Run a command inside the OS sandbox (macOS Seatbelt / Linux bwrap),
#    authorized by deterministic policy and your explicit one-shot approval
bin/saber run --store ~/saber-audit --allow sh --approve -- \
  /bin/sh -c 'echo hello from a sandboxed, fully audited run'

# 3. Try something outside the allowlist: policy denies it before any effect
bin/saber run --store ~/saber-audit -- /bin/rm -rf /tmp/anything   # exit 2, audited
```

What you get on every run: an encrypted SQLite (SQLCipher) audit trail at
`--store/facts.db` with a verifiable hash chain (`hash_chain_verified=true`),
run records, the policy decision and a transactional intent→result outbox.

Flags: `--store <dir>` (required), `--workspace <id>`, `--task <id>`,
`--allow <program>` (repeatable basename permits), `--approve` (one-shot
approval for this exact request), `--stdin <payload>`.

TS entry point: `node apps/cli/dist/index.js run …` resolves the same core
binary (override with `SABER_CORE_BIN`).

## What the plan delivered

The execution plan (docs/企业级开发执行与跨模型接力计划.md) broke the product
into 25 individually verifiable segments, each merged through protected PRs
with three-platform CI, evidence in EVIDENCE.json and an annotated
`sXX-complete` tag:

- S00–S03 continuity skeleton, constitution, monorepo CI, schemas/protocol
- S04–S06 encrypted event store, deterministic policy, sandbox/secret/egress
- S07–S14 tools, models, context, memory, IDE client, CAX, resumption, DAG
- S15–S19 evolution workshop, code capsules, E2EE sync, health, plugins
- S20–S22 remote realms, multi-tenant enterprise, release integrity
- S23–S24 beta SLOs and the deterministic production readiness gate

Post-roadmap hardening: ADR-027 wired the trusted agent core run end to end
and fixed the macOS 15.7 seatbelt composition (KI-0006); KI-0005/0007 cover
the SQLCipher codec race and a test-infra TOCTOU. 257 workspace tests, a
50-round soak and strict remote verification are green.

## Authoritative documents

- Enterprise architecture: docs/企业级本地CodingAgent-IDE产品与架构方案.md
- Execution plan: docs/企业级开发执行与跨模型接力计划.md
- Current execution state: docs/execution/STATE.yaml
- Roadmap completion: docs/execution/ROADMAP.md
- Requirement traceability: docs/traceability.yaml
- Product constitution: docs/governance/PRODUCT-CONSTITUTION.md
- Architecture invariants: docs/architecture/INVARIANTS.md
- Threat model: docs/security/THREAT-MODEL-v0.md
- Architecture decisions: docs/adr/ (ADR-001…ADR-027)
- Known issues: docs/execution/KNOWN-ISSUES.md

## Verification

```sh
pnpm acceptance:new-machine      # clean-machine bootstrap + all gates
pnpm verify                      # S00–S24 verifiers, TS gates, governance
cargo test --workspace --locked  # 257 unit/integration tests
node scripts/verify-remote-s24.mjs --repository SunArthurX/saber-harness --branch main
```

The same gates run on Linux, macOS and Windows in GitHub Actions. Tool and
Action versions are recorded in `tools/versions.json`; JavaScript and Rust
lockfiles are committed.

## Repository governance

- Official remote: `https://github.com/SunArthurX/saber-harness`
- Visibility: public; public readability does not grant an open-source license
- Changes use `fix/…` and `feat/…` branches merged through CI-verified pull requests.
- Protected-main rules require CI-verified pull requests, linear history, resolved conversations, and prohibit force pushes and branch deletion.
- GitHub secret scanning, push protection and Dependabot security updates are enabled.
- The current license posture is private and proprietary; see `LICENSE`.
