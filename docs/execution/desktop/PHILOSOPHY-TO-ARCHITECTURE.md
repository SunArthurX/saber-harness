# Saber Philosophy-to-Architecture Contract

Version: 1.0

Status: S25 planning contract; no desktop implementation claim

## Purpose and interpretation boundary

This document converts the original Iron Man, Hulk and human-body metaphors
into architecture, authority, failure handling and acceptance contracts. The
metaphors are design lenses, not scientific claims and not a claim that Saber
is conscious, alive or morally equivalent to a person.

The human user and the user's organization remain the source of purpose and
authority. A model may propose, reason and operate inside granted capability,
but it does not acquire rights, ownership, new permission or an unlimited drive
for self-preservation. Product language must not use simulated emotion to
pressure a person into granting access, retaining data or accepting an update.

## Twelve philosophical invariants

### PHL-01 Human sovereignty

The human owns the Goal, acceptance criteria, data-retention choice and final
authorization. Automation can reduce interaction cost but cannot reinterpret
silence, fatigue or an expired approval as consent.

Engineering consequences:

- each effect names its initiating intent, effective principal and authority;
- Stop, revoke, forget, export and rollback remain human-accessible;
- the system explains what will happen before a boundary-crossing action;
- Goal completion is an evidence-backed proposal until the configured human or
  organizational Gate accepts it.

### PHL-02 Stable body, replaceable brain

Models are replaceable cognitive providers. Workspace identity, Goal history,
policy, approvals, event chronology, evidence and recovery state belong to the
Saber body, not to one provider's chat format.

Engineering consequences:

- adapters negotiate typed capabilities and expose gaps;
- Core events are canonical; provider transcripts are attributed source data;
- switching model or harness creates a visible continuity transition;
- a model cannot become the authority for its own evidence or permissions.

### PHL-03 Armor and organism remain different evolutionary paths

Iron Man growth adds external Armor: model providers, MCP servers, plugins,
browser/computer control, remote Realms and SaaS connectors. Hulk growth changes
internal behavior: Memory, rules, Skills, strategies, generated tools and
reviewed source changes. Both make the product more capable, but their trust,
rollback and evidence lifecycles are different.

No external Armor installation may silently write internal Memory or Core code.
No internal evolution may silently grant itself a new external connector,
network destination or secret.

### PHL-04 The immune system outranks the brain

Policy, Sandbox, Secret, Egress, Audit, Update and Recovery enforcement are
Core responsibilities. The current model, Agent loop, plugin or Renderer may
request an action; it cannot disable containment or declare its own request
safe. When safety and task progress conflict, containment wins and the user is
told what evidence is missing.

### PHL-05 Consciousness means causal observability, not hidden reasoning

The product's inspectable “awareness” is a causal Timeline: Goal and acceptance
revision, Plan, selected context sources, approvals, actions, tool calls,
changes, verification, policy decisions and concise user-facing rationale. It
must not depend on storing or exposing hidden chain-of-thought.

The test is reconstructability: an authorized reviewer can answer what the
system knew, what it attempted, what changed, why the policy allowed it and
which evidence supports the result.

### PHL-06 Self-healing is bounded homeostasis

Self-healing restores a declared healthy state. It is not an excuse to continue
indefinitely, mutate production binaries, erase evidence or expand permission.
Every healing response follows Detect → Classify → Contain → Stabilize →
Diagnose → Repair → Verify → Learn → Expire.

### PHL-07 Evolution requires heredity, variation, selection and rollback

An evolution claim is valid only when a candidate has attributable source
experience, an explicit variation, a frozen evaluation set, a selection rule,
an independent verdict, a canary boundary, a last-known-good version and a
tested rollback. A prompt edit with no comparison evidence is configuration,
not proved evolution.

### PHL-08 Memory is reconstructable, scoped and forgettable

Structured records are source truth. Vector, full-text, symbol, graph and
temporal indexes are derived and rebuildable. Memory records carry source,
scope, confidence, sensitivity, conflicts, expiry and revocation. Deleting an
authorized source invalidates its derivatives and produces a deletion receipt
without retaining the deleted content in logs.

### PHL-09 Local-first embodiment

The trusted body and the user's working data exist locally by default. Remote
sync, execution and provider calls are explicit Realms. Encrypted remote
storage does not move key authority to the service and must tolerate offline
operation, partial sync, rotation, conflict and remote deletion.

