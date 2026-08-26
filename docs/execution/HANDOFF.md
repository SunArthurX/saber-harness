# S05 Handoff

Status: in progress
Date: 2026-08-26
Branch: `segment/S05-policy`
Base: `s04-complete` / `a3b32280ce953ae1d5523ede1a5c1d6d77e3ec63`

## Objective

Freeze a shared capability vocabulary and implement the deterministic Rust Policy Decision Point, Policy Enforcement Point, scoped approvals and redacted durable decision audit required before any side effect.

## Implemented locally

- Added canonical capability schema and registry covering filesystem, process, network, secret, browser, Git, cloud, external service, plugin, capability publication and self-change actions. Each action declares one resource scheme, risk, persistence, sandbox, secret, network and approval behavior; there is no `system.all` capability.
- Added the independent Rust `saber-policy` crate. Resource identifiers reject scheme confusion, traversal, encoded-dot ambiguity, whitespace, control characters, query/fragment suffixes and prefix-boundary confusion, including after untrusted deserialization.
- Added typed principals, data classification, exact operation hashes and credential references. Raw credentials are not accepted as policy fields.
- Added platform-hard, regulatory, organization, workspace, user and task-grant tiers. Any matching deny wins, no permit means deny, project content is not a tier, and missing sandbox/credential preconditions fail closed.
- Added policy snapshot hashing and monotonic updates. Sequence rollback, changed content at the same sequence and removal of an established tier are rejected.
- Added approval requests/grants with exact request digest, no-broader resource selector, operation/content hash, once/task scope, bounded TTL, revocation and replay state. Non-persistable actions cannot receive task grants; blanket “allow everything” choices are rejected.
- Added an audit-before-effect PEP. PDP, approval or audit failure prevents the closure from running. A one-shot approval is consumed only after the decision is durably recorded.
- Added metadata-only `PolicyDecisionAudit`: principal, resource, context and request are hashed; credential references, raw paths and user reasons are excluded.
- Migrated the SQLCipher event store to schema v3 with transactional `policy.decision_recorded` and `policy.enforcement_recorded` facts, idempotent exact replay, conflict denial and append-only hash-chain coverage.

## Current evidence

- Strict workspace clippy and all Rust tests pass: 11 policy adversarial tests, 17 encrypted event-store tests and 6 protocol tests.
- Tests prove closed vocabulary/registry/Schema parity, traversal rejection after deserialization, default deny, monotonic deny precedence, policy rollback denial, PDP/audit fail-closed, scope/TTL/TOCTOU/replay/revocation, irrelevant-grant non-consumption, vague-approval denial and redaction.
- The SQLCipher integration test proves decision metadata is persisted before effect, enforcement result is recorded afterward, sensitive resource text is absent and both events remain hash-chain valid.
- FR-RUN-004 and SEC-POL-001 through SEC-POL-005 are `implemented-local`; S06 remains responsible for production sandbox, secret broker and egress enforcement.
- ADR-007 and DEC-0009 record the authorization and persistence boundary.

## Non-negotiable review points

- Models, prompts, skills, plugins, project files and approval UI are intent/consent sources, never enforcement authorities.
- Lower policy tiers cannot cancel a deny from any higher tier; no match, invalid input and unavailable policy all deny.
- Approval is not isolation. A valid grant never bypasses required sandbox, secret broker or later egress controls.
- Persisted audit contains metadata and hashes only; sensitive paths, identities, reasons, credentials and content remain outside the audit row/event.
- An effect cannot run before its decision is durable. A trailing enforcement-audit failure is surfaced for S04 outbox reconciliation.

## Next action

1. Run the complete local S00-S05, Rust, TypeScript, governance, license and formatting Gate.
2. Commit and push explicit S05 paths, then require all hosted checks on that exact SHA.
3. Merge through protected main, run a clean-clone acceptance drill, write the atomic completion record and tag only after all evidence is green.
