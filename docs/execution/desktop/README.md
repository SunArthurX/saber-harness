# Saber Studio Desktop Execution Pack

Version: 1.1

Status: executable planning baseline; S26 implementation has not started

## Purpose

This directory turns the S25-S38 enterprise roadmap into a handoff-safe set of
runbooks. A human or coding model should be able to select one Segment, confirm
its prerequisites, execute its work packages, produce the required evidence and
stop without relying on a previous chat.

The pack is authoritative for desktop execution detail only after it is merged
through the repository review process. `AGENTS.md`, accepted ADRs, schemas,
tests, `STATE.yaml`, `HANDOFF.md`, `EVIDENCE.json` and remote Git state retain
higher authority.

## Five-minute start

1. Read repository `AGENTS.md` completely.
2. Read `docs/execution/STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json`.
3. Confirm the preceding Segment tag and remote main SHA.
4. Open the runbook for the current Segment; do not begin the next runbook.
5. Resolve every `TBD-BY-SEGMENT` item during that Segment's design review;
   never silently invent signing identities, upstream SHAs, tenant identifiers
   or production endpoints.
6. Create `segment/Sxx-slug`, stage explicit paths and use the Segment ID in
   commits.
7. Run the preflight and focused checks in the runbook before changing files.
8. Update execution evidence before stopping or changing model.

## Documents

| File | Use |
|---|---|
| `SEGMENT-RUNBOOK-TEMPLATE.md` | Mandatory structure for every future runbook |
| `desktop-workbench-wbs.json` | Machine-readable Segment, task, dependency and Gate index |
| `COMPETITIVE-CAPABILITY-RESEARCH.md` | Official-source Codex/Claude/ZCode/MiniMax findings and Saber decisions |
| `competitive-capability-map.json` | Machine-readable competitor capability → Segment/UI/journey mapping |
| `ACCEPTANCE-AND-TRACEABILITY.md` | Product journeys, evidence owners and release traceability |
| `UX-SCREEN-INVENTORY.md` | Every desktop screen, state, action and accessibility obligation |
| `PLATFORM-AND-RELEASE-MATRIX.md` | OS, architecture, packaging, signing, update and recovery matrix |
| `TEAM-OPERATING-MODEL.md` | RACI, ceremonies, escalation, review and evidence ownership |
| `EVAL-AND-DESIGN-PARTNER-PLAN.md` | Real-repository evaluation and staged customer validation |
| `NEXT-MODEL-S26.md` | Copy-ready start instructions for the model implementing S26 |
| `S26-*.md` through `S38-*.md` | One bounded implementation runbook per Segment |

## Segment order

```text
S25 baseline and protected merge
  ↓
S26 Code-OSS bootstrap
  ↓
S27 Core supervision and transport
  ↓
S28 desktop workbench shell
  ↓
S29 conversation and context
  ↓
S30 governed Agent run
  ↓
S31 changes and evidence review
  ↓
S32 multi-Agent and Worktree
  ↓
S33 continuity and knowledge
  ↓
S34 armor, evolution and health
  ↓
S35 enterprise desktop
  ↓
S36 packaging and update
  ↓
S37 quality and security gate
  ↓
S38 design partner and production
```

## Universal preflight

Run from the repository root:

```sh
git status --short --branch
git fetch --tags origin
git rev-parse HEAD
git rev-parse origin/main
node scripts/verify-s00.mjs
node scripts/verify-s25.mjs
pnpm install --frozen-lockfile
```

Starting with S26, also run the focused verifier for every completed desktop
Segment. Each new verifier must be appended to `package.json` and Repository
Verification without removing prior gates.

## Universal Definition of Done

A Segment is done only when all statements are true:

- The predecessor tag resolves to the reviewed main commit required by the
  runbook.
- Scope and non-goals are unchanged or an accepted ADR records the change.
- Every work package has an owner, reviewer, test and evidence entry.
- Every adopted competitor capability has a `CDX`/`CLD`/`ZCD`/`MMX` evidence
  ID, a Saber-specific decision, Segment, UI state and acceptance journey.
- Tests cover success, denial, crash/restart and at least one adversarial case.
- macOS, Windows and Linux hosted checks are green where the runbook requires
  them.
- No Renderer, extension, Webview or Electron-main path bypasses Saber Core for
  an authoritative effect.
- The new focused verifier is chained into local and hosted gates.
- Before commit, `git diff origin/main --check` is clean; after commit,
  `git diff --check origin/main...HEAD` is also clean. Checking only `HEAD^`
  is insufficient for a multi-commit Segment or a generated PR merge ref.
- `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` tell the same truth.
- The Segment branch is pushed and its remote SHA equals local `HEAD`.
- Protected review and merge are complete before the next Segment begins.

## Stop conditions

Stop and record a blocker instead of improvising when:

- an upstream Code-OSS or Electron license/redistribution term is unresolved;
- a requested UX needs Renderer authority not present in the Core protocol;
- a signing key, notarization identity, enterprise IdP or KMS is required but
  not explicitly supplied;
- a platform sandbox cannot enforce the declared boundary;
- a migration, updater or rollback path can orphan user data;
- a test requires raw private conversations, credentials or production code;
- acceptance depends on a mock while the Gate requires a packaged desktop app.
