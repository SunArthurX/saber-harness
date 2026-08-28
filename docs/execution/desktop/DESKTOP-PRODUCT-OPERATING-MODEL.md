# Saber Studio Desktop Product Operating Model

Version: 1.0

Status: S25 product contract; implementation starts only after protected S25
merge.

## Why this document exists

The enterprise plan explains architecture and sequence, the capability research
explains external inputs, and the Segment runbooks explain delivery. This file
freezes the product objects, lifecycle ownership and release cut lines that join
those layers together. A later model must not invent a second object model or
call a shell, mock or supervisor page a desktop CodingAgent product.

## Product promise

Saber Studio Desktop is a local-first CodingAgent IDE in which a developer can
understand, change, verify and review a real repository while every model,
context fragment, tool effect, external capability, learned behavior and repair
remains attributable, bounded and recoverable.

The user should experience one coherent collaborator. Internally the system is
many explicitly governed organs:

- the LLM reasons but does not own truth or effects;
- context and conversation provide perception and language;
- tools and Realms provide bounded action;
- Goal, Plan and Event state provide circulation and continuity;
- Health, containment and repair provide an immune system;
- Armor extends ability from outside;
- Memory, Skill and reviewed code evolution strengthen ability from within.

## Canonical product objects

| Object | Meaning | Authority | Durable identity | Primary UI | Forbidden shortcut |
|---|---|---|---|---|---|
| Workspace | trusted project boundary over one or more repositories | Core | yes | Workbench/title/Project tree | folder path alone is not identity |
| Repository | source-control root and integration boundary | Core + Git truth | yes | Explorer/SCM/Realm inspector | imported chat cannot select it silently |
| Goal | user-owned objective, acceptance, constraints and budget | Core | yes | Goal/Plan | chat title is not a Goal |
| Task | bounded unit in a Goal DAG | Core | yes | Task tree/Team runtime | Agent message cannot spawn it silently |
| Conversation | ordered human/Agent exchange and structured references | Core event log | yes | Conversation/Side Inquiry | transcript is not execution truth |
| Plan | versioned proposal for Tasks, effects and verification | Core | yes | Goal/Plan Diff | Agent cannot mutate frozen acceptance |
| Run | one execution attempt bound to Plan, Realm and policy snapshot | Core | yes | Timeline/Vital Bar | Renderer state cannot create/complete it |
| Realm | execution and data boundary such as Local, Worktree, SSH or Cloud | Policy + Core | yes | Realm inspector | environment label cannot imply permission |
| Worktree | isolated Git working state for a Task/Run | Core + Git truth | yes | SCM/Realm inspector | pane path cannot rebind it |
| Context Receipt | exact outbound context with source, reason and destination | Core | yes | Context Preview/Evidence | token count alone is not disclosure |
| Approval | exact, expiring human/policy decision over an effect | Core | yes | Approval Card | generic Full Access is not a scope |
| Change Set | baseline-bound file and Hunk delta | Core + Git digest | yes | Diff/Changes | editor decoration is not evidence |
| Evidence | attributable observation supporting or refuting acceptance | Core | yes | Evidence drawer/Receipt | model assertion cannot create pass |
| Memory | governed, recallable derived knowledge | Knowledge ledger | yes | Memory Ledger | hidden prompt text is not Memory |
| Capability | installable model/tool/skill/plugin/adapter contract | Capability registry | yes | Armor Rack | installed means neither trusted nor enabled |
| Evolution Candidate | proposed Memory/Skill/Strategy/Code/Core improvement | Evolution ledger | yes | Evolution Workshop | self-edit cannot self-promote |
| Incident | detected health, policy or integrity degradation | Health Supervisor | yes | Health Center/Vital Bar | symptom dismissal is not recovery |

Identifiers survive display-name changes. Every authoritative event names the
Workspace, Goal, Task, Run and Realm that exist for that action; absent objects
are explicit `null`, never inferred from the focused pane.

## Ownership and projection rules

1. Core is the writer for authoritative lifecycle state. Desktop, Web and
   remote clients are resumable projections over durable cursors.
2. Git and the filesystem remain source truth for repository state. Core binds
   snapshots and digests; it does not replace Git semantics.
