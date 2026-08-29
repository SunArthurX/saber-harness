# S28 Handoff — Desktop Workbench Shell

Status: in progress — the complete shell contract is implemented, tested
locally and chained into every gate; the protected PR, hosted checks,
completion record and s28-complete tag remain
Date: 2026-08-29
Branch: `segment/S28-workbench-shell`
Base main: `5f63b248e6396acd977e45245aaedb4167e94969` (`s27-complete`)
Runbook: `docs/execution/desktop/S28-DESKTOP-WORKBENCH-SHELL.md`

## Objective

A developer opens a real repository into the default three-zone Desktop
Agent Workbench — persistent project/task navigation, a central agent
pane and native Code-OSS editor surfaces — with a keyboard-operable pane
lattice, named presets, versioned layout persistence that survives
restart and recovers from corruption, fail-closed agent-identity gating
and an audited accessibility contract. No agent execution is required
yet, and the Core authority boundary stays untouched.

## What landed

- **WP01 layout tokens**: `workbenchLayout.js` — safe states at
  1280/900/narrow, per-pane min/max ownership across the six regions,
  keyboard splitter steps (small 16px / large 64px) clamped to bounds,
  default reset, the four named Focus/Build/Review/Team presets, the
  Workspace/Task/Realm Layout Receipt (revision-bound), and theme tokens
  with light/dark/high-contrast values plus a reduced-motion contract.
- **WP02 navigation projections**: `navigationProjection.js` — a pure
  replayable store over Projects/Goals/Tasks/Conversations/Runs with
  stable IDs, incremental deltas, the nine view states, saved
  group/workspace/timeline views, search/pin/archive ordering and a
  TRANSITIONS matrix that context menus must match (verified against the
  shipped `when` clauses). Selection is local intent only.
- **WP03 identity context**: `identityContext.js` — Task/Run/Worktree/
  Realm headers; `assertDestructiveAllowed` fails closed on manual
  identity, missing fields and unknown actions; `revisionBinding`
  surfaces mismatches. Manual edits coexist with agent worktrees but
  never authorize agent effects.
- **WP04 agent workspace placeholders**: `agentWorkspace.js` — fixture
  ViewModels (frozen provenance, `authoritative: false`) for
  Conversation, Plan, Evidence (S27 replay event shape) and the Vital
  Bar; Command Center is a secondary-sidebar view with
  `defaultStartupRoute: false`; the first-run walkthrough is local-only
  with no remote content; the Specification Studio route is reserved,
  not executing (KIR-01).
- **WP05 persistence**: `layoutPersistence.js` — versioned layout
  records under dedicated storage keys; restore clamps, replaces
  unavailable panes with explainable placeholders, falls back to the
  default lattice on corruption/unsupported versions without deleting
  run data, and refuses silent Worktree/Realm switches.
- **WP06 accessibility**: `a11yAudit.js` — the seven-step keyboard
  path, landmark roles for every region, polite state-changes-only live
  regions (no streaming noise), WCAG contrast audits on the theme tokens
  across all three themes, 200% zoom reflow, zh/en parity audit,
  middle truncation for long paths, 24px pointer targets, focus-ring
  token and reduced motion.
- **Extension wiring**: native contributions only — five navigation
  views in the default workbench container, the Evidence drawer in the
  bottom panel, Command Center in the auxiliary sidebar, a Vital Bar
  status item, an identity status item, 13 keybindings (path + splitter
  movement with pane args), context menus gated on viewItem states, and
  welcome content with command links. No webview anywhere (asserted).
- **Smoke**: `desktop:smoke --workspace fixtures/repos/basic` validates
  the real-workspace fixture and asserts the S28 contribution surface
  statically; runtime three-OS launch remains hosted evidence.
- **Verification**: `scripts/verify-s28.mjs` (142 checks),
  `desktop:test:workbench` (17 tests), `desktop:test:a11y` (8 tests),
  chained into `verify:repo` and the hosted repository-verification
  workflow. `verify-s26`'s extension boundary evolved honestly: sibling
  src/ modules are allowed (each verified to resolve inside the
  extension) while Node built-ins and npm packages stay forbidden.

## Evidence

See `docs/execution/EVIDENCE.json` (S28 in_progress): every work
package has a focused check with real local results; the full
`pnpm verify` gate is green on the branch.

## Next actions

1. Push `segment/S28-workbench-shell`, open the protected PR.
2. Wait for repository-verification, monorepo ubuntu/macos/windows and
   dependency-audit; require mergeStateStatus CLEAN.
3. Squash-merge; land the completion record (STATE/EVIDENCE/HANDOFF);
   tag annotated `s28-complete` on the record merge commit and verify
   the peeled SHA equals that main commit locally and remotely.
4. Do not start S29 before `s28-complete` exists; S29 begins from
   `docs/execution/desktop/S29-CONVERSATION-CONTEXT.md` in a new
   execution round.

## Honest limits

- All workbench data is fixture data with frozen provenance; the Core is
  not connected by the shell yet (S27 transport exists; binding lands
  with governed runs in S30).
- No agent execution, no effect path, no webview: the shell cannot run
  commands, read secrets or mutate Core state.
- Runtime launch/restart/corrupt-layout evidence on real packaged builds
  is hosted-CI evidence (desktop:build matrix) and is recorded as such.
