# ADR-023 — Multi-Tenant Enterprise Control

Status: accepted
Date: 2026-08-29
Deciders: repository owner and S21 architecture review

## Context

Enterprise deployment requires that one tenant can never observe or
affect another, that external IAM systems map into (not around) the
S05 policy boundary, and that emergency access is governed and
evidenced (TB-09, TM-13).

## Decision

### Tenant-qualified planes everywhere

Every plane key — policy, events, audit, budgets, sandboxes,
diagnostics, keys — is tenant-qualified. Cross-tenant access is
denied by construction: lookups carry the caller's tenant, and no API
accepts a bare key without one.

### IAM maps onto closed tiers, never raw privileges

External identities/roles expand deterministically (depth-bounded) into
the S05 principal kinds and typed rules of an organization policy
bundle. There is no mapping target outside the closed action +
selector vocabulary — an IdP admin claim cannot mint `system.all`.
Organization bundles ride the existing monotonic S05 engine; rollback
and same-sequence replacement remain refused.

### Break-glass is dual-controlled, time-boxed and loud

Elevation requires a requesting and an approving operator (distinct),
carries an expiry, is fully audited, auto-expires and cannot self-renew.
Every break-glass grant is enumerable at any moment.

### Audit separation with exportable evidence packs

Audit streams are tenant-partitioned and readable only within the
tenant context. Compliance evidence packs are metadata-only digests of
decisions and enforcement records — no plaintext, credentials or
transcripts ever leave in a pack.

## Consequences

- The enterprise plane adds governance around the core, not a second
  policy system.
- Break-glass exists precisely so nobody needs a backdoor.
- Evidence packs are safe to hand to auditors by construction.

## Rejected alternatives

- Direct privilege mapping from IdP claims: vocabulary escape.
- Per-tenant policy engines: drift and double-semantics.
- Silent admin override: unauditable and unaudited power.

## Verification

- Cross-tenant denial on every plane; bounded deterministic expansion;
- closed-vocabulary enforcement at mapping time;
- org bundle rollback refused; break-glass expiry/no-self-renew;
- audit separation; metadata-only packs.
