# Desktop CodingAgent Competitive Capability Research

Version: 1.0

Research date: 2026-08-28

Scope: Codex desktop, Claude Code Desktop, ZCode Desktop and MiniMax Code
Desktop. Product documentation is evidence; marketing claims are marked as
such. This document does not instruct implementation and does not authorize
S26 to start before S25 protected merge.

## Research method and evidence grades

- Grade A: current official behavior or product documentation with operational
  detail, limits and user-visible semantics.
- Grade B: official product page, release post or engineering blog describing a
  capability but not a complete contract.
- Grade C: inference. It can generate a research question but cannot become a
  requirement without a Saber design decision and verification method.
- Competitor names describe provenance only. Saber owns its vocabulary,
  protocol, security boundary and acceptance criteria.
- A feature is adopted only when it advances a Saber user journey; visual
  imitation or checklist parity is not a product objective.

## Executive synthesis

| Product | Strongest product idea | What Saber adopts | What Saber deliberately improves |
|---|---|---|---|
| Codex desktop | durable project/chat command center across Local, Worktree and Cloud | environment-aware chats, safe Handoff, agent import, scheduled continuation, event protocol | Core-owned authority, portable lineage, provider-neutral adapters and explicit evidence |
| Claude Code Desktop | composable coding cockpit with chat, Diff, preview, terminal, plan, task and subagent panes | pane lattice, Side Inquiry, live preview, auto-verification, cross-session coordination | Linux parity, trustworthy preview receipts, no silent cross-session context or effect authority |
| ZCode Desktop | Agent-centered ADE with persistent Goal and integrated browser, Review, task and plugin flows | evidence-checked Goal loop, task organization, remote control, browser validation and capability bundles | inspectable/revocable Memory, signed plugins, independent verifier and multi-harness continuity |
| MiniMax Code Desktop | dynamic Agent Team that learns through Leader/Worker/Verifier loops | complexity-aware team formation, adversarial verification, responsive lead and memory-to-capability proposals | deterministic runtime, budgets, Worktree/Realm isolation, human sign-off and rollback before promotion |

Saber's product thesis is **one governed body with replaceable brains and
auditable armor**. It should feel simpler than the sum of these products while
making hidden context, authority, evidence, memory and evolution more visible.

## Codex desktop findings

### CDX-01 — Project and long-running chat command center — Grade A

The desktop app keeps projects and long-running chats visible, opens real
artifacts in the same workspace and can use browser, desktop apps, plugins and
scheduled tasks. Saber adopts a persistent Project → Goal → Task → Conversation
tree, but the default center remains the CodingAgent workbench rather than a
general artifact chat.

### CDX-02 — Local, Worktree and Cloud environments with Handoff — Grade A

Codex makes the execution location a first-class chat choice. Managed Worktrees
support parallel work, background/foreground movement, snapshots before cleanup
and safe Handoff between a Worktree and the local checkout. Saber generalizes
this to Local, Worktree, SSH, Container and policy-approved Cloud Realms. Every
Handoff must move a Resumption Capsule and verify repository/environment drift;
it must never imply that untracked secrets or ignored files moved safely.

### CDX-03 — Import from other agents — Grade A

Codex can import supported instructions, settings, skills, plugins, projects and
recent work from Claude Code, Claude Cowork or Cursor, with selective import and
optional synchronization. Saber adopts adapters for conversation/setup import,
but stores immutable Raw input, a Canonical representation, Derived knowledge
and Lineage. Import never auto-trusts instructions, tools, Memory or secrets.

### CDX-04 — Scheduled tasks bound to project or chat — Grade A

Codex distinguishes independent scheduled runs from tasks that return to an
existing chat, and can isolate repository work in a background Worktree. Saber
adopts the distinction as Automation Run versus Goal Heartbeat, with explicit
Realm, budget, stop rule, missed-run policy, approval policy and evidence inbox.

### CDX-05 — Event-oriented App Server protocol — Grade A

Codex App Server exposes thread, turn and item lifecycles, streaming
notifications, steering, interruption, initialization and client capability
negotiation. Saber adopts the protocol shape, not the API: Core owns versioned
Goal/Task/Run/Event objects, resumable cursors, idempotency and capability
attestation. UI clients remain projections, never authorities.