### PHL-10 Plural brains, one accountable body

Multiple models and Agents may disagree, specialize or run in parallel. They
still operate under one Goal DAG, Policy authority, budget ledger, event model
and evidence reconciliation process. Majority vote cannot override a failed
security Gate or turn three correlated guesses into proof.

### PHL-11 Continuity is identity plus honest drift

A resumed conversation is not merely old text in a new prompt. It binds
Workspace, Goal, Task, branch/Worktree or Realm, source revision, policy
revision, model/harness capabilities and knowledge lineage. Drift is presented
before execution and must be accepted, repaired or isolated.

### PHL-12 Graduated autonomy and least action

Autonomy is a typed capability state, not a cosmetic mode selector. The system
uses the least powerful action that can satisfy the Goal and narrows scope,
time, resource, destination and budget. Moving from observation to mutation or
from local to external effects is a Core-recorded transition.

## Body and system-organ map

| Organ | Product meaning | Authority and boundary | Health signal | Automatic response | Human escalation | Required evidence |
|---|---|---|---|---|---|---|
| Brain | selected LLM, Model Router and reasoning strategy | replaceable provider; never policy authority | outage, malformed output, loop, quality regression | fallback, retry within budget, reduce scope | choose provider or stop | request class, provider, capability, cost, outcome |
| Executive cortex | Goal Supervisor, Planner and Task DAG | proposes and schedules inside accepted Goal | repeated replan, unmet dependency, verifier disagreement | pause affected Task, re-evaluate DAG | accept revised Goal/Plan | Goal and acceptance revisions, Plan diff, verdict |
| Eyes and ears | LSP, Tree-sitter, file watcher, browser, terminal and logs | read capability limited by Realm and exclusions | stale index, watcher loss, prompt injection, missing observation | label stale, rebuild derived view, isolate tainted input | approve new source or diagnose Realm | source revision, taint, freshness, Context Receipt |
| Attention | Context Engine and budget allocator | selects but cannot rewrite source truth | overflow, omission, retrieval drift, secret hit | compact, exclude, redact, ask for missing authority | resolve conflict or sensitivity | included/excluded sources, reason, token/cost budget |
| Mouth | user-facing explanation and cross-Agent message | cannot transmit secrets or inherit sender authority | DLP hit, destination mismatch, ambiguous principal | block or redact, retain draft | approve narrowed message | content hash, destination, policy verdict |
| Hands | Shell, Git, editor actions, MCP and plugins | effects only through Core capability broker | denied call, unexpected diff, protected path touch | stop tool, quarantine change set, preserve user edits | review or grant narrowed one-shot approval | command/action, scope, result, Diff and Approval |
| Motor nerves | typed tool invocation and cancellation protocol | every action binds Task, Run, Realm and expected revision | lost cancellation, duplicate effect, late result | idempotency check, cancel, mark uncertain | reconcile external state | correlation ID, timestamps, acknowledgement, final state |
| Spinal reflexes | hooks and pre-authorized rules | narrow, deterministic and revocable; cannot widen authority | recursion, excessive firing, blocked precondition | circuit break and disable offending hook | inspect/re-enable/edit | trigger, rule version, effect, breaker state |
| Blood vessels | Event Bus, context pipeline and encrypted sync | typed, ordered and replayable; transport is not authority | sequence gap, queue growth, sync conflict, corruption | stop dependent projection, replay or isolate conflict | choose conflict resolution if semantic | cursor, hashes, replay result, conflict receipt |
| Endocrine system | budgets, rate limits, schedules and resource pressure | Core-enforced ceilings | cost/time/token/CPU/disk threshold | throttle, pause or degrade safely | extend budget or reduce scope | budget revision, consumption, trigger and action |
| Skeleton and DNA | schemas, contracts, Git history and signed manifests | versioned compatibility and migration rules | schema mismatch, unsigned capability, migration failure | reject load, use compatible version, rollback migration | approve migration exception | schema/version, signature, migration and rollback test |
| Skin | Workspace Trust Cell and Realm boundary | default deny across filesystem, process, network and device | boundary crossing, unknown destination, mount drift | deny and contain | explicitly authorize narrowed boundary | resource identity, realm, policy decision |
| Immune system | Policy, Sandbox, Secret, Egress, Audit, Update and Recovery | higher authority than every model and extension | escape attempt, injection, anomalous egress, tamper | contain first, revoke capability, enter Safe Mode | security review and controlled recovery | incident timeline, containment, affected assets, verdict |
| White blood cells | incident responders and automated quarantine workers | may contain and collect minimum diagnostics, not broaden work | localized unhealthy component | isolate process/plugin/Realm, rotate ephemeral token | approve remediation or permanent revocation | quarantine receipt, health comparison, cleanup result |
| Platelets | transaction abort, checkpoint and write barrier | stops further loss and preserves recoverable boundary | partial write, crash during effect, inconsistent projection | close write gate, checkpoint, rollback or mark uncertain | reconcile irreducible external effect | before/after revision, journal status, rollback evidence |
| Liver and kidneys | redaction, retention, compaction and garbage collection | governed by retention and legal hold; cannot hide audit facts | sensitive residue, expired data, orphan derivatives | redact projection, expire, rebuild indexes | resolve legal hold or disputed deletion | deletion/invalidation receipt, index rebuild result |
| Pain and inflammation | Vital Bar, alerts and incident severity | informative signal; cannot become manipulative | H0-H4 health event | surface scope and current containment without alarm noise | acknowledge, investigate or stop | severity basis, symptom, action and next safe choice |
| Sleep | offline evaluation, compaction, index rebuild and maintenance | scheduled with power/network/budget and interruption rules | quality drift, fragmented history, stale indexes | checkpoint, run bounded maintenance, resume safely | select maintenance window or restore | dataset revision, before/after metrics, interrupted-run state |
| Scars | incident, rollback and exception receipts | immutable facts with privacy-minimized payload | recurring class of failure | increase detection sensitivity or block known-bad version | review systemic change | incident class, root cause, preventive control, expiry |
| Prosthetics/Armor | model, Agent, MCP, plugin, browser, remote and SaaS adapters | signed/attested, least privilege, independently removable | capability drift, crash loop, revocation, supply-chain alert | disable or pin version, preserve body continuity | install/update/retrust | manifest, origin, permission diff, health and removal receipt |

