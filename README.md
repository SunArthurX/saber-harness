# Saber Harness

Saber is a local-first, model-neutral and governable CodingAgent IDE/runtime.

This repository is currently in Segment S02: reproducible monorepo and multi-platform CI.

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

    corepack install --global pnpm@11.23.0
    node scripts/bootstrap.mjs --install
    pnpm install --frozen-lockfile
    pnpm acceptance:new-machine

For focused and strict remote verification, run:

    pnpm verify
    node scripts/verify-remote-s02.mjs --branch segment/S02-monorepo-ci

The same gates run on Linux, macOS and Windows in GitHub Actions. Tool and Action versions are recorded in `tools/versions.json`; JavaScript and Rust lockfiles are committed.

## Repository governance

- Official remote: `https://github.com/SunArthurX/saber-harness`
- Visibility: public; public readability does not grant an open-source license
- Changes use `segment/Sxx-slug` branches and pull requests.
- `main` is the integration branch and changes are merged through CI-verified pull requests.
- Protected-main rules require CI-verified pull requests, linear history, resolved conversations, and prohibit force pushes and branch deletion.
- GitHub secret scanning, push protection and Dependabot security updates are enabled.
- The current license posture is private and proprietary; see `LICENSE`.