### CDX-06 — Local Memory with chat-level controls — Grade A

Codex separates checked-in guidance from local generated Memory, supports
chat-level use/contribute choices, redacts secrets and can exclude sessions that
used external context. Saber adopts per-conversation eligibility and delayed
background extraction, then adds visible provenance, confidence, conflict,
expiry, revocation, deletion propagation and promotion review.

### CDX-07 — Integrated review and terminal flow — Grade A

Codex treats terminal output, code review and produced files as reviewable
workspace artifacts. Saber keeps native Code-OSS editor, terminal, SCM and Diff,
but binds every Agent-authored change and claimed verification to Core Evidence
instead of treating presentation state as proof.

## Claude Code Desktop findings

### CLD-01 — User-composable pane lattice — Grade A

Claude Desktop lets users arrange chat, Diff, browser, terminal, file, plan,
task and subagent panes. Saber adopts named pane roles, drag/keyboard movement,
layout presets and task identity on every pane. It adds a Layout Receipt so a
restored pane cannot silently point at the wrong Workspace, Worktree or Run.

### CLD-02 — Live Preview and automatic interaction verification — Grade A

Claude can run dev servers, interact with an embedded page, inspect the DOM,
take screenshots and automatically verify changes. Saber adopts a Preview
Session with explicit server command, port, origin, cookie policy and action
trace. Auto-Verify produces evidence with assertions and artifacts; it cannot
declare success from a screenshot alone.

### CLD-03 — Side chat that does not derail the main session — Grade A

A Claude side chat can read the main session up to a point without writing back
to it. Saber implements Side Inquiry as a read-only fork pinned to an Event
Cursor. Its answer can be promoted only through an explicit, previewable context
or decision action with provenance.

### CLD-04 — Cross-session messages and suggested task chips — Grade A

Claude Desktop can attribute messages between sessions, apply inbound controls
and suggest out-of-scope work as a new session. Saber adopts provenance-bearing
Cross-Task Messages and a `Propose Task` object. The receiving Task applies its
own Policy and never treats another Agent's message as instruction authority.

### CLD-05 — Local, SSH and Cloud plus multi-repository remote work — Grade A

Claude exposes execution environment before a session and supports remote
long-running work. Saber adopts environment-specific capability cards and
multi-repository Goal graphs, but each repository receives a separate trust
cell, branch/Worktree, secret scope and integration review.

### CLD-06 — Inline Diff comments and PR monitoring — Grade A

Claude supports visual Diff review, inline comments and monitoring a PR through
CI. Saber adopts review comments as durable Task inputs and a PR lifecycle
projection. Auto-fix may prepare a candidate revision; merge and policy-changing
actions still require the configured human or enterprise Gate.

### CLD-07 — Desktop integrations and computer use — Grade A

Claude combines connectors, plugins and approved computer use with the coding
workspace. Saber exposes browser/computer operation as a high-risk Realm with
screen/action receipts, prompt-injection signals, application allowlists and an
immediate global stop. It is Armor, not implicit Core authority.

## ZCode Desktop findings

### ZCD-01 — Agentic Development Environment — Grade A

ZCode positions the Agent, task, context, permissions, terminal, file tree,
browser, Review and commit flow as one continuous environment. Saber adopts the
continuous workbench principle while retaining the full mature Code-OSS editor
surface for expert manual work.

### ZCD-02 — Persistent Goal with verification after every round — Grade A

ZCode Goal Mode stores one objective, verifies completion after each round,
continues when evidence is insufficient, supports pause/resume/clear and stops
on a usage budget. Saber adopts this as a Core Goal Supervisor. The verifier is
independent of the producing Agent, evaluates frozen Acceptance and records why
it continued, completed, paused, escalated or exhausted budget.

### ZCD-03 — Task views, search, archive and repository wiki — Grade A

ZCode organizes tasks by custom group, workspace or timeline and keeps file and
repository understanding nearby. Saber adopts saved Task views and a generated
Repository Map, but derived documentation is labeled with source revision and
staleness instead of appearing authoritative.

### ZCD-04 — Browser automation against actual page state — Grade A