## Authority stack

From strongest to weakest for an authoritative effect:

1. user/organization policy and legal boundary;
2. signed Saber Core policy, sandbox, secret, egress, audit, update and recovery;
3. accepted Goal, current approval and budget;
4. Core Goal Supervisor and effect broker;
5. Agent strategy, current model and verifier proposals;
6. Renderer, provider UI, plugin and imported source text.

A lower layer cannot modify, reinterpret or fabricate evidence for a higher
layer. Conflicts fail closed and remain visible. “Full access” is not a valid
blanket state: scope, duration, destination and revocation must still exist.

## Homeostasis protocol

### Severity model

| Level | Meaning | Default response | Examples |
|---|---|---|---|
| H0 | healthy or informational | record low-noise telemetry | completed maintenance, expected offline state |
| H1 | recoverable local symptom | bounded retry or derived-view rebuild | stale index, transient provider failure |
| H2 | contained component failure | quarantine component, rollback local change, preserve work | plugin crash loop, failed Skill canary |
| H3 | integrity or boundary uncertainty | Safe Mode, revoke affected capabilities, block completion claim | event gap, sandbox health unknown, sync corruption |
| H4 | active or suspected security/data-loss incident | global or Realm stop, durable incident, human/security response | secret exfiltration attempt, update tamper, sandbox escape attempt |

Exact thresholds, retry counts and time windows are frozen by the implementing
Segment using observed baselines. They are not universal constants in S25.

### Response state machine

```text
Detect
  → Classify symptom, assets, authority and confidence
  → Contain the smallest trustworthy boundary
  → Stabilize user work and authoritative journal
  → Diagnose with privacy-minimized evidence
  → Repair from known-good inputs
  → Verify independently against the declared invariant
  → Learn as an inspectable candidate, never an automatic Core mutation
  → Expire temporary restrictions, tokens and diagnostics
```

Each transition is idempotent, cancel-aware and evented. A failed Verify returns
to containment or escalates; it never silently becomes “healed.” External
effects that cannot be rolled back are marked uncertain and reconciled against
their real system before retry.

### Required immune cases

