# S29 Runbook — Conversation and Context

Status: planned

Duration: 10-15 working days

Owners: Agent UX Lead (A), Frontend and Context Engineers (R), Privacy/Security
Engineer (R), Accessibility Engineer and SDET (C/R)

Risk: high

## Outcome

Users can hold a streaming, resumable desktop Agent conversation and know
exactly which files, symbols, artifacts, prior conversations, skills and
attachments will be sent to which model and why. Exclude and revoke actions are
effective Core intents, not visual decorations.

## Work packages

### S29-WP01 — Message model and rendering

- Render User, Agent Summary, Question, Decision Proposal, Approval Request,
  Tool Summary, Artifact, Checkpoint, Incident and System Notice distinctly.
- Stream append-only observable output with reconnect deduplication; never
  expose hidden chain-of-thought.
- Collapse tool detail by default while preserving Evidence navigation.
- Support copy with redaction markers, citation navigation and message retry
  that creates a new causal event rather than rewriting history.

### S29-WP02 — Composer state machine

- States: empty, drafting, resolving references, attachment scanning, context
  over budget, DLP blocked, offline queued, ready, sending and failed.
- `@` resolves file/symbol/artifact, `#` resolves Goal/Run/conversation,
  `/` resolves command/workflow and `$` resolves governed capability.
- `+` attachments pass media, size, malware and sensitivity checks.
- Queue and Steer are separate explicit operations with visible insertion
  boundary.

### S29-WP03 — Context Preview and Receipt

For each fragment show source ID, source type, revision/hash, selection reason,
trust, sensitivity, token estimate, transformation/redaction, destination
provider and retention policy. The preview total reconciles with the request
receipt after send.

### S29-WP04 — Model, Realm and autonomy selectors

- Display provider, model, local/cloud status, context limit, price class and
  policy eligibility.
- Realm selection shows local/SSH/container/cloud boundary and data egress.
- Autonomy selection maps to closed capabilities; “Full Access” cannot bypass
  Core policy.
- Budget selector covers token, money, wall time and tool calls.

### S29-WP05 — Privacy controls

- Exclude removes a fragment before provider dispatch and creates evidence.
- Revoke affects future retrieval and follows Memory/derived deletion policy;
  it cannot falsely claim deletion from an already contacted provider.
- Secret and sensitive-data canaries never reach model fixtures.
- Local drafts are encrypted or stored only in approved profile storage and
  excluded from crash dumps.

### S29-WP06 — Accessibility and failure behavior

- Streaming announcements are rate-limited and summarized for screen readers.
- Context chips expose name, source and removal action by keyboard.
- Provider timeout, partial stream, offline transition, reference drift and
  attachment rejection retain the user draft and explain recovery.

## Verification

```sh
node scripts/verify-s29.mjs
pnpm desktop:test:conversation
pnpm desktop:test:context-receipts
pnpm desktop:test:redaction-canary
pnpm desktop:test:a11y --journey conversation
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- Preview and sent receipt reconcile for every provider request.
- Excluded content and secret canaries are absent from provider fixtures.
- Provenance survives streaming reconnect and conversation restart.
- Model/Realm/autonomy/budget choices are visible and policy-bound.
- Composer is fully operable with keyboard and screen reader.
