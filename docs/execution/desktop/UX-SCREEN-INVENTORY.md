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
