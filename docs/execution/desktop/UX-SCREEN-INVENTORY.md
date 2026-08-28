# Desktop UX Screen and State Inventory

## Global shell

| Region | Content | Persistent actions | Error behavior |
|---|---|---|---|
| Title bar | Workspace, branch/Worktree, Realm, model, autonomy, health | switch/reveal details | stale identity blocks risky action |
| Activity rail | Workbench, Command Center, Knowledge, Armor, Evolution, Health, Admin | switch view | unavailable enterprise views explain entitlement |
| Primary sidebar | project/Goal/Task/conversation trees | new, filter, pin, archive | retry and offline cache, never fake empty |
| Central Agent pane | Conversation and Plan | send, steer, edit plan | draft retained on failure |
| Editor group | Explorer/Editor/Diff/SCM/Preview | native Code-OSS operations | task identity remains visible |
| Bottom panel | Terminal, Tests, Problems, Output, Timeline | run/focus/filter | Realm/Run mismatch warns and blocks Agent input |
| Evidence drawer | context, approval, change, test, policy, artifacts | inspect/export | missing evidence means unknown, not passed |
| Vital Bar | run, queue, policy, sandbox, network, cost, health, sync | open details | severity escalates without animation noise |

## Screen inventory

| ID | Screen | Primary user | Required states | Segment |
|---|---|---|---|---|
| UI-01 | First-run walkthrough | all | welcome, open, clone, error, offline, complete | S26/S28 |
| UI-02 | Desktop Agent Workbench | developer | no repo, loading, ready, active Run, restored | S28 |
| UI-03 | Project/Goal/Task tree | developer/lead | empty, active, waiting, failed, archived, filtered | S28/S30 |
| UI-04 | Conversation | developer | empty, streaming, queued, partial, retry, offline | S29 |
| UI-05 | Composer | developer | draft, resolving, DLP block, budget block, sending | S29 |
| UI-06 | Context Preview/Receipt | developer/privacy | loading, ready, redacted, excluded, revoked, stale | S29 |
| UI-07 | Goal and Plan | developer/lead | draft, diff, accepted, running, replan, conflict | S30 |
| UI-08 | Approval Queue/Card | developer/reviewer | pending, narrowed, denied, allowed, expired, revoked | S30 |
| UI-09 | Runtime Timeline | developer/lead | live, filtered, disconnected, replaying, complete | S30 |
| UI-10 | Changes and Review | developer/reviewer | clean, changed, conflict, stale, applying, rolled back | S31 |
| UI-11 | Evidence Receipt | reviewer/auditor | incomplete, verifying, passed, failed, invalidated | S31 |
| UI-12 | Goal DAG/Agent Team | lead | planned, dispatching, parallel, blocked, integrating | S32 |
| UI-13 | Worktree/Realm inspector | developer/lead | healthy, dirty, stale, lost, quarantined | S32 |
| UI-14 | Import Wizard | developer/curator | consent, scanning, mapping, importing, partial, done | S33 |
| UI-15 | Lineage Browser | curator/auditor | raw, canonical, derived, invalidated, deleted | S33 |
| UI-16 | Continue/Drift Card | developer | unchanged, diverged, missing, unknown, accepted | S33 |
| UI-17 | Memory Ledger | curator | candidate, active, conflict, expired, revoked, forgotten | S33 |
| UI-18 | Armor Rack | developer/admin | available, installed, disabled, unhealthy, revoked | S34 |
| UI-19 | Evolution Workshop | curator/security | proposed, evaluating, failed, canary, accepted, rolled back | S34 |
| UI-20 | Health Center | developer/security | H0-H4, contained, repairing, verifying, safe mode | S34 |
| UI-21 | Command Center | lead | active, waiting, incident, review inbox, empty | S34 |
| UI-22 | Enterprise Admin | admin | unenrolled, loading, ready, permission denied, offline | S35 |
| UI-23 | Update Center | developer/admin | check, download, verify, install, rollback, blocked | S36 |
| UI-24 | Diagnostics/Support Bundle | support/user | collecting, redacting, review, export, failed | S34/S38 |
| UI-25 | Pane Layout Manager | developer | default, custom, compact, restored, incompatible, reset | S28 |
| UI-26 | Side Inquiry | developer/reviewer | cursor-pinned, asking, answered, stale, promote-preview, closed | S29 |
| UI-27 | Live Preview and Auto-Verify | developer/SDET | configuring, starting, interactive, verifying, failed, stopped | S28/S31/S37 |
| UI-28 | Goal Iteration Inspector | developer/lead | active round, verifying, continuing, paused, budget-exhausted, complete | S30 |
| UI-29 | Cross-Task Message and Task Proposal | developer/lead | proposed, attributed, accepted, refused, tainted, archived | S30/S32 |
| UI-30 | Harness Adapter and Import | developer/admin | detected, mapping, capability-gap, consent, connected, degraded | S29/S33 |
| UI-31 | Agent Team Runtime | lead/reviewer | solo-advised, team-proposed, producing, verifying, revising, escalated | S32 |
| UI-32 | Automation Inbox and Schedule Editor | developer/lead | draft, active, missed, waiting-approval, failed, paused, complete | S30/S34 |
| UI-33 | Remote Dispatch and Device Session | developer/admin | pairing, connected, stale, approval-needed, revoked, offline | S35 |
| UI-34 | Memory-to-Evolution Pipeline | curator/security | observed, candidate, conflicted, evaluating, canary, promoted, rolled-back | S33/S34 |
| UI-35 | Browser and Computer Realm | developer/security | disabled, requesting, active, injection-alert, contained, stopped | S34/S37 |
| UI-36 | Capability and Agent Adapter Inspector | developer/admin | detecting, negotiating, ready, capability-gap, degraded, revoked | S27/S29/S34 |
| UI-37 | Reflex and Hook Manager | developer/security | draft, simulated, enabled, blocked, circuit-broken, disabled, unloaded | S30/S34/S37 |
| UI-38 | Runtime/Sandbox Image Inspector | developer/security | unresolved, building, attesting, ready, drifted, quarantined, unavailable | S27/S30/S35/S37 |
| UI-39 | Causal Timeline and Trajectory Replay | developer/reviewer | live, filtered, reconstructing, gap, divergent, complete, exported | S27/S29/S30/S31 |
| UI-40 | Specification Studio | developer/product/reviewer | requirements, design, tasking, accepted, stale, conflicted, verified | S28/S30/S31/S38 |
| UI-41 | Repository Map and Context Budget | developer/curator | indexing, ready, partial, stale, budgeted, corrupt, rebuilding | S29/S33/S34 |
| UI-42 | Recovery and Homeostasis Center | developer/security/support | H0-H4, containing, stabilizing, repairing, verifying, safe-mode, escalated | S31/S34/S37 |

