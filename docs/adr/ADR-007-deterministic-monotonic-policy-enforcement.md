# ADR-007 — Deterministic Monotonic Policy Enforcement

Status: accepted
Date: 2026-08-26
Deciders: repository owner and S05 architecture review

## Context

Models, prompts, project files, skills, plugins and external agents are useful intent sources but are not trustworthy authorization boundaries. A vague permission string, UI consent alone, or independent rules at several scopes can accidentally create ambient authority. Approval also creates a time-of-check/time-of-use risk if the approved action, resource or content changes before execution.

## Decision

Use a typed Rust Policy Decision Point and Policy Enforcement Point above every side-effect broker. Freeze a closed action vocabulary and per-action resource scheme, risk, persistence, sandbox, secret, network and approval metadata in a canonical versioned registry. Do not define a universal `system.all` action and do not treat project content as a policy authority tier.

Evaluate platform-hard, regulatory, organization, workspace, user and task-grant bundles in authority order. Any matching deny wins; absence of an explicit permit is deny. Lower tiers may add restrictions but cannot cancel a higher restriction. Bundle sequence rollback, same-sequence replacement and silent tier removal fail closed.

Bind approval grants to authenticated principal, exact action/request digest, canonical resource selector, operation/content hash, task, scope, TTL and revocation/replay state. Critical and non-persistable actions are once-only. A PEP records a metadata-only policy decision in the encrypted append-only event store before invoking an effect, and records the enforcement result afterward for recovery. PDP, approval or audit unavailability prevents execution.

## Consequences

- Tool and plugin manifests must use the canonical action/resource types rather than free-text permissions.
- Approval is a bounded authorization input, not a substitute for sandbox, secret or egress isolation.
- Request producers must compute an exact operation hash and use broker credential references rather than raw secrets.
- A successful effect followed by audit-result failure remains an explicit reconciliation case for the durable outbox.
- UI can explain stable reason and rule IDs without persisting raw paths, principal text, credentials or user justification.

## Rejected alternatives

- Prompt or repository-file permissions: untrusted content could grant itself authority.
- First-match or last-match policy evaluation: ordering mistakes could weaken a higher deny.
- Blanket “allow everything” approval: authority is neither minimal nor safely replayable.
- Approval without operation hashing: content can change after the user reviews it.
- Logging complete policy inputs: paths, identities, justifications and credential references can leak sensitive data.

## Verification

- Closed-vocabulary/schema parity and resource traversal/prefix-confusion tests.
- Default-deny, monotonic deny precedence, bundle rollback and unavailable-PDP tests.
- Approval scope, TTL, replay, revocation, vague-choice and TOCTOU tests.
- Audit-before-effect, audit-unavailable and redaction tests.
- SQLCipher event-store migration, transactional decision/enforcement persistence and hash-chain tests.
- Requirements: FR-RUN-004 and SEC-POL-001 through SEC-POL-005.
