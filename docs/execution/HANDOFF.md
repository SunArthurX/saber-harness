# S35 Handoff — Enterprise Desktop

Status: in progress — the complete enterprise contract is implemented
and tested (24 pure tests); the protected PR, hosted checks,
completion record and s35-complete tag remain
Date: 2026-08-29
Branch: `segment/S35-enterprise-desktop`
Base main: `da9499edaaa9a4d61056dad99722809f7c01bf8e` (`s34-complete`)
Runbook: `docs/execution/desktop/S35-ENTERPRISE-DESKTOP.md`

## What landed

- **enterpriseIdentity** — short-lived claims without password
  handling, forged claims failing closed, deterministic tenant-scoped
  SCIM with depth-bounded groups and transitive role closure, device
  enrollment surfaces, fail-closed high-risk authorization.
- **policyDistribution** — enterprise-key-signed versioned bundles,
  monotonic acceptance (no rollback/replay), org denies that lower
  scopes cannot weaken, offline last-verified with surfaced
  staleness.
- **kmsDlp** — envelope wrapping with plaintext confined to approved
  process memory, resumable rollback-safe rotation, revocable device
  wraps, named secret references, plaintext sink audits, DLP block
  evidence.
- **tenantIsolation** — five signed registry catalogs inert before
  approval where org allowlists never override Core denial, seven
  least-privilege roles, tenant-safe audit export by role and legal
  basis, idempotent retention jobs, dual-control Break Glass with
  audit always on, ten adversarial scenarios failing closed.
- **Evidence**: 24 tests across four suites; verify-s35 (77 checks)
  in local and hosted gates.

## Honest limits

Identity, KMS and registries use non-production fixture adapters;
real IdP/KMS/SCIM endpoints arrive with the production gate segment.

## Next actions

1. Push, open the protected PR, wait for the five checks.
2. Squash-merge; completion record; annotated `s35-complete`.
3. S36 starts only from
   `docs/execution/desktop/S36-PACKAGING-UPDATE.md`.