## Competitor-derived interaction contracts

### Product identity grammar

- The stable hierarchy is Workspace → Goal → Task → Conversation/Run/Change
  Set/Evidence. Focused Pane state never substitutes for object identity.
- Every authoritative action names Workspace, Goal, Task, Run and Realm; an
  absent object is visibly absent instead of inherited from the last screen.
- Switching Pane is presentation. Switching Task, Worktree or Realm is an
  identity transition with stale-draft and pending-approval revalidation.
- Global Knowledge, Armor, Evolution, Health and Admin surfaces show their
  current Workspace, team or organization scope before any mutation.

### Pane lattice

- Each Pane carries Workspace, Task, Run, Worktree/Realm and source-revision
  identity; hiding the header cannot hide a mismatch warning.
- Layout presets are `Focus`, `Build`, `Review`, `Team` and user-defined. A
  preset changes presentation only, never execution or permission state.
- Drag, keyboard move, split, close, restore and reset are equivalent actions
  with accessible announcements and deterministic persistence.

### Side Inquiry

- A Side Inquiry reads the main Conversation only through its pinned Event
  Cursor and cannot edit Plan, Memory, files or Goal state.
- `Promote` opens a preview showing the exact answer fragment, destination,
  reason, taint and resulting context budget before writing a new main-thread
  event.
- Closing or discarding the inquiry leaves no hidden context contribution.

### Preview and Auto-Verify

- The Preview header shows command, directory, port, origin, process owner,
  cookie profile, Realm and current revision.
- Agent actions appear as an ordered visible trace with selector/semantic target,
  screenshot/DOM reference, result and policy decision.
- Auto-Verify may produce `passed`, `failed` or `inconclusive`; only Evidence
  reconciliation can influence Goal completion.

### Goal and Agent Team

- The Goal Inspector separates producer output from verifier verdict and shows
  the unchanged Acceptance revision used for each round.
- Team proposal explains why solo or team was selected, role/task topology,
  expected time/token cost, parallelism, retry cap and human checkpoints.
- The lead remains responsive while workers run; its messages are control-plane
  events and do not mutate worker context unless an explicit Steer is accepted.

