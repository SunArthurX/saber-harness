# S25 Handoff — Desktop Workbench Baseline

Status: ready for protected review; advanced research and philosophy expansion passes local gates
Date: 2026-08-28
Branch: `segment/S25-desktop-workbench-baseline`
Verified content checkpoint: `60c85b59b04d55f31da429aad982b2a31c52edc9`
Protected review: <https://github.com/SunArthurX/saber-harness/pull/69>
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
- Added `docs/execution/desktop/README.md` and 13 S26-S38 Segment runbooks. They
  define 78 owned work packages with prerequisites, non-goals, failure states,
  platform cases, verification, Exit Gates, evidence and handoff requirements.
- Added a machine-readable WBS, 24-screen UX inventory, 13 acceptance journeys,
  platform/release matrix, team RACI, real-repository evaluation plan and a
  copy-ready S26 next-model instruction file.
- Added an official-source, evidence-graded comparison of Codex Desktop,
  Claude Code Desktop, ZCode and MiniMax Code: 31 capability records resolve to
  13 Saber-specific product decisions rather than superficial feature parity.
- Added a machine-readable capability map and made every capability trace to
  its implementing Segment, desktop surface and acceptance journey.
- Expanded the inventory from 24 to 35 desktop surfaces and from 13 to 24
  end-to-end journeys, including Handoff, Side Inquiry, Preview Auto-Verify,
  persistent Goals, dynamic Leader/Worker/Verifier teams, harness adapters,
  automations, remote Realms and governed Memory-to-Code evolution.
- Added competitor-derived requirements to every S26-S38 runbook and WBS
  Segment while keeping future implementation outside S25 scope.
- Added `DESKTOP-PRODUCT-OPERATING-MODEL.md` to freeze 16 canonical product
  objects, Core/projection ownership, Goal/Task/Run/Approval/Evidence/knowledge/
  health lifecycles, navigation identity, recovery and telemetry semantics.
- Added four machine-readable release trains and mirrored them into every WBS
  Segment and runbook: RT-0 is explicitly an engineering preview, RT-1 after
  S31 is the first real CodingAgent MVP, RT-2 is local-first continuity/team
  Beta and RT-3 is the enterprise production candidate.
- Added evidence-bearing release claim Gates so a shell, screenshot, Web
  Supervisor, transcript or mixed-SHA result cannot be renamed into a higher
  product milestone.
- Expanded the S25 verifier from 41 to 1542 checks so the execution pack cannot
  silently lose a Segment, work package, owner, Gate or cross-cutting control.
- Corrected ADR-028's trailing blank line after the PR merge-ref whitespace gate
  exposed it; the execution Definition of Done now checks the whole base diff.
- Added an official-source second research layer for Cursor, DeepSeek Harness,
  Zed, Kiro, OpenHands, Cline and Aider: 36 additional capability records map to
  Saber-specific contracts, philosophy principles, Segments, UI and journeys.
- Added `PHILOSOPHY-TO-ARCHITECTURE.md` and its machine-readable map: 12
  philosophical invariants, 19 body/system organs, the authority stack, bounded
  homeostasis, E0-E7 evolution, H0-H4 health, five data islands and 12 philosophy
  acceptance journeys.
- Kept DeepSeek Harness-style service seams, profiles, reconstructable events
  and reversible effects outside the privileged immune Core; Policy, Sandbox,
  Secret, Egress, Audit, Update and Recovery remain higher authority than the
  model, Agent, plugin, Hook or Renderer.
- Expanded the operating model to 23 canonical objects, adding Specification,
  Agent Profile, Reflex Hook, Checkpoint, Runtime Image and Projection Recipe
  with explicit lifecycle and invalidation semantics.
- Expanded the desktop inventory from 35 to 42 screens and product journeys
  from 24 to 32. New workbench surfaces cover adapter capability, reflex Hooks,
  Runtime attestation, causal replay, Specification, Repository Map/context
  budget and recovery/homeostasis; they are not a separate Web supervisor.
