# Saber Harness

Saber is a local-first, model-neutral and governable CodingAgent IDE/runtime.

This repository is currently in Segment S00: repository bootstrap and cross-model continuity.

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

    node scripts/verify-s00.mjs
    node scripts/verify-s01.mjs
    node --test scripts/tests/*.test.mjs

After the GitHub account or repository has private branch-protection entitlement, run:

    node scripts/configure-main-protection.mjs --apply
    node scripts/verify-remote-s00.mjs

The same zero-dependency verification runs in GitHub Actions for Segment branches, pull requests, and `main`.

## Repository governance

- Official remote: `https://github.com/SunArthurX/saber-harness`
- Visibility: public; public readability does not grant an open-source license
- Changes use `segment/Sxx-slug` branches and pull requests.
- `main` is the integration branch and changes are merged through CI-verified pull requests.
- Protected-main rules require CI-verified pull requests, linear history, resolved conversations, and prohibit force pushes and branch deletion.
- The current license posture is private and proprietary; see `LICENSE`.
