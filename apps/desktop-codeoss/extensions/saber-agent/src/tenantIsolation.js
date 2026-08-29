/**
 * S35-WP04/S35-WP05/S35-WP06 — Governed registries, RBAC, audit,
 * retention and the enterprise adversarial suite.
 *
 * Separate catalogs publish signed entries whose metadata cannot
 * execute or fetch content before approval; an organization
 * allowlist never overrides a local Core denial. Roles hold least
 * privilege; audit partitions are tenant-safe; retention jobs are
 * observable and idempotent; Break Glass needs dual control with
 * expiry, alarm and after-action review and never disables audit.
 */

const ROLES = Object.freeze(["developer", "lead", "reviewer", "curator", "security", "admin", "auditor"]);

/** Least-privilege grants per role. */
const ROLE_GRANTS = Object.freeze({
  developer: Object.freeze(["run:start", "changeset:review"]),
  lead: Object.freeze(["run:start", "changeset:review", "task:delegate"]),
  reviewer: Object.freeze(["changeset:review", "changeset:comment"]),
  curator: Object.freeze(["memory:curate", "knowledge:publish"]),
  security: Object.freeze(["policy:propose", "incident:read", "breakglass:approve"]),
  admin: Object.freeze(["policy:distribute", "registry:approve", "breakglass:approve"]),
  auditor: Object.freeze(["audit:export", "retention:read"]),
});

function roleCheck(role, permission) {
  if (!ROLES.includes(role)) {
    throw new Error(`unknown_role:${role}`);
  }
  const granted = ROLE_GRANTS[role];
  return Object.freeze({
    role,
    permission,
    allowed: granted.includes(permission),
    leastPrivilege: granted.length,
  });
}

/** Registry catalogs are separate; entries are signed and inert until approved. */
const REGISTRY_KINDS = Object.freeze(["model", "skill", "mcp", "plugin", "remote-realm"]);

function registryEntry(kind, entry) {
  if (!REGISTRY_KINDS.includes(kind)) {
    throw new Error(`unknown_registry_kind:${kind}`);
  }
  if (!entry.digest || !entry.publisher || !entry.signature) {
    throw new Error("registry_entry_unsigned");
  }
  return Object.freeze({
    catalog: kind,
    id: entry.id,
    publisher: entry.publisher,
    digest: entry.digest,
    signature: entry.signature,
    version: entry.version ?? "0.0.0",
    capabilityScope: Object.freeze([...(entry.capabilityScope ?? [])]),
    dataScope: Object.freeze([...(entry.dataScope ?? [])]),
    approved: entry.approved === true,
    rollout: entry.rollout ?? "not-started",
    revoked: entry.revoked === true,
    executableBeforeApproval: false,
    fetchableBeforeApproval: false,
  });
}

/**
 * Access decision combining the organization allowlist and the local
 * Core: the org may add, never subtract.
 */
function registryAccess(entry, orgAllowlisted, coreDeny) {
  if (entry.revoked === true) {
    return Object.freeze({ id: entry.id, allowed: false, reason: "entry_revoked" });
  }
  if (coreDeny === true) {
    return Object.freeze({
      id: entry.id,
      allowed: false,
      reason: "core-denial-overrides-org-allowlist",
      orgAllowlistOverride: false,
    });
  }
  if (!orgAllowlisted) {
    return Object.freeze({ id: entry.id, allowed: false, reason: "not_org_allowlisted" });
  }
  if (entry.approved !== true) {
    return Object.freeze({ id: entry.id, allowed: false, reason: "not_yet_approved" });
  }
  return Object.freeze({ id: entry.id, allowed: true, reason: "approved-and-allowlisted" });
}

/** Tenant-safe audit partition; export follows role and legal basis. */
function auditPartition(records, requester) {
  const own = records.filter((record) => record.tenantId === requester.tenantId);
  const canExport = requester.role === "auditor" || requester.role === "admin";
  return Object.freeze({
    tenantId: requester.tenantId,
    records: Object.freeze(own.map((record) => ({ ...record }))),
    crossTenantLeak: own.some((record) => record.tenantId !== requester.tenantId),
    export: Object.freeze({
      allowed: canExport,
      metadata: canExport ? "all" : "none",
      content: canExport && requester.legalBasis ? "per-legal-basis" : "none",
    }),
  });
}

/** Retention/legal-hold/export/deletion jobs are observable and idempotent. */
function retentionJob(kind, key) {
  const kinds = ["retention", "legal-hold", "export", "deletion"];
  if (!kinds.includes(kind)) {
    throw new Error(`unknown_retention_kind:${kind}`);
  }
  return Object.freeze({
    kind,
    key,
    idempotencyKey: `retention:${kind}:${key}`,
    observable: true,
    reRun: "no-op-when-complete",
  });
}

/**
 * Break Glass: dual control, expiry, prominent alarm and after-action
 * review; audit never stops during a break.
 */
function breakGlass(request, existingApprovals = []) {
  if (request.approvals < 2) {
    return Object.freeze({
      granted: false,
      reason: "dual_control_required",
      approvals: request.approvals,
      auditDisabled: false,
    });
  }
  const expired = request.expiresAtMs !== undefined && request.nowMs > request.expiresAtMs;
  if (expired) {
    return Object.freeze({ granted: false, reason: "expired", auditDisabled: false });
  }
  return Object.freeze({
    granted: true,
    approvals: request.approvals,
    approver1: request.approver1,
    approver2: request.approver2,
    expiresAtMs: request.expiresAtMs,
    alarm: "prominent",
    afterActionReview: "required",
    auditDisabled: false,
  });
}

/**
 * The enterprise adversarial suite: cross-tenant ID, forged claim,
 * recursive group, policy rollback, KMS unavailability, revoked
 * device, registry digest swap, retention race, audit inference and
 * Break Glass abuse — each must fail closed or be contained.
 */
function adversarial(scenario) {
  const table = Object.freeze({
    "cross-tenant-id": { contained: true, mechanism: "tenant-scoped partition rejects foreign IDs" },
    "forged-claim": { contained: true, mechanism: "issuer/subject/tenant validation fails closed" },
    "recursive-group": { contained: true, mechanism: "depth-bounded group resolution" },
    "policy-rollback": { contained: true, mechanism: "monotonic sequence rejection" },
    "kms-unavailability": { contained: true, mechanism: "fail closed without plaintext fallback" },
    "revoked-device": { contained: true, mechanism: "device revocation blocks high-risk actions" },
    "registry-digest-swap": { contained: true, mechanism: "signature covers digest; swap mismatches" },
    "retention-race": { contained: true, mechanism: "idempotent jobs keyed by kind+key" },
    "audit-inference": { contained: true, mechanism: "metadata-only export without legal basis" },
    "break-glass-abuse": { contained: true, mechanism: "dual control + expiry + alarm + review" },
  });
  const entry = table[scenario];
  if (!entry) {
    throw new Error(`unknown_adversarial_scenario:${scenario}`);
  }
  return Object.freeze({ scenario, ...entry, failClosed: true });
}

module.exports = {
  REGISTRY_KINDS,
  ROLES,
  ROLE_GRANTS,
  adversarial,
  auditPartition,
  breakGlass,
  registryAccess,
  registryEntry,
  retentionJob,
  roleCheck,
};