### Import, remote and automation

- Import presents source, detected item type, trust class, conflicts, redaction,
  destination and whether continuous synchronization is requested.
- Remote UI always names the executing device and Realm; disconnect never
  implies that execution stopped, and global Stop reports its actual reach.
- Schedule editing distinguishes an independent Automation Run from a Goal
  Heartbeat returning to existing context, including missed-run and overlap
  behavior.

### Adapter, causal replay and Runtime

- The Adapter Inspector names protocol, provider/configuration owner,
  authentication boundary, trust class and supported, unsupported or degraded
  capabilities before a Plan binds to it.
- Switching model, Agent or harness is an identity-preserving continuity event;
  pending assumptions and approvals are revalidated rather than copied.
- Causal replay shows canonical events separately from provider messages,
  summaries and UI projections. A sequence gap or projection divergence cannot
  be hidden by a visually complete transcript.
- Runtime Inspector binds filesystem, shell, PTY, LSP, preview/browser and test
  observations to one Realm, image and source-revision identity.

### Specification, reflex and repository attention

- Specification Studio links requirement revision → design decision → Task →
  Change Set → test/Evidence; stale evidence cannot close a changed requirement.
- Reflex Hook preview shows trigger, read/write set, budget, blocking behavior,
  recursion guard, owner and unload residue test. No Hook can grant itself a new
  capability.
- Repository Map labels revision, source coverage, ranking/selection reason,
  omissions, token budget and freshness. It is a rebuildable projection, not
  repository or access-control truth.
- Context compaction exposes source-event range, omitted categories, resulting
  budget and summary lineage before the next model call.

### Recovery and homeostasis

- Recovery separates repository changes, canonical events, derived context and
  external effects; the UI never promises one-click rollback for an irreversible
  or uncertain external action.
- Homeostasis follows Detect → Classify → Contain → Stabilize → Diagnose →
  Repair → Verify → Learn → Expire. Failed verification returns to containment
  or escalation, never to a green status.
- Manual edits and unowned changes are highlighted before checkpoint restore;
  safe recovery preserves them or asks for an explicit resolution.
- Safe Mode identifies the exact disabled capability set and remains controlled
  by Core and the human/security authority, not the active model.

## Action contract

Every action defines:

- action ID and visible label;
- required role and Core capability;
- selected Workspace/Task/Run/Realm/Worktree;
- exact resource and expected revision;
- whether it is local-only or authoritative;
- confirmation/approval and expiration;
- success, denial, partial and retry semantics;
- emitted event and Evidence navigation;
- keyboard binding and accessible name.

Generic `Allow`, `Continue`, `Fix`, `Retry` and `Full Access` labels are forbidden
when the affected resource or boundary is not visible.

## Empty/loading/error rules

- Empty names what is absent and gives the safest next action.
- Loading has an observable operation and cancellation when meaningful; no fake
  progress percentage.
- Partial data is labeled partial and never rendered as an empty authoritative
  list.
- Errors preserve user input and link to retry, rollback, details or support.
- Offline distinguishes locally available work from network-required work.
- Safe Mode explains disabled capabilities and the human-controlled exit path.

## Keyboard baseline

| Journey | Required keyboard path |
|---|---|
| Open repository | Command Palette → open/clone → confirm trust |
| Switch Task | focus Primary Sidebar → tree navigation → open |
| Send message | focus Composer → references → preview → send |
| Review approval | open queue → inspect sections → deny/narrow/allow once |
| Review Diff | file list → next/previous Hunk → comment/keep/reject |
| Open evidence | focused item → Evidence drawer → source navigation |
| Emergency stop | globally discoverable Stop; confirmation states impact |

Never override standard Code-OSS editor/terminal/navigation bindings without a
documented conflict review and platform alternative.

## Accessibility acceptance

- Landmarks and headings are stable across streaming updates.
- Focus does not jump when a new event arrives.
- Live regions aggregate events and announce urgent approval/incident only.
- Color is never the only status channel; icons have text alternatives.
- All resizers and tab/pane movement are keyboard operable.
- Tooltips are supplemental, never the only location for scope or risk.
- At 200% zoom the core journey has no horizontal page scroll outside code/Diff.
- High-contrast and reduced-motion behavior uses platform/Code-OSS settings.

Official UX basis:

- <https://code.visualstudio.com/api/ux-guidelines/overview>
- <https://code.visualstudio.com/api/ux-guidelines/views>
- <https://code.visualstudio.com/api/ux-guidelines/webviews>
