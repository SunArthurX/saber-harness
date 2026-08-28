# Advanced CodingAgent and Harness Research

Version: 1.0

Research date: 2026-08-28

Status: official-source planning input; capability availability is not a Saber
implementation claim

## Scope and method

This second research layer complements the Codex Desktop, Claude Code Desktop,
ZCode and MiniMax study. It focuses on architecture and product mechanics that
are especially relevant to a local desktop CodingAgent:

- provider-neutral harness composition;
- durable event history and continuation;
- parallel work isolation and recovery;
- specification, planning, hooks and reflexes;
- runtime/sandbox boundaries;
- repository-context quality;
- evidence-producing edit/test loops.

Only official product documentation and official repositories are used for an
evidence grade. Grade A means the capability is stated in a first-party source.
Grade B means the first-party source exists but the current product behavior is
volatile, incomplete or requires implementation-time revalidation. Marketing
language is translated into a Saber-specific contract rather than copied.

Every record in `advanced-harness-capability-map.json` maps the finding to a
philosophy invariant, Segment, UI and journey. The implementing Segment must
recheck the linked source, terms, version and actual behavior because these
products change independently of this repository.

## Cursor findings

Official sources:

- [Agent overview](https://cursor.com/docs/agent/overview)
- [Rules](https://docs.cursor.com/context/rules)
- [Memories](https://docs.cursor.com/en/context/memories)
- [Checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints)
- [Background agents](https://docs.cursor.com/background-agent)

The current official Agent overview describes tool-using Agents, checkpoints,
queued or immediate steering, long-lived Goals and browser interaction.
Checkpoints are local Agent-change snapshots rather than a replacement for Git.
Background agents run asynchronously in remote environments and support status,
follow-up and takeover. Rules provide scoped instruction context. Official
Memory documentation describes project-scoped extraction with review, but this
area is sufficiently volatile that Saber treats CUR-03 as Grade B and requires
fresh validation before implementation.

### CUR-01 — Goal and steering

Useful idea: a user can establish a longer-lived objective and steer work while
the Agent is active.

Saber contract: Goal is a Core object, not a special prompt. A Steer event names
whether it queues after the current effect, interrupts before the next effect or
requests cancellation. The Timeline shows which Plan revision consumed it.

### CUR-02 — Checkpoints distinct from Git

Useful idea: fast local recovery for Agent-produced edits.

Saber contract: a checkpoint records event cursor, repository revision, dirty
manual paths, Agent-owned changes, Realm and rollback feasibility. Restore is a
previewed Change Set operation. It cannot overwrite manual edits merely because
they occurred after the Agent snapshot.

### CUR-03 — Rules and reviewed Memory

Useful idea: persistent context can be scoped and inspected rather than hidden
inside every prompt.

Saber contract: Rule and Memory are separate schemas. Rule inclusion is
deterministic; Memory is evidence-derived, conflict-aware, expiring and
forgettable. Neither may outrank organization Policy or repository instructions.

### CUR-04 — Remote background Agent

Useful idea: asynchronous work should stay observable and support takeover.

Saber contract: a Remote Run names device/image, repository revision, Realm,
egress, secret grants, budget and retention. Takeover is an ownership transfer
event with current effect, uncertain state and evidence cursor, not merely an
interactive terminal attachment.

### CUR-05 — Browser verification

Useful idea: the Agent verifies the actual product surface, not only source and
tests.

Saber contract: browser content is an untrusted sensory input. Every automated
interaction records target, source revision, taint, action, observation and
evidence. A screenshot alone does not prove functional or accessibility success.

### CUR-06 — Agent composition

Useful idea: the effective Agent is the composition of instructions, tools and
model behavior.

Saber contract: an Agent Profile is versioned and capability-negotiated. Policy,
effect authority and evidence remain outside the profile in the trusted Core.

## DeepSeek Harness findings

Official sources:

- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [Events](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/events.md)
- [Subsystem index](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/README.md)
- [Core subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)

DeepSeek Harness documents a Cordis plugin framework in which providers publish
services, consumers depend on service contracts, typed events coordinate work
and plugin effects can be reversed when the plugin unloads. Profiles compose
plugin trees from bundles. Its core Session is an append-only event log; the
model-visible history is derived from that log and must be reconstructable.
Filesystem, subprocess, terminal and LSP services can share an execution world,
and sandbox, extensions, Skills and compaction are subsystem seams.

This is the strongest architecture reference in this comparison for modular
harness construction. Saber adopts its explicit service seams, profile
composition, reversible effects and reconstructable session principle. Saber
does not adopt “no privileged core” as a security principle: its Rust immune
Core remains deliberately privileged over Agent, plugin, Renderer and model.

### DSH-01 — Reversible plugin effects

Every listener, service registration, timer and derived projection installed by
an Armor plugin must have deterministic teardown. Unload is verified, not
assumed, and must not leave an invisible hook or credential alive.

### DSH-02 — Capability seams

Provider replacement occurs at an explicit service contract. Saber adds signed
or attested provider identity, dependency graph, policy classification and a UI
for missing/degraded capabilities.

### DSH-03 — Reconstructable model history

Every input visible to a model is reproducible from authorized source records,
canonical Core events and a versioned Context assembly algorithm. Summaries and
provider-format messages are projections with lineage, not the source of truth.

### DSH-04 — Profiles and bundles

A product/profile is a declarative capability composition. It cannot inherit
undeclared network, filesystem, secret or approval power from a bundled plugin.

### DSH-05 — Execution-world identity

Shell, PTY, filesystem and LSP observations must refer to the same attested
Realm. A local LSP result cannot be presented as evidence for a remote filesystem
mutation without an explicit cross-Realm reconciliation.

### DSH-06 — Typed durable IDs and events

Goal, Task, Run, Realm, Tool Call, Approval and Evidence identifiers are distinct
types. Durable state changes use a versioned taxonomy with migration and replay
tests; ephemeral UI events cannot become authoritative by being persisted.

### DSH-07 — Replaceable subsystems with a trusted root

Compaction, Skills, extensions and runtime providers are replaceable. Policy,
Sandbox health, Secret/Egress decisions, Audit integrity, Update verification
and Recovery roots fail closed and are not replaceable by the active Agent.

## Zed findings

Official sources:

- [Agents](https://zed.dev/docs/ai/agents)
- [External agents](https://zed.dev/docs/ai/external-agents)
- [Parallel agents](https://zed.dev/docs/ai/parallel-agents)
- [Agent Client Protocol](https://zed.dev/acp)
- [Agent panel](https://zed.dev/docs/ai/agent-panel)
- [MCP](https://zed.dev/docs/ai/mcp)

Zed supports its native Agent, external Agents over ACP and terminal threads.
With external Agents, runtime, authentication, model, tools and configuration
remain owned by the external Agent while Zed hosts the interaction. Parallel
Agent threads can use Worktrees; thread history is associated with worktree Git
state. The Agent panel exposes token usage and compaction/continuation behavior.

### ZED-01/ZED-02 — Multiple paths and ACP

Saber should be a body capable of hosting more than one brain. ACP is a useful
interoperability seam, but normalization must preserve source Agent identity,
configuration ownership, authentication boundary, capability gaps and raw
provenance.

### ZED-03/ZED-04 — Parallel threads and Worktrees

The desktop sidebar should make parallel tasks legible without collapsing them
into one transcript. Restoring a thread must also verify the associated Git and
Worktree state, including manual drift and conflicts.

### ZED-05 — Context budget and compaction

Users need visible token/budget pressure and a compaction receipt that names
source events, omissions, summary lineage and the continuation cursor. The
summary is not permitted to silently invent a new Goal or approval.

### ZED-06 — Per-thread Agent choice

Changing the selected Agent or model is a continuity transition. Pending Plans,
approvals and assumptions are revalidated against its actual capabilities.

## Kiro findings

Official sources:

- [Documentation index](https://kiro.dev/docs/)
- [How Kiro works](https://kiro.dev/docs/how-kiro-works/)
- [IDE](https://kiro.dev/docs/ide/)
- [Hooks](https://kiro.dev/docs/hooks/)
- [Steering](https://kiro.dev/docs/steering/)

Kiro documents specification-driven development, steering, event-driven hooks,
MCP, permissions, custom Agents, Skills, powers, subagents, checkpoints, rewind
and compaction. Its IDE, CLI and Web surfaces share an Agent harness and project
configuration. Hooks may run a command or Agent prompt at defined lifecycle
events; some pre-action hooks can block.

### KIR-01 — Requirements → design → tasks

Saber adopts a Specification object linked to Goal acceptance, Task DAG, tests
and evidence. Natural-language documents are editable projections; their typed
requirements and trace links are authoritative. A task cannot be marked done if
its requirement revision or evidence is stale.

### KIR-02 — Hooks as reflex arcs

Hooks are pre-authorized reflexes, not autonomous immune authority. Each Hook
declares trigger, read/write set, deterministic budget, recursion guard, failure
policy, blocking semantics, owner and revocation. A hook cannot grant a new
capability or silently convert Plan into Act.

### KIR-03 — Shared harness across surfaces

Desktop, CLI and optional Web Supervisor project the same Core protocol and
repository configuration. This avoids divergent policy or memory behavior while
preserving the Desktop as the primary product selected by ADR-028.

### KIR-04 — Scoped steering

Persistent steering needs scope and inclusion modes, but Saber also exposes
precedence, source revision, conflicts, taint and whether it is a rule, Memory
or organization Policy.

### KIR-05 — Checkpoint, rewind and compaction

Saber separates four recovery dimensions: code, canonical events, context
projection and external effects. Rewind may restore one dimension only after
showing the consequences and current drift.

## OpenHands findings

Official sources:

- [Architecture](https://github.com/OpenHands/OpenHands/blob/main/docs/architecture.md)
- [Runtime architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime)
- [Official repository](https://github.com/OpenHands/OpenHands)

OpenHands documents an AgentController and State over an EventStream of Actions
and Observations, with a Runtime/Sandbox executing actions. Its Agent Canvas is
a projection rather than the execution or credential boundary, and the system
can use multiple Agent Server or automation backends. The Runtime documentation
emphasizes isolation and reproducibility through a client-server boundary.

### OHD-01 — Action/Observation EventStream

Saber uses the Action/Observation distinction as part of its causal Timeline,
but adds Core policy verdict, expected revision, effect uncertainty and Evidence
reconciliation.

### OHD-02 — Runtime boundary

The Runtime is a separately supervised Realm. Authentication, action schema,
resource ceilings, mounts, network and secret grants are explicit. Host-direct
execution is never the enterprise product default merely because it is easier
to debug.

### OHD-03 — UI as projection

The Code-OSS Renderer may crash, reload or be compromised without acquiring the
Runtime credential or changing authoritative Run state. Reconnection starts
from a Core cursor and exposes any gap.

### OHD-04/OHD-05 — Backends and reproducible images

Multiple backends retain one Goal identity and evidence grammar. Runtime images
pin toolchain/dependency provenance and are rebuilt/tested across supported
platform and enterprise constraints.

## Cline findings

Official sources:

- [Plan and Act](https://docs.cline.bot/core-workflows/plan-and-act)
- [IDE usage](https://docs.cline.bot/usage/ide)

Cline distinguishes Plan Mode, which gathers and discusses information without
effectful commands or writes, from Act Mode, which can execute while retaining
the conversation context. Its workflow also exposes approval and checkpoint
concepts.

### CLN-01/CLN-02 — Effect boundary and deep planning

Saber treats Plan/Act as a Core-enforced capability transition. Plan may use
approved read-only probes to reduce uncertainty, but cannot mutate files,
processes, network systems or durable knowledge. Act entry binds an accepted
Plan, Context Receipt, risk/budget and current revisions.

### CLN-03 — Pre-effect checkpoint

A checkpoint is created before the first mutation and whenever the rollback
domain changes. It does not falsely promise rollback for irreversible external
effects; those require preview, explicit approval and reconciliation.

## Aider findings

Official sources:

- [Repository map](https://aider.chat/docs/repomap.html)
- [Lint and test](https://aider.chat/docs/usage/lint-test.html)
- [Git integration](https://aider.chat/docs/git.html)
- [Modes](https://aider.chat/docs/usage/modes.html)
- [Commands](https://aider.chat/docs/usage/commands.html)

Aider describes a token-budgeted repository map built with Tree-sitter and
graph ranking, architect/editor model separation, Git-aware undo/commit behavior
and automatic lint/test loops after edits.

### AID-01 — Repository map

Saber's Repository Map is a derived, revision-labelled sensory projection. It
shows coverage, ranking reason, excluded areas, token budget, staleness and a
rebuild path. Its output cannot override source ACL or prove that omitted code
is irrelevant.

### AID-02 — Architect/editor separation

Planner, Producer and Verifier are distinct roles even when one provider fills
more than one role. The verifier consumes frozen acceptance and independent
observations; it does not accept the producer's self-reported success as proof.

### AID-03 — Git-aware recovery

Saber adopts change ownership and safe undo, but not unconditional automatic
commit. A Change Set distinguishes baseline dirty state, manual edits, Agent
edits and integrated edits. Commit occurs only through the Segment/project
policy and evidence Gate.

### AID-04 — Lint/test repair loop

Automatic repair is bounded by unchanged acceptance, retry and regression
budgets. Failing outputs remain visible Evidence. The loop stops on repeated
failure, broader-than-approved change, flaky/inconclusive verification or
budget exhaustion.

## Cross-product architecture decisions

### AH-01 — Privileged immune Core with modular Armor

Use DeepSeek Harness-style service seams and reversible effects for the Agent
Host and Armor Rack. Keep Saber's Rust Policy/Sandbox/Secret/Egress/Audit/
Update/Recovery roots deliberately outside the replaceable plugin graph.

### AH-02 — Canonical append-only causal journal

Combine DeepSeek Harness session reconstruction and OpenHands
Action/Observation separation. Persist Core-owned typed events; derive provider
messages, UI Timeline and model context from authorized sources and versioned
projection algorithms.

### AH-03 — Capability negotiation before normalization

Use an ACP-compatible adapter seam where useful. A normalized UI displays
source provider, configuration/auth owner, supported/unsupported/degraded
capabilities, semantic differences and trust class.

### AH-04 — Specification and Goal are connected, not conflated

Kiro-style requirements/design/tasks become traceable Specification artifacts
inside the Goal. Goal retains authority and lifecycle; documents remain
reviewable projections with revision and evidence links.

### AH-05 — Reflexes are narrow Hooks

Kiro-style hooks implement predictable spinal reflexes. They are deterministic,
budgeted, recursion-safe, reviewable and revocable. Immune containment remains
Core-owned and can disable all hooks.

### AH-06 — Four-dimensional checkpoint

Combine Cursor, Zed, Kiro, Cline and Aider recovery ideas. Checkpoint and rewind
separately model repository changes, canonical events, derived context and
external effects while preserving manual drift.

### AH-07 — One execution-world identity

Filesystem, shell, PTY, LSP, preview/browser and test observations bind to a
single Realm/revision tuple or expose the reconciliation between tuples.

### AH-08 — Visible context economics

Combine Zed token visibility and Aider repository-map budgeting. Context Receipt
shows sources, ranking/selection, omissions, taint, compaction lineage, model
limits, estimated cost and actual consumption.

### AH-09 — Parallelism without authority laundering

Use Zed/Cursor/OpenHands parallel execution patterns under one Goal DAG. Each
Run has its own Worktree/Realm, principal, capabilities, budget and Evidence;
cross-Task communication is attributed and re-evaluated by the receiver.

### AH-10 — Proof-producing repair loop

Combine Aider automatic verification with producer/verifier separation. Lint,
test, build, browser and security evidence are independent observations. The
system can report passed, failed or inconclusive; it cannot rename incomplete
evidence to passed.

## New UX implications

The second-layer research adds seven planned surfaces:

- UI-36 Capability and Agent Adapter Inspector;
- UI-37 Reflex and Hook Manager;
- UI-38 Runtime/Sandbox Image Inspector;
- UI-39 Causal Timeline and Trajectory Replay;
- UI-40 Specification Studio;
- UI-41 Repository Map and Context Budget;
- UI-42 Recovery and Homeostasis Center.

These are desktop workbench surfaces, not a separate Web administration
product. UI-39 and UI-42 may have read-only Web Supervisor projections, but
authoritative action still goes through Core.

## New acceptance implications

- DJ-25 switches Agent/model/harness while preserving Goal identity and showing
  gaps.
- DJ-26 restores a checkpoint while preserving unrelated manual drift.
- DJ-27 reconstructs model-visible context and UI state from canonical events.
- DJ-28 fires, blocks, disables and unloads a Reflex Hook without widening
  authority or leaving residue.
- DJ-29 reproduces an attested Runtime Realm and proves filesystem/shell/LSP/
  test identity.
- DJ-30 moves Specification from requirements to design, tasks, effects and
  independent evidence.
- DJ-31 compacts a long context with visible lineage, omissions and budget.
- DJ-32 corrupts and rebuilds Repository Map/index projections without losing
  canonical records.

The philosophy-specific PJ-01 through PJ-12 in
`PHILOSOPHY-TO-ARCHITECTURE.md` cover authority, immune response, evolution,
encrypted continuity and global Stop/forgetting.

## Anti-copy rules

- Do not copy product terminology where Saber already has a canonical object.
- Do not assume an Agent-controlled plugin microkernel is a safe Policy root.
- Do not treat checkpoint/rewind as a promise to reverse arbitrary external
  effects.
- Do not make Plan/Act a UI-only toggle.
- Do not import another harness's raw transcript as canonical state.
- Do not auto-commit user work merely because a reference product does.
- Do not store hidden chain-of-thought to imitate an inspectable trajectory.
- Do not equate remote background execution with unattended full access.
- Do not turn repository map, summary, embedding or Memory into source truth.
- Do not call a generated prompt, Skill or code patch “evolution” without
  baseline, selection evidence and rollback.
