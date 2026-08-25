# S02 Handoff

Status: in progress
Date: 2026-08-25
Branch: `segment/S02-monorepo-ci`
Base: `s01-complete` / `b3ac4f1471ca881cb979c0e642c3e6ecbe4d22b0`

## Objective

Create a reproducible Rust and TypeScript monorepo foundation for Saber, verify it on Linux, macOS and Windows, and make toolchain, dependency, license, secret and clean-machine acceptance failures block integration.

## Completed locally

- Added Rust workspace crates for the trusted core and versioned core protocol.
- Added pnpm workspace packages for a model-neutral agent runtime and CLI smoke path, plus reserved Code-OSS shell, schema and eval boundaries.
- Pinned Rust 1.98.0, Node.js 24.15.0, pnpm 11.23.0, TypeScript 7.0.2 and Biome 2.5.10; recorded schema, migration and supply-chain tool versions.
- Added Cargo and pnpm lockfiles; all product packages remain private and `UNLICENSED`.
- Added format, lint, type, build, Rust clippy, tests, license inventory, dependency audit and repository-safety gates.
- Added a 30-minute clean-machine acceptance driver; the local cached run passed in 7 seconds.
- Added a Linux/macOS/Windows matrix workflow with immutable Action SHAs and caches.
- Added Dependabot configuration and enabled GitHub secret scanning, push protection and Dependabot security updates.
- Local Rust tests passed (2), TypeScript smoke tests passed (2), governance tests passed (10), S02 verification passed 61 checks and pnpm audit found no known vulnerabilities.

## Pending acceptance

| Item | State | Required action |
|---|---|---|
| Segment push/SHA equality | pending | commit, push and compare local/remote SHA |
| Three-platform CI | pending | Linux, macOS and Windows matrix jobs must pass |
| Dependency audit CI | pending | pnpm and RustSec hosted audits must pass |
| Protected-main integration | pending | merge only through the protected PR flow |
| Clean-clone acceptance | pending | verify lockfile installation and all gates from a new clone |
| Atomic completion record | pending | merge final completed STATE/HANDOFF/EVIDENCE through a second protected PR |

## Non-negotiable review points

- Do not replace exact version or Action-SHA pins with floating labels.
- Do not publish workspace packages or change the proprietary license posture implicitly.
- Do not move trusted authority into the TypeScript/UI workspace.
- Do not exclude a supported desktop operating system to make the matrix pass.
- Do not waive security, license, clippy or repository-safety failures.

## Next action

1. Commit and push the initial S02 implementation.
2. Open the S02 PR and require all hosted matrix and audit jobs to pass.
3. Run `node scripts/verify-remote-s02.mjs --branch segment/S02-monorepo-ci` after CI succeeds.