ZCode's browser Agent clicks, types, takes screenshots and verifies front-end
changes while treating page text as data rather than instructions. Saber adopts
the visible action stream, DOM/a11y assertions and injection boundary. Imported
login state is opt-in, origin-scoped, time-limited and revocable.

### ZCD-05 — Capability bundle and marketplace — Grade A

ZCode plugins can bundle skills, commands, subagents, MCP servers and hooks,
including custom marketplaces. Saber adopts a unified Capability Manifest and
Armor Rack, but requires signature/provenance, declared permissions, secret and
network scope, compatibility, isolated evaluation, revocation and rollback.

### ZCD-06 — Configurable foreground/background subagents — Grade A

ZCode subagents can have their own model, reasoning level, tools, prompt,
turn limit and project-guidance injection. Saber maps each Agent to a Task,
Realm, budget and capability set; foreground/background affects scheduling only
and never weakens policy or evidence.

### ZCD-07 — Remote development and phone control — Grade A

ZCode distinguishes where code executes from the phone surface controlling the
existing desktop session. Saber adopts the split: remote UI sends authenticated
intent to the existing Core; source and credentials remain in their Realm. The
phone cannot create broader authority than the desktop session owns.

### ZCD-08 — Project Memory separated from AGENTS.md — Grade A

ZCode distinguishes human-maintained, versioned project rules from locally
generated project Memory. Saber keeps this distinction and fixes the documented
control gap by making Memory browsable, attributable, editable through
supersession, clearable and testable before reuse by subagents.

### ZCD-09 — Multiple coding harnesses in one desktop — Grade B

ZCode documents a framework layer that can host its own Agent and selected CLI
coding agents. Saber adopts an `AgentHarnessAdapter` contract for Codex, Claude
Code, ZCode-compatible exports, MiniMax-compatible exports and future agents.
Adapters normalize session events and artifacts but cannot bypass Core Policy,
and feature gaps must remain visible rather than being faked.

## MiniMax Code Desktop findings

### MMX-01 — Complexity-aware solo or team execution — Grade B

MiniMax describes sending simple work to one Agent and dynamically assembling a
team for complex work. Saber adopts an explainable Team Value Decision using
dependency width, domain diversity, uncertainty, risk, expected verification
cost and budget. The user can force solo, request team or cap team size.

### MMX-02 — Leader/Worker/Verifier adversarial loop — Grade A

MiniMax's engineering description uses Leader, Worker and Verifier roles and a
state machine that returns failed verification to production. Saber adopts the
pattern as runtime state, with verifier independence, immutable Acceptance,
bounded retries, escalation and human sign-off for high-risk completion.

### MMX-03 — Responsive lead during asynchronous work — Grade A

MiniMax keeps a lead responsive while background roles work and reports
started, blocked, decision-needed and done states. Saber adopts a Conversation
Control Plane separate from worker contexts, so steering never corrupts the
running Task and status is derived from Events rather than model narration.

### MMX-04 — Memory and generated Skills as evolution — Grade B

MiniMax presents experience as Memory and reusable Skills. Saber extends the
idea into a governed Evolution Ladder: observation → Memory candidate → rule or
workflow → Skill → strategy → isolated Code Capsule → reviewed Core change.
Every promotion has evaluation, canary, last-known-good and rollback.

### MMX-05 — Long-running state outside model context — Grade A

MiniMax's engineering post argues that task state, event logs, artifacts and
decisions must be persisted as recoverable objects. This matches Saber's
Continuity Spine and strengthens the requirement that compaction or provider
replacement cannot erase Goal truth.

### MMX-06 — Context-efficient team communication — Grade A

MiniMax uses readable handoff artifacts, direct Agent messages and a pull-based
shared bulletin board to limit context duplication. Saber adopts Artifact
References, bounded message envelopes and a Knowledge Board whose entries carry
source, audience, sensitivity, expiry and invalidation state.

### MMX-07 — Coding Harness roles and external evidence — Grade A

MiniMax separates Developer, Tester and Reviewer, with tests, static checks,
security review and replayable artifacts. Saber formalizes role separation in
Goal DAG policy: a producer cannot be the sole signer of its own completion and
the evidence-producing command must execute in the recorded Realm.

### MMX-08 — Cross-device, cross-application execution — Grade B