3. Agent Host may propose Plan, Task, tool intent, Memory and evolution, but
   cannot grant approval, alter Policy, sign release artifacts or erase audit.
4. Renderer owns only local presentation state and unsent drafts. Restoring a
   layout never restores authority.
5. Indexes, summaries and repository maps are rebuildable derived data with a
   visible source revision.
6. External harness adapters preserve their source identity and capability
   gaps. Normalization cannot fabricate unsupported provenance or events.

## Lifecycle contracts

### Goal and Task

```text
Goal: Draft → Accepted → Active ↔ Paused → Verifying → Completed
                               ↘ Blocked / Cancelled

Task: Proposed → Ready → Running → Verifying → Integrated → Done
                    ↘ Waiting / Blocked / Failed / Cancelled
```

- `Completed` requires reconciliation against the accepted Acceptance revision.
- Reopening creates a new Goal revision/event; history is not rewritten.
- A Task enters `Ready` only when dependencies, Realm, capability, budget and
  acceptance are resolvable.
- `Blocked` names an external condition and owner; it is not a synonym for model
  uncertainty or an expired UI request.

### Run and control

```text
Created → Starting → Running ↔ Paused → Verifying → Succeeded
              ↘ WaitingApproval ↘ Revising ↘ Failed / Cancelled / Contained
```

- Steer, pause, cancel, resume and fork are idempotent control events.
- Disconnect changes client presence, not Run state.
- `Succeeded` describes execution outcome; Goal completion is a separate
  verifier decision.
- `Contained` wins over Agent control and records revoked capabilities,
  preserved evidence and the human recovery path.

### Approval and Evidence

```text
Approval: Pending → Narrowed / AllowedOnce / AllowedUntil / Denied
                    ↘ Expired / Revoked / Superseded

Evidence: Expected → Collecting → Observed → Reconciled
                              ↘ Missing / Invalidated / Inconclusive
```

- An Approval binds subject, operation, resource, expected revision, Realm,
  expiry and idempotency key.
- A later or broader effect requires a new Approval.
- Evidence is immutable after observation; correction appends invalidation and
  replacement links.
- `Inconclusive` is a valid result and can never be rendered as passed.

### Knowledge, evolution and health

```text
Observation → MemoryCandidate → ActiveMemory → PromotionCandidate
      → Evaluating → Canary → Promoted → Superseded / RolledBack

Detected → Contained → Diagnosing → Repairing → Verifying → Recovered
                    ↘ SafeMode / HumanEscalation
```

- A Memory candidate can be rejected, expire, conflict or be forgotten without
  becoming a capability.
- Promotion risk increases from Memory to Workflow, Skill, Strategy, isolated
  Code Capsule and Core change. Review and rollback strength increases with it.
- Health may autonomously take pre-authorized containment and last-known-good
  recovery actions. It cannot widen authority or silently discard evidence.

## Navigation and command grammar

The default hierarchy is:

```text
Workspace
└── Goal
    ├── Task
    │   ├── Conversation
    │   ├── Run
    │   ├── Change Set
    │   └── Evidence
    └── Goal-level Decisions and Integrations
```

Global surfaces—Knowledge, Armor, Evolution, Health and Admin—always show their
current Workspace/organization scope. A user can move among panes without
changing the selected Task. Changing Task or Realm requires a visible identity
transition, and a risky pending draft is revalidated before send.

Commands use `verb + object + visible scope`, for example `Pause Run`, `Narrow
Approval to tests`, `Promote answer to Task context`, `Hand off to Worktree` and
`Contain Computer Realm`. Ambiguous `Continue`, `Fix` or `Allow` actions are not
product commands.

## Release cut lines

The authoritative machine-readable companion is
`desktop-product-release-trains.json`.

| Train | Segments | Product label | User promise | Distribution |
|---|---|---|---|---|
| RT-0 Foundation Preview | S26-S29 | engineering preview, not MVP | packaged shell, supervised Core transport, real workbench and explainable conversation/context | internal engineers only |
| RT-1 Governed Coding Alpha | S30-S31 | first desktop CodingAgent MVP | real repository Goal can run, change, test, review, roll back and complete only from Evidence | named internal alpha users |
| RT-2 Collaborative Continuity Beta | S32-S34 | local-first beta | isolated Agent teams, cross-agent continuity, knowledge, Armor, evolution and immune recovery | consented design partners |
| RT-3 Enterprise Production Candidate | S35-S38 | production candidate | enterprise control, signed packaging/update, platform/security Gates and production evidence | bounded enterprise rollout |

