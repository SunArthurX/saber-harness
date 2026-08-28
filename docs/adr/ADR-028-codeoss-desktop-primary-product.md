# ADR-028 — Code-OSS Desktop Is the Primary Product Surface

Status: accepted
Date: 2026-08-28
Deciders: repository owner and S25 architecture review

## Context

Saber has a trusted Rust Core, a versioned local control protocol and
replayable IDE client view models. It also has a loopback Web supervisor.
However, `apps/desktop-codeoss` is still a placeholder. The Web supervisor is
useful for runtime oversight, but it cannot satisfy the product objective: a
desktop CodingAgent IDE comparable in daily workflow to Codex Desktop, ZCode
and Cursor.

The original S11 evidence proved renderer/Core contracts with a simulated
harness. It did not prove that a distributable desktop workbench exists. That
historical evidence remains valid for the contracts, but it must not be used as
evidence of a finished desktop product.

## Decision

### Primary surface

Saber Studio is a Code-OSS-derived Electron desktop application for macOS,
Windows and Linux. The default route is the Desktop Agent Workbench, not the
Command Center.

The default workbench contains:

- a persistent project, Goal, Task and conversation sidebar;
- a central Agent conversation and plan surface;
- Code-OSS file explorer, editor, Diff, SCM, terminal and preview panes;
- resizable, restorable panes with task, Run, Worktree and Realm identity;
- an Evidence drawer and a compact Vital Bar for approval, health and policy.

Command Center, Health Center, Evolution Workshop and Governance are secondary
desktop views. The loopback Web supervisor remains an optional companion for
oversight and constrained remote access. It is never marketed or accepted as
the desktop IDE.

### Shell and authority boundary

The production shell uses Code-OSS/Electron to reuse the mature editor, LSP,
SCM, terminal, debugger, accessibility and extension-host foundations. Saber
Core remains a separately supervised Rust process; the Electron main process,
renderer, webviews and extension hosts are not authority boundaries.

All authoritative lifecycle and effect operations use ADR-002's versioned
JSON-RPC protocol over a local Unix socket or Windows named pipe. Renderer code
cannot directly access the event database, credentials, shell, Git, network,
plugin runtime or update trust root. The UI can lose its process without losing
the Run and reconstructs projections from durable cursors as required by
ADR-013.

### Distribution and upstream strategy

- Keep the Code-OSS fork patch set small and separately reviewable.
- Prefer a built-in Saber extension/workbench contribution over invasive core
  patches when the security and lifecycle requirements permit it.
- Automate upstream intake, license inventory, patch-conflict review and
  three-platform smoke tests.
- Use an approved extension source such as a governed private registry or Open
  VSX after legal and supply-chain review; do not assume rights to Microsoft's
  Visual Studio Marketplace.
- Ship signed installers and signed update metadata with rollback and
  last-known-good recovery.

### Rejected alternatives

- **Loopback Web console as the main product:** lacks the complete native
  development workbench and misstates the product.
- **Tauri plus a newly assembled editor as the production main line:** useful
  for a small proof of concept, but requires Saber to rebuild mature IDE
  subsystems and maintain a second ecosystem. Saber will not maintain parallel
  Code-OSS and Tauri main products.
- **Electron/Node monolith:** violates ADR-001 because the shell would gain
  ambient authority over secrets, policy and effects.
- **IDE extension only:** cannot reliably own process supervision, local data,
  update, sandbox and enterprise lifecycle while preserving the required trust
  boundaries.

## Consequences

- Desktop engineering and upstream maintenance become first-class product
  costs.
- The product can reach a credible coding workflow sooner by reusing a mature
  IDE substrate.
- The large renderer and extension attack surface is tolerated only because it
  remains outside the trusted Core boundary.
- Mobile and Web surfaces deliberately expose a smaller supervision feature
  set and cannot silently grow host-effect authority.

## Verification

- Launching the packaged application opens or restores a Desktop Agent
  Workbench, never a supervisor dashboard by default.
- A real repository task exercises conversation, plan, file edit, Diff,
  terminal, verification, approval and evidence in one desktop window.
- Killing and restarting the renderer does not terminate the Core Run and
  produces an identical replayed view from the last acknowledged cursor.
- Static and runtime checks prove every effect crosses the local control
  protocol and trusted Core.
- macOS, Windows and Linux packages pass signing, update, rollback, license,
  accessibility and smoke-test gates before production release.

