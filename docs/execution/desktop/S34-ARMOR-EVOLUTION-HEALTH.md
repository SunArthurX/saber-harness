# S34 Runbook — Armor, Evolution and Health

Status: planned

Release train: RT-2 Collaborative Continuity Beta

Duration: 12-15 working days

Owners: Capability/Evolution Lead (A), Plugin/Eval/Reliability Engineers (R),
Security Engineer and SDET (R)

Risk: critical

## Outcome

Users can distinguish external Armor from internal capability growth, review
every candidate's evidence and permission delta, canary or reject it and recover
to a last-known-good state. Health mechanisms contain faults before asking the
Agent brain for advice.

## Competitive-derived requirements

- `ZCD-05`, `CLD-07`: one signed Capability Manifest can describe Skill,
  command, Agent, MCP, hook or browser/computer adapter, but each component has
  separate permissions, isolation, health and revocation.
- `MMX-04`, `CDX-06`, `ZCD-08`: experience may propose Memory, Skill, workflow
  or Code Capsule through the Evolution Ladder; it never self-installs.
- `CDX-04`: Automation Inbox exposes independent Runs and Goal Heartbeats with
  schedule, overlap, missed-run, approval, budget and cleanup receipts.
- `MMX-08`, `ZCD-04`: Browser/Computer Realm is optional Armor with injection
  alerts, application/origin allowlists, action receipts and global Stop.

## Advanced harness and philosophy requirements

- `DSH-01`, `DSH-02`, `DSH-04`, `DSH-07`: Armor uses typed capability seams,
  signed profiles and reversible load/unload while immune roots stay privileged.
- `CUR-03`, `KIR-04`: Memory/Rule inputs to evolution remain distinct,
  attributable, scoped and revocable.
- `CUR-05`, `KIR-02`: Browser input is tainted sensory data and Hooks are
  narrow reflexes with simulation, recursion guards, circuit breakers and
  residue-free unload.
- Implement the E0-E7 ladder and H0-H4 homeostasis contract from
  `PHILOSOPHY-TO-ARCHITECTURE.md`; E6 is protected PR only and E7 never mutates
  autonomously.

## Work packages

### S34-WP01 — Armor Rack

- Unified cards for model, external Agent, MCP, plugin, browser and Realm.
- Show publisher, source digest, signer, version, runtime location, data scope,
  capabilities, secrets, egress, health, cost and uninstall impact.
- Install/update/enable grants no capability beyond reviewed Manifest.
- Revocation immediately removes authorization and marks dependent workflows.

### S34-WP02 — Evolution candidate intake

- Candidate sources: feedback, repeated correction, failed task, accepted
  workflow and benchmark opportunity.
- Select medium deliberately: Memory, rule, workflow, Skill, strategy, isolated
  Code Capsule or protected Core proposal.
- Show expected benefit, affected scopes, new permissions, training/eval data,
  owner, expiry and rollback.
- Duplicate, conflicting and source-poisoned candidates are blocked or grouped.

### S34-WP03 — Eval, canary and rollback

- Freeze baseline task set and last-known-good version.
- Candidate runs in isolated evaluation Realm with no production secret.
- Compare success, regression, safety, latency, cost and human correction.
- Canary has explicit cohort, duration, stop thresholds and owner.
- Rollback is available from UI and Core even if the candidate crashes.

### S34-WP04 — Vital Bar and Incident UX

- Signals: Core/provider/plugin crash loop, sandbox denial, secret/egress alarm,
  storage integrity, sync failure, update failure, budget and degraded model.
- Severity H0-H4 with detect, contain, repair, verify and escalate timestamps.
- Low severity is quiet; serious events display impact, automatic action,
  remaining risk and user choices.
- Support Bundle is metadata/redaction first and user-reviewed before export.

### S34-WP05 — Immune controls

- Supervisor can stop, quarantine, revoke, isolate, roll back and enter Safe Mode
  without model approval.
- Agent cannot suppress health events, edit their audit history or exit Safe
  Mode.
- Bound retry/circuit breaker to prevent inflammatory crash loops.
- External medicine means explicit human/admin/vendor authority with evidence.

### S34-WP06 — Game day

Inject plugin crash loop, poisoned candidate, sandbox escape signal, provider
misroute, corrupt index and bad update candidate. Prove bounded containment,
last-known-good recovery, preserved evidence and correct user escalation.

## Verification

```sh
node scripts/verify-s34.mjs
pnpm desktop:test:armor-rack
pnpm desktop:test:evolution-workshop
pnpm desktop:test:health-incidents
pnpm desktop:test:game-day
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- Armor and internal evolution are visually and structurally distinct.
- No candidate bypasses review, eval, canary or rollback requirements.
- Supervisor containment outranks Agent action.
- Game-day failures preserve evidence and return to last-known-good or Safe Mode.