MiniMax describes issuing work from a phone and operating local desktop apps.
Saber adopts Remote Dispatch and Computer Realm as optional Armor. All actions
need device identity, visible session ownership, application/origin allowlists,
screen/action receipts and emergency containment.

## Saber capability decisions

| Decision ID | Saber capability | Inputs | Primary Segments | Non-negotiable delta |
|---|---|---|---|---|
| SAB-C01 | Environment-aware Conversation and safe Handoff | CDX-02, CLD-05 | S27, S32, S33 | Resumption Capsule and drift proof |
| SAB-C02 | Cross-Agent Import and Harness Adapter Layer | CDX-03, ZCD-09 | S27, S29, S33 | raw/canonical/derived lineage; no authority inheritance |
| SAB-C03 | Composable Pane Lattice and Side Inquiry | CLD-01, CLD-03 | S28, S29 | task identity, cursor pinning, explicit promotion |
| SAB-C04 | Preview Session and Auto-Verify | CLD-02, ZCD-04 | S28, S31, S37 | DOM/a11y/action receipts; screenshot not enough |
| SAB-C05 | Persistent Goal Supervisor | ZCD-02 | S30 | independent verifier, frozen acceptance, budget stop |
| SAB-C06 | Cross-Task Collaboration Surface | CLD-04, MMX-03 | S30, S32 | provenance and receiving-task policy |
| SAB-C07 | Complexity-aware Agent Team Runtime | ZCD-06, MMX-01, MMX-02 | S32 | Realm/Worktree isolation and adversarial verification |
| SAB-C08 | Knowledge Board and efficient handoffs | MMX-05, MMX-06 | S32, S33 | bounded, typed, attributable, invalidatable artifacts |
| SAB-C09 | Governed Memory-to-Evolution Ladder | CDX-06, ZCD-08, MMX-04 | S33, S34 | browse/revoke/eval/canary/rollback |
| SAB-C10 | Capability Bundle and Armor Rack | CLD-07, ZCD-05 | S34, S35 | signature, manifest, isolation and revocation |
| SAB-C11 | Automation Inbox and Goal Heartbeats | CDX-04 | S30, S34 | explicit run type, Realm, budget and stop rule |
| SAB-C12 | Remote Dispatch and Computer Realm | CLD-07, ZCD-07, MMX-08 | S34, S35, S37 | device-bound intent and immediate containment |
| SAB-C13 | Review/PR lifecycle with evidence | CDX-07, CLD-06, MMX-07 | S31, S38 | candidate auto-fix; protected merge remains human/policy gated |

## Anti-copy rules

- Do not clone competitor navigation labels, proprietary artwork, prompts or
  hidden implementation details.
- Do not claim feature parity from screenshots or official marketing copy.
- Do not equate a large context window with durable memory or continuity.
- Do not equate several parallel chats with a governed Agent Team.
- Do not let imported setup silently install plugins, copy credentials or run
  hooks.
- Do not let Side Inquiry, browser content, cross-session messages or generated
  Memory become instruction authority.
- Do not expose a `Full Access` shortcut without exact Realm, duration, resource
  and revocation semantics.

## Official sources

Codex / OpenAI documentation:

- <https://learn.chatgpt.com/docs/app>
- <https://learn.chatgpt.com/docs/environments/git-worktrees>
- <https://learn.chatgpt.com/docs/import>
- <https://learn.chatgpt.com/docs/customization/memories>
- <https://learn.chatgpt.com/docs/app-server>
- <https://learn.chatgpt.com/docs/automations>

Claude Code documentation:

- <https://code.claude.com/docs/en/desktop>

ZCode documentation:

- <https://zcode.z.ai/en/docs/agents>
- <https://zcode.z.ai/en/docs/goal>
- <https://zcode.z.ai/en/docs/task-management>
- <https://zcode.z.ai/en/docs/browser-use>
- <https://zcode.z.ai/en/docs/plugin>
- <https://zcode.z.ai/en/docs/subagents>
- <https://zcode.z.ai/en/docs/remote-control>
- <https://zcode.z.ai/en/docs/remote-development>

MiniMax official product and engineering material:

- <https://agent.minimax.io/download>
- <https://agent.minimax.io/docs/techblog/agent-team>
- <https://www.minimax.io/blog/minimax-m3>
