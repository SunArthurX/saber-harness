# S35 Runbook — Enterprise Desktop

Status: planned

Release train: RT-3 Enterprise Production Candidate

Duration: 12-15 working days

Owners: Enterprise Platform Lead (A), Identity/Policy/Security Engineers (R),
Compliance and Privacy reviewers (R), SDET (R)

Risk: critical

## Outcome

An organization can enroll devices and users, distribute signed monotonic
policy, control model/plugin/data access, rotate keys, export separated audit
evidence and enforce retention without giving the cloud control plane access to
unauthorized source or conversation plaintext.

## Competitive-derived requirements

- `CLD-05`, `ZCD-07`, `MMX-08`: Remote Dispatch authenticates user, device,
  desktop instance and executing Realm; the phone is a control surface and
  cannot enlarge authority.
- `ZCD-05`, `CLD-07`: organization policy controls Capability sources,
  signatures, connector scopes, computer-use availability and revocation.
- Multi-repository Goals use separate repository trust cells, secrets, policy,
  Worktrees and integration approval even when presented in one workspace.

## Preconditions

Requires S34 protected merge, enterprise test tenant, non-production IdP/KMS,
documented data regions and privacy/legal owner. Production credentials and
real employee/customer data are prohibited in CI.

## Advanced harness and philosophy requirements

- `CUR-04`, `OHD-04`: remote/background Agent backends retain tenant, device,
  Realm, budget, evidence and takeover provenance.
- `DSH-04`: organization Agent Profiles compose only signed, allowed Armor and
  expose unresolved or revoked dependencies.
- `DSH-05`, `OHD-02`, `OHD-05`: Runtime images and execution-world identity are
  attested, reproducible and constrained by mount, egress, secret and resource
  policy.
- Prove `PHL-09`: E2EE sync, KMS integration and device revocation preserve
  client/tenant key authority and honest offline conflict behavior.

## Work packages

### S35-WP01 — Identity and device enrollment

- OIDC/SAML login exchanges into short-lived local claims; no password handling.
- SCIM mapping is deterministic, depth-bounded and tenant-scoped.
- Device identity, posture, ownership, last check-in and revocation are visible.
- Offline grace, clock skew, deprovisioning and lost-device behavior are
  explicit and fail closed for high-risk actions.

### S35-WP02 — Policy distribution

- Organization bundles are signed, versioned and monotonic.
- Show source, sequence, signer, effective scope, conflicts and last accepted
  version.
- Lower scope cannot weaken deny; rollback or same-sequence replacement fails.
- Offline client uses last verified policy and surfaces staleness.

### S35-WP03 — KMS, Secret Broker and DLP

- Support envelope wrapping through a non-production KMS adapter while local
  plaintext remains in approved process memory only.
- Key rotation is resumable and rollback-safe; old device/key revocation is
  testable.
- Admin configures named secret references, not secret values in policy/UI.
- DLP rules show classification, destination, transformation and block evidence.

### S35-WP04 — Governed registries

- Separate model, Skill, MCP, plugin and remote Realm catalogs.
- Each entry has publisher, signature, digest, version, capability/data scope,
  approval, rollout and revocation.
- Organization allowlist does not override local Core denial.
- Marketplace/search metadata cannot execute or fetch content before approval.

### S35-WP05 — RBAC, audit and retention

- Roles: developer, lead, reviewer, curator, security, admin and auditor with
  least privilege.
- Audit partitions are tenant-safe and export metadata/content according to
  role and legal basis.
- Retention, legal hold, export and deletion jobs are observable and idempotent.
- Break Glass requires dual control, expiry, prominent alarm and after-action
  review; it never disables audit.

### S35-WP06 — Enterprise adversarial suite

Test cross-tenant ID, forged claim, recursive group, policy rollback, KMS
unavailability, revoked device, registry digest swap, retention race, audit
inference and Break Glass abuse.

## Verification

```sh
node scripts/verify-s35.mjs
pnpm desktop:test:enterprise-identity
pnpm desktop:test:policy-distribution
pnpm desktop:test:kms-dlp
pnpm desktop:test:tenant-isolation
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- Tenant, device and role isolation pass adversarial tests.
- Policy rollback and lower-scope weakening are impossible.
- Secret/KMS plaintext is absent from logs, models, policy and crash dumps.
- Audit/retention/deletion behavior matches documented legal boundaries.
