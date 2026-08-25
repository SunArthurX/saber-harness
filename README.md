# Saber Harness

Saber is a local-first, model-neutral and governable CodingAgent IDE/runtime.

This repository is currently in Segment S00: repository bootstrap and cross-model continuity.

## Authoritative documents

- Enterprise architecture: docs/企业级本地CodingAgent-IDE产品与架构方案.md
- Execution plan: docs/企业级开发执行与跨模型接力计划.md
- Current execution state: docs/execution/STATE.yaml
- Current model handoff: docs/execution/HANDOFF.md
- Requirement traceability: docs/traceability.yaml

## Current verification

Run:

    node scripts/verify-s00.mjs

The same zero-dependency verification runs in GitHub Actions for Segment branches, pull requests, and `main`.

## Repository governance

- Official remote: `https://github.com/SunArthurX/saber-harness`
- Visibility: private
- Changes use `segment/Sxx-slug` branches and pull requests.
- `main` is the protected integration branch.
- The current license posture is private and proprietary; see `LICENSE`.
