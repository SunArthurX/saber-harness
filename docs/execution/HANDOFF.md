# S25 Handoff — Desktop Workbench Baseline

Status: in progress; local gates and remote SHA pass, hosted CI running
Date: 2026-08-28
Branch: `segment/S25-desktop-workbench-baseline`
Verified content checkpoint: `317ee1baa4d7a1f3c83ca3200c50537b40c59d03`
Base main: `af85f697a47a94e667536d396066639d2d56578a`
Predecessor: annotated `s24-complete` resolves to `502dd1db348be7e0c4ab1a6e188275b26027d5dd`

## Objective

Correct the product center of gravity: Saber Studio Desktop is the primary
product and must default to a complete CodingAgent workbench. The loopback Web
console is an optional supervisor surface, not the desktop implementation.

## What changed locally

- Added ADR-028 selecting a Code-OSS/Electron production shell with a
  separately supervised Rust Core and no parallel Tauri product line.
- Added `docs/execution/DESKTOP-WORKBENCH-ENTERPRISE-PLAN.md`: current-state
  audit, target workbench, architecture, S25-S38 plan, 30-40 week schedule,
  staffing, quality gates, KPI, risks and budget assumptions.
- Corrected the GUI design so `Desktop Agent Workbench` is section 5.1 and the
  default route; Command Center is secondary.
- Updated the desktop placeholder README to state that the production shell has
  not landed.
- Added `scripts/verify-s25.mjs` and wired it into local and hosted repository
  verification.

## Current truth

- `bin/saber ui` is a working loopback Web supervisor.
- `packages/ide-client` contains protocol and replayable headless ViewModels.
- `apps/desktop-codeoss` is still a placeholder. No packaged desktop app,
  Code-OSS fork or real desktop vertical slice exists yet.
- The S00-S24 Core, security and governance evidence remains authoritative for
  those contracts. It is not proof of desktop GUI completion.

## Local evidence

- `node scripts/verify-s25.mjs`: 41 checks passed.
- `pnpm verify`: passed after correcting only new-file formatting; existing
  non-blocking Biome warnings remain unchanged.
- TypeScript build/typecheck, 22 package tests, license gate, S00-S25 verifiers
  and 15 governance tests passed inside the full command.
- The two user PDFs were read as research inputs only. Extracted and rendered
  scratch data lives under ignored `tmp/pdfs/` and is not part of the change.
- Branch push is verified: local and remote both resolve to
  `317ee1baa4d7a1f3c83ca3200c50537b40c59d03` for the content checkpoint;
  resolve the latest continuity-only head directly from Git.
- GitHub push workflows were queued/running at the checkpoint; they are not yet
  completion evidence.

## Remaining S25 acceptance

1. Wait for hosted branch CI on the verified checkpoint.
2. Merge through protected main review; then update the completion record and
   tag only if every S25 acceptance item is proved.

## S26 start condition

Do not start Code-OSS bootstrap until S25 is merged. When it starts, first pin
an upstream Code-OSS commit, record license and patch provenance, and produce a
three-platform reproducible shell build. S26 must open the Desktop Agent
Workbench by default and must not depend on `bin/saber ui` for the primary
experience.

## Non-negotiable review points

- Desktop is primary; Command Center and Web Supervisor are secondary.
- Code-OSS/Electron is a low-trust UI shell; Rust Core remains authoritative.
- No screenshot, static HTML, Storybook, fake Core or Web supervisor can prove
  desktop completion.
- Every future Segment keeps Policy, Sandbox, Secret, Egress, Audit, Update and
  Recovery boundaries at least as strong as S00-S24.
