# Saber Harness

Saber is a local-first, model-neutral and governable CodingAgent IDE/runtime.

Segments S00-S04 are complete. The current verified foundation includes repository governance, reproducible multi-platform builds, canonical domain/control contracts, and an encrypted transactional event store with trusted Run transitions and crash recovery. Segment S05 is next: deterministic Capability, Policy and Approval enforcement.

## Authoritative documents

- Enterprise architecture: docs/企业级本地CodingAgent-IDE产品与架构方案.md
- Execution plan: docs/企业级开发执行与跨模型接力计划.md
- Current execution state: docs/execution/STATE.yaml
- Current model handoff: docs/execution/HANDOFF.md
- Requirement traceability: docs/traceability.yaml
- Product constitution: docs/governance/PRODUCT-CONSTITUTION.md
- Architecture invariants: docs/architecture/INVARIANTS.md
- Threat model: docs/security/THREAT-MODEL-v0.md
- Architecture decisions: docs/adr/

## Current verification

Run:

    # First install Node.js 24.15.0 with NVM, Volta, mise, asdf, fnm or nodenv.
    node scripts/bootstrap.mjs --install
    pnpm install --frozen-lockfile
    pnpm acceptance:new-machine

The bootstrap resolver checks the active executable, `PATH` and common version-manager locations, then re-executes itself with exactly Node.js 24.15.0. In unusual layouts, set `SABER_NODE_PATH` to the exact Node executable. Package-manager subprocesses inherit that selected runtime; a different system Node earlier on `PATH` is not accepted or used.

For focused and strict remote verification, run:

    pnpm verify
    node scripts/verify-remote-s04.mjs --branch main

The same gates run on Linux, macOS and Windows in GitHub Actions. Tool and Action versions are recorded in `tools/versions.json`; JavaScript and Rust lockfiles are committed.

## Repository governance

- Official remote: `https://github.com/SunArthurX/saber-harness`
- Visibility: public; public readability does not grant an open-source license
- Changes use `segment/Sxx-slug` branches and pull requests.
- `main` is the integration branch and changes are merged through CI-verified pull requests.
- Protected-main rules require CI-verified pull requests, linear history, resolved conversations, and prohibit force pushes and branch deletion.
- GitHub secret scanning, push protection and Dependabot security updates are enabled.
- The current license posture is private and proprietary; see `LICENSE`.
