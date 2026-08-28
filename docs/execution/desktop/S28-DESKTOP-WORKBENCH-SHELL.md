# S28 Runbook — Desktop Workbench Shell

Status: planned

Release train: RT-0 Foundation Preview — engineering preview, not MVP

Duration: 10-15 working days

Owners: Product/UX Lead (A), Extension and Editor Engineers (R), Accessibility
Engineer (R), Desktop Engineer and SDET (C/R)

Risk: high

## Outcome

A developer opens a real repository into the default three-zone Desktop Agent
Workbench: persistent project/task navigation, central Agent workspace and
native Code-OSS editor surfaces. Layout, focus and accessible identity survive
restart. No Agent execution is required yet.

## Competitive-derived requirements

- `CDX-01`, `CLD-01`, `ZCD-01`: implement a persistent project/task command
  center and composable, keyboard-operable Pane lattice with named
  Focus/Build/Review/Team presets and a Workspace/Task/Realm Layout Receipt.
- `CDX-07`, `CLD-02`, `ZCD-04`: reserve first-class terminal and Preview
  Session panes beside native
  editor and terminal surfaces; preview is not a generic privileged Webview.
- `ZCD-03`: Task navigation supports saved group/workspace/timeline views,
  search, pin and archive; generated Repository Map shows source revision.

## Advanced harness and philosophy requirements

- `CUR-05`, `DSH-05`: bind Preview, editor, terminal, LSP and repository views
  to visible Realm and revision identity.
- `ZED-01`, `ZED-03`, `KIR-03`, `OHD-03`: present native, external and terminal
  Agent paths in one project/task workbench while keeping UI a disposable
  projection of Core state.
- `KIR-01`: reserve a Specification Studio route linked to Goal/Task identity;
  S28 supplies the accessible shell, not authoritative spec execution.

## Work packages

### S28-WP01 — Information architecture and layout tokens

- Freeze minimum 1280px, compact 900px and narrow safe states.
- Define primary sidebar, central Agent pane, editor/secondary sidebar, bottom
  panel, Evidence drawer and Vital Bar ownership.
- Define pane minimum/maximum width, splitter keyboard movement, default reset
  and role-based saved layouts.
- Use Code-OSS theme tokens; custom tokens require light/dark/high-contrast
  values and reduced-motion behavior.

### S28-WP02 — Navigation projections

- Native Tree Views for Projects, Goals, Tasks, Conversations and background
  Runs with stable IDs and incremental updates.
- States: first run, no repository, loading, empty, ready, waiting, failed,
  archived and offline.
- Context menus expose only valid state transitions; selection cannot mutate
  Core state without an explicit command.
- Preserve expansion, selection and scroll as non-authoritative local state.

### S28-WP03 — Native IDE composition

- Reuse Explorer, Search, SCM, Editor, Problems, Output, Test and Terminal.
- Every Agent-related editor/terminal/diff header displays Task, Run, Worktree
  and Realm; missing identity blocks destructive Agent action.
- Define how user-owned manual edits coexist with Agent Worktree changes.
- Avoid recreating native editor, settings, welcome or file-tree capabilities
  in Webviews.

### S28-WP04 — Agent workspace placeholders

- Central tab hosts Conversation and Plan placeholders backed by fixture
  ViewModels.
- Evidence drawer and Vital Bar render Core health/replay fixture data.
- Command Center remains a user-selected secondary view and is absent from the
  default startup route.
- First-run walkthrough opens/creates a Workspace and Goal without remote
  marketing content.

### S28-WP05 — Persistence and restoration

- Store layout version separately from authoritative state.
- Restore valid panes; replace unavailable extension/preview panes with an
  explainable placeholder.
- Corrupt layout falls back to default without deleting Run data.
- Multi-window close/reopen cannot switch Worktree or Realm silently.

### S28-WP06 — Accessibility and UX acceptance

- Full keyboard path for open repository, select Task, focus Conversation,
  focus Editor, open Terminal, open Evidence and return focus.
- Screen-reader landmarks and live regions announce state changes without
  streaming noise.
- 200% zoom, high contrast, Chinese/English strings and long-path truncation.
- Pointer target, focus ring, contrast and reduced-motion review.

## Verification

```sh
node scripts/verify-s28.mjs
pnpm desktop:test:workbench
pnpm desktop:test:a11y
pnpm desktop:smoke --workspace fixtures/repos/basic
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- Three supported OSes open a real repository into the same default workbench.
- Editor, SCM and Terminal are native Code-OSS surfaces and functional.
- Layout restart and corrupt-layout recovery pass.
- Command Center is secondary by automated startup assertion.
- Core authority boundary remains unchanged.