- Added all advanced capability and philosophy requirements to S26-S38
  runbooks, WBS and release trains without changing the 78-work-package
  sequence or starting S26.
- Expanded `verify-s25.mjs` from 1542 to 3049 checks, including bidirectional
  capability/WBS symmetry, principle/organ schemas, product-object coverage,
  new UI/journeys and philosophy-bearing release Gates.

## Current truth

- `bin/saber ui` is a working loopback Web supervisor.
- `packages/ide-client` contains protocol and replayable headless ViewModels.
- `apps/desktop-codeoss` is still a placeholder. No packaged desktop app,
  Code-OSS fork or real desktop vertical slice exists yet.
- No S26 implementation was started while refining this plan.
- The competitor research is a dated design input, not a claim that Saber has
  already implemented those capabilities.
- The S00-S24 Core, security and governance evidence remains authoritative for
  those contracts. It is not proof of desktop GUI completion.

## Local evidence

- `node scripts/verify-s25.mjs`: 1542 checks passed for the product baseline,
  detailed execution pack, 31-item competitive capability map and bidirectional
  capability/Segment/runbook plus release-train/WBS traceability.
- `pnpm verify`: passed after correcting only new-file formatting; existing
  non-blocking Biome warnings remain unchanged.
- TypeScript build/typecheck, 22 package tests, license gate, S00-S25 verifiers
  and 15 governance tests passed inside the full command.
- The two user PDFs were read as research inputs only. Extracted and rendered
  scratch data lives under ignored `tmp/pdfs/` and is not part of the change.
- The two source PDFs remain outside the public commit; only independently
  written findings, mappings and official public links are tracked.
- The original PDF files were not present at their earlier Downloads paths
  during this refinement. Existing ignored extracted text and rendered pages
  were used only to recheck the prior philosophy findings; no missing PDF is
  represented as freshly re-read.
- Branch push is verified for the content checkpoint; resolve the latest
  continuity-only head directly from Git.
- The first Monorepo CI attempt reached the JavaScript gate on all three OSes
  after Rust checks passed, then rejected non-canonical Biome formatting in the
  newly updated `EVIDENCE.json`. Repository Verification passed. The formatting
  correction was committed and locally reverified.
- The corrected checkpoint `a74d09b` passed Repository Verification run
  33148770142 and Monorepo CI run 33148770147: dependency audit plus macOS,
  Windows and Linux jobs all succeeded.
- The refined execution-pack checkpoint `ea3b971` passed push and PR workflows:
  Repository Verification runs 33150529040/33150531933 and Monorepo CI runs
  33150528988/33150531890. All 10 PR checks succeeded and GitHub reports the
  PR merge state as clean.
- The competitive-research checkpoint `ed0ca1a` passed push and PR workflows:
  Repository Verification runs 33152873608/33152875838 and Monorepo CI runs
  33152873714/33152875817. Both dependency audits and all macOS, Windows and
  Linux jobs succeeded; PR #69 again reports 10/10 successful checks and a
  clean merge state.
- The product-operating-model checkpoint `60c85b5` passed push and PR workflows:
  Repository Verification runs 33168573327/33168575644 and Monorepo CI runs
  33168573273/33168575647. Both dependency audits and all macOS, Windows and
  Linux jobs succeeded; PR #69 reports 10/10 successful checks and a clean
  merge state.
- The advanced harness/philosophy work passes `node scripts/verify-s25.mjs`
  with 3049 checks, `git diff --check` and `pnpm verify`. Deterministic
  generation, format, lint, typecheck, build, 22 package tests, license, S00-S25
  verifiers and 15 governance tests passed; one pre-existing Biome warning and
  one pre-existing info diagnostic remain unchanged. Hosted checks are pending
  until this checkpoint is committed and pushed.

## Remaining S25 acceptance

1. Commit and push the advanced research/philosophy checkpoint, verify remote
   SHA and hosted PR checks, then review and merge PR #69 through protected
   main. Update the completion record and tag only if every S25 acceptance item
   is proved.

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
