# S33 Runbook — Continuity and Knowledge

Status: planned

Release train: RT-2 Collaborative Continuity Beta

Duration: 12-15 working days

Owners: Data/Knowledge Lead (A), Import/Retrieval/Runtime Engineers (R), Privacy
Engineer and Knowledge Curator (R), SDET (R)

Risk: critical

## Outcome

Users can import authorized external CodingAgent conversations, inspect lineage,
resume against current repository reality and curate searchable long-term
knowledge without source laundering, recall loops or uncontrolled cloud
plaintext.

## Competitive-derived requirements

- `CDX-03`, `ZCD-03`, `ZCD-09`: ship versioned adapters and fixtures for supported
  Codex/Claude/ZCode/MiniMax exports; unsupported fields remain visible.
- `CDX-02`, `MMX-05`: Handoff and resume use a signed Resumption Capsule plus
  repository, toolchain, policy, Realm and artifact drift report.
- `CDX-06`, `ZCD-08`, `MMX-04`: Memory is separate from versioned rules and is browsable,
  attributable, conflict-aware, expiring, revocable and forgettable.
- `MMX-06`: Knowledge Board entries are typed references pulled on demand,
  never an unbounded shared prompt copied to every Agent.

## Work packages

### S33-WP01 — Import Wizard and consent

- Source picker labels official export, API, local artifact and manual upload.
- Show requested files, expected data classes, local/cloud processing and
  retention before consent.
- Validate size, media, schema, parser version and malicious attachment content.
- Import is resumable and idempotent; cancellation leaves no half-authoritative
  records.

### S33-WP02 — Lineage browser

- Raw encrypted object, Canonical events, Derived summary/chunks and Lineage
  edges are separately visible.
- Show parser/version/digest and recompute status.
- Unsupported or ambiguous content remains untrusted; user can inspect and map
  without automatic Memory promotion.
- Deleting Raw data invalidates or deletes dependents according to policy.

### S33-WP03 — Resumption Capsule

- Capture source Goal/Task/decision/artifact, repository origin, commit, branch,
  dirty hash, dependencies, toolchain, policy, model and time.
- Revalidate as unchanged, diverged, missing or unknown.
- Require user choice for ambiguous repository/branch identity.
- Continue creates new events linked to source; it never rewrites the imported
  conversation.

### S33-WP04 — Retrieval and Context integration

- Hybrid lexical/symbol/vector retrieval with rerank and per-source budget.
- Respect trust, sensitivity, workspace, user/team scope, TTL and revocation.
- Every returned fragment carries a Context Receipt.
- Evaluate precision, stale rate, duplicate rate and false provenance.

### S33-WP05 — Memory ledger

- Types: episodic, curated, prospective and review candidate.
- Actions: propose, edit, promote, reject, supersede, expire, revoke, forget and
  redact; every action uses expected revision.
- Display conflicts and scope inheritance; Workspace policy wins without secret
  last-write-wins.
- Recall output cannot become new Memory without independent evidence.

### S33-WP06 — Privacy, sync and deletion

- Local encryption and OS credential storage are mandatory.
- Client-key E2EE sync sends ciphertext and minimal allowed metadata.
- Explain that server-side plaintext search is unavailable in strict E2EE mode.
- Test device removal, key rotation, export, account deletion, legal hold and
  derived-data deletion propagation.

## Verification

```sh
node scripts/verify-s33.mjs
pnpm desktop:test:import-lineage
pnpm desktop:test:resume-drift
pnpm desktop:test:memory-ledger
pnpm desktop:test:deletion-e2ee
pnpm desktop:eval:memory
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- At least two authorized source formats import idempotently and recompute.
- Diverged environments are detected before continuation.
- Untrusted imported text never auto-promotes to Memory.
- Revocation and deletion remove future recall according to a verified graph.
- Memory precision reaches the S33 threshold on the fixed evaluation set.