### MVP cut line

Saber Studio Desktop does not become a real CodingAgent MVP until RT-1 exits
S31. RT-0 may demonstrate a genuine packaged desktop and real Core projection,
but it cannot execute and review the governed coding loop and therefore must not
be marketed as a complete desktop Agent.

RT-1 MVP must prove DJ-01 through DJ-04 and DJ-18 on a real repository. It may
defer teams, imports, long-term Memory, evolution, enterprise administration and
remote computer control, but it may not defer effect authority, exact Approval,
Diff review, independent Evidence, crash recovery or rollback.

### Beta and production cut lines

- RT-2 cannot be called Beta until multi-Agent isolation, import lineage,
  Memory governance, capability revocation, evolution rollback and health
  containment are exercised together on design-partner-shaped repositories.
- RT-3 cannot be called production-ready until signed installers and updates,
  enterprise isolation, supported-platform SLOs, incident response and fixed
  design-partner acceptance all pass on the same reviewed SHA.

## Scope priority

### P0 — cannot ship the applicable train without it

- Core-owned object identities and event recovery;
- real Code-OSS editor, SCM, terminal, test and Diff integration;
- exact context disclosure, Approval and effect mediation;
- evidence-based completion, rollback and containment;
- supported-platform packaging, accessibility and secret/privacy controls.

### P1 — differentiates Saber once the governed loop is real

- safe cross-harness import and Handoff;
- Side Inquiry and composable panes;
- persistent Goal rounds and independent Verifier;
- complexity-aware Agent Team and Knowledge Board;
- visible, reversible Memory-to-Code evolution;
- installable Armor with manifest, isolation and revocation.

### P2 — valuable after boundary evidence exists

- remote phone control and general computer use;
- broad marketplace and community publishing;
- cloud collaboration requiring server-side plaintext;
- autonomous PR repair beyond candidate preparation;
- organization-wide learned behavior promotion.

P2 can be researched and represented in architecture but cannot displace P0 or
P1 Exit Gates.

## Recovery decision table

| Failure | Automatic local action | User-visible state | Human decision |
|---|---|---|---|
| Renderer crash | restart projection from cursor | restoring, then exact Task/Run identity | report if replay differs |
| Core crash | stop new effects, preserve journal, bounded restart | Run disconnected/contained | retry, Safe Mode or support bundle |
| Realm/Worktree drift | block stale effect and recompute Diff | drift card with changed resources | accept new baseline, fork or cancel |
| Model/provider outage | keep Goal truth, stop provider-bound work | waiting with retry/budget impact | reroute model or pause |
| Tool/plugin crash loop | revoke instance and quarantine capability | Armor unhealthy + incident receipt | restore LKG, disable or investigate |
| Secret/injection signal | deny egress/input authority and contain Realm | urgent incident with redacted evidence | narrow/revoke/terminate and rotate if needed |
| Update/migration failure | roll back binary and data version when safe | Update Center blocked/rolled back | remain on LKG or export support bundle |
| Sync conflict | retain both ciphertext-backed versions | conflict, never silent overwrite | choose/supersede or keep local-only |

## Product telemetry and privacy contract

- Product health uses typed events and aggregate timings, not raw prompts,
  transcripts, source files, terminal bodies, secrets or screenshots by default.
- Optional diagnostic capture is previewed and redacted before export.
- Every metric names its product question, owner, retention and deletion path.
- Offline/local-model mode remains functional without telemetry or cloud sync.
- Feature success is measured by verified task outcomes, intervention quality,
  recovery and trust comprehension—not message count or autonomous tool volume.

## Change control

Changes to canonical objects, terminal states, release cut lines or the MVP
definition require an ADR or an entry in `docs/execution/DECISIONS.md`, updated
machine-readable release trains, updated journeys and an expanded verifier.
Removing a Gate because implementation is difficult is not a scope reduction;
it is a product-boundary change requiring explicit review.