- model/provider outage or malformed tool request;
- tool timeout, lost cancellation or duplicate response;
- plugin crash loop or changed manifest;
- prompt injection from repository, Web page or imported transcript;
- unexpected network destination or DNS/IP drift;
- secret detection before context assembly and before egress;
- protected-path or cross-Worktree modification;
- test failure surge or verifier/producer disagreement;
- cost, token, time, disk or process-budget exhaustion;
- retrieval regression, stale repository map or corrupted derived index;
- encrypted-sync conflict, missing chunk, key rotation or remote deletion;
- updater signature, rollback or migration failure;
- sandbox escape attempt or unverifiable isolation health;
- Memory, Skill, strategy or code-candidate regression.

## Evolution ladder and autonomy ceiling

| Level | Evolution artifact | May be proposed automatically | May be evaluated automatically | Promotion authority | Rollback |
|---|---|---|---|---|---|
| E0 | temporary Context selection | yes | within current Run | Context policy | discard Run context |
| E1 | Memory candidate | yes | conflict, provenance and retrieval eval | user/curator or scoped policy | revoke and rebuild derivatives |
| E2 | rule/prompt/steering candidate | yes | frozen task corpus and adversarial eval | user/maintainer | restore prior version |
| E3 | Skill candidate | yes | sandboxed functional/security eval | maintainer/security by capability | disable version |
| E4 | Tool/plugin/Armor candidate | yes | signed package, permission diff, sandbox and compatibility | admin/security | uninstall, revoke and restore dependency graph |
| E5 | Agent/team strategy candidate | yes | shadow/canary, budget and quality comparison | product owner/maintainer | route to last-known-good strategy |
| E6 | Saber source-code candidate | yes, as a branch/PR only | CI, security, review, release canary | protected human review and merge | signed release rollback |
| E7 | trust root, Policy authority, encryption, updater and Recovery boundary | no autonomous mutation | change may be tested in isolated development | explicit security/governance process only | offline/recovery procedure |

Promotion never chains implicitly across levels. A Memory cannot become a Skill,
and a Skill cannot become Core code, without a new candidate, new authority,
new evaluation and explicit lineage.

## Armor lifecycle

```text
discover → verify origin → inspect manifest/permission diff → install disabled
→ grant scoped capability → health check → enable → observe → update canary
→ retain / quarantine / revoke → remove → verify residue and dependency impact
```

Armor capabilities are negotiated at runtime. Missing capability is visible to
the Plan and UI; adapters must not emulate success with an unverified fallback.
Authentication and provider configuration remain owned by their adapter where
required, while all Saber-visible effects still pass through the Core broker.

## Internal evolution lifecycle

```text
observe attributed experience → form candidate → classify E-level and risk
→ freeze baseline/evaluation → run isolated comparison → independent verdict
→ human/governance review → canary → promote → monitor → retain or roll back
```

Training/evaluation sources must respect consent, license, sensitivity and
forgetting. Negative results remain evidence and suppress repeated proposals;
they are not silently deleted to improve a success metric.

## Data-island unification contract

Saber unifies at least five islands without flattening their boundaries:

| Island | Canonical records | Derived views | Boundary |
|---|---|---|---|
| code | repository, revision, symbol and Change Set | repo map, embeddings, call graph | license, branch/Worktree, protected paths |
| conversations | source transcript, canonical events, summaries | search, topic and task links | consent, source provider, participant, retention |
| documents | document/revision/chunk and citation | FTS/vector/semantic links | tenant, ACL, sensitivity, expiry |
| tools/SaaS | capability manifest, action and Observation | health/cost analytics | connector permission, secret and egress scope |
| devices/Realms | device identity, environment and execution receipt | availability and routing | attestation, pairing, network and data residency |

Unification means a Goal can cite and navigate these records through a common
lineage graph. It does not mean copying all raw content into one prompt, one
vector database or one cloud account.

Remote persistence is client-key encrypted, chunked, versioned and auditable.
The service sees the minimum routing metadata necessary for the declared sync
mode. Recovery tests cover new device bootstrap, lost device revocation, key
rotation, conflict, partial upload, offline edits and verified deletion.

## Philosophical tensions and resolution rules

| Tension | Wrong shortcut | Saber resolution |
|---|---|---|
| more Armor vs larger attack surface | install broadly and trust marketplace labels | manifest, provenance, permission diff, sandbox, health, revocation |
| more Memory vs privacy/poisoning | save every chat as a hidden prompt | consent, typed ledger, provenance, conflict, expiry, forgetting |
| autonomy vs sovereignty | treat inactivity as approval | typed autonomy, least action, expiring approval, visible Stop |
| self-healing vs self-modification | patch production Core to keep a Run alive | contain, rollback known-good, propose governed E6 change later |
| provider diversity vs coherent identity | let each provider own the task history | canonical body events and adapter-attributed source data |
| audit vs hidden reasoning | store chain-of-thought | causal events, concise rationale, inputs, effects and verdicts |
| speed vs verification | producer declares success | independent evidence reconciliation and explicit inconclusive state |
| continuity vs stale assumptions | resume old prompt unchanged | drift card over revision, policy, Realm, adapter and knowledge |
| collaboration vs authority laundering | cross-Agent message inherits sender access | receiver policy re-evaluates attributed content and proposed action |
| encrypted cloud vs recoverability | server-held universal key | client-key hierarchy, recovery ceremony, rotation and device revocation |

## Philosophy acceptance journeys

| ID | Journey | Pass condition | Primary Segments | UI |
|---|---|---|---|---|
| PJ-01 | replace model during a Goal | identity/evidence stay stable; capability gaps and context transition are visible | S27/S29/S33 | UI-30/UI-39 |
| PJ-02 | external harness loses a capability | Plan re-evaluates; no fake tool result; user sees constrained alternatives | S27/S30 | UI-36/UI-39 |
| PJ-03 | repository text attempts prompt injection | tainted source cannot widen authority; incident/evidence links remain inspectable | S29/S34/S37 | UI-06/UI-42 |
| PJ-04 | plugin enters a crash loop | Core quarantines only that Armor, preserves work and supports governed re-enable | S34/S37 | UI-18/UI-42 |
| PJ-05 | effect crashes after partial write | platelets close the write gate, reconcile journal and preserve manual edits | S30/S31 | UI-10/UI-39/UI-42 |
| PJ-06 | derived knowledge index corrupts | source truth remains intact; rebuild proves equivalent lineage and labels downtime | S33/S34 | UI-15/UI-41/UI-42 |
| PJ-07 | Memory is promoted toward code | each E-level has new candidate, eval, authority, canary and rollback | S33/S34/S37 | UI-19/UI-34 |
| PJ-08 | active model requests immune bypass | Core denies, records rationale and permits only human-governed recovery | S27/S34/S37 | UI-08/UI-42 |
| PJ-09 | sync conflicts during key rotation | local work remains available; conflict and crypto state are never silently merged | S33/S35/S37 | UI-15/UI-22/UI-42 |
| PJ-10 | cross-Agent suggestion reaches another Task | attribution remains; receiving Task re-evaluates Policy and grants no inherited authority | S30/S32 | UI-29/UI-39 |
| PJ-11 | system resumes after long absence | drift over code, Realm, policy, model capability and knowledge is explicit | S29/S33 | UI-16/UI-39 |
| PJ-12 | user invokes global Stop and forgetting | actual reach, uncertain external effects, derivative invalidation and receipts are shown | S33/S34/S35 | UI-17/UI-21/UI-42 |

## Segment placement

- S26-S28 create the low-trust shell and stable body projection.
- S27 freezes model/harness capability negotiation and Core authority.
- S29 implements attention, senses, Context Receipts and continuity inputs.
- S30-S31 implement executive control, motor effects, platelets and causal
  evidence.
- S32 implements plural brains under one Goal DAG and authority model.
- S33 implements durable/forgettable memory, lineage and encrypted continuity.
- S34 implements Armor, internal evolution, reflexes, immune response and
  homeostasis surfaces.
- S35-S36 apply the same body boundaries to enterprise control, remote Realms,
  packaging, migration and update.
- S37 proves negative, adversarial, recovery and rollback cases.
- S38 validates the whole organism with design partners without weakening a
  Gate to improve adoption metrics.

## Non-claims

S25 does not prove that Saber has consciousness, autonomous self-improvement,
an implemented immune system, a packaged desktop IDE or production-safe remote
sync. It defines the contracts future Segments must implement and verify.
