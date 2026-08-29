/**
 * S35-WP04/WP05/WP06 — registries, RBAC, audit, retention and the
 * adversarial suite tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const tenant = await src("tenantIsolation.js");

test("S35-WP04 five separate catalogs exist and entries are signed and inert before approval", () => {
  assert.deepEqual([...tenant.REGISTRY_KINDS], ["model", "skill", "mcp", "plugin", "remote-realm"]);
  const entry = tenant.registryEntry("mcp", {
    id: "mcp-1",
    publisher: "saber-official",
    digest: "sha256-x",
    signature: "sig-x",
    capabilityScope: ["fs.read"],
    dataScope: ["workspace"],
    approved: false,
  });
  assert.equal(entry.executableBeforeApproval, false);
  assert.equal(entry.fetchableBeforeApproval, false);
  assert.equal(entry.approved, false);
  assert.throws(() => tenant.registryEntry("rootkit-store", { id: "x" }), /unknown_registry_kind/);
  assert.throws(() => tenant.registryEntry("mcp", { id: "x", publisher: "anon" }), /registry_entry_unsigned/);
});

test("S35-WP04 the org allowlist never overrides a local Core denial", () => {
  const entry = tenant.registryEntry("model", {
    id: "model-1",
    publisher: "p",
    digest: "d",
    signature: "s",
    approved: true,
  });
  const denied = tenant.registryAccess(entry, true, true);
  assert.equal(denied.allowed, false);
  assert.equal(denied.orgAllowlistOverride, false);
  assert.equal(denied.reason, "core-denial-overrides-org-allowlist");
  assert.equal(tenant.registryAccess(entry, false, false).reason, "not_org_allowlisted");
  assert.equal(tenant.registryAccess(entry, true, false).allowed, true);
  const unapproved = tenant.registryAccess({ ...entry, approved: false }, true, false);
  assert.equal(unapproved.reason, "not_yet_approved");
  const revoked = tenant.registryAccess({ ...entry, revoked: true }, true, false);
  assert.equal(revoked.reason, "entry_revoked");
});

test("S35-WP05 seven roles hold least privilege", () => {
  assert.deepEqual([...tenant.ROLES], ["developer", "lead", "reviewer", "curator", "security", "admin", "auditor"]);
  assert.equal(tenant.roleCheck("developer", "run:start").allowed, true);
  assert.equal(tenant.roleCheck("developer", "policy:distribute").allowed, false);
  assert.equal(tenant.roleCheck("admin", "policy:distribute").allowed, true);
  assert.equal(tenant.roleCheck("auditor", "audit:export").allowed, true);
  assert.equal(tenant.roleCheck("auditor", "run:start").allowed, false);
  assert.throws(() => tenant.roleCheck("root", "anything"), /unknown_role:root/);
});

test("S35-WP05 audit partitions are tenant-safe and export follows role and legal basis", () => {
  const records = [
    { id: 1, tenantId: "tenant-a", action: "run.start" },
    { id: 2, tenantId: "tenant-b", action: "run.start" },
  ];
  const partition = tenant.auditPartition(records, { tenantId: "tenant-a", role: "auditor", legalBasis: "litigation" });
  assert.equal(partition.records.length, 1);
  assert.equal(partition.crossTenantLeak, false);
  assert.equal(partition.export.allowed, true);
  assert.equal(partition.export.content, "per-legal-basis");
  const developer = tenant.auditPartition(records, { tenantId: "tenant-a", role: "developer" });
  assert.equal(developer.export.allowed, false);
  const noBasis = tenant.auditPartition(records, { tenantId: "tenant-a", role: "auditor" });
  assert.equal(noBasis.export.content, "none");
});

test("S35-WP05 retention jobs are observable and idempotent", () => {
  const job = tenant.retentionJob("deletion", "tenant-a:user-1");
  assert.equal(job.idempotencyKey, "retention:deletion:tenant-a:user-1");
  assert.equal(job.observable, true);
  assert.equal(job.reRun, "no-op-when-complete");
  assert.throws(() => tenant.retentionJob("shred-everything", "x"), /unknown_retention_kind/);
});

test("S35-WP05 Break Glass requires dual control, expiry, alarm and review; audit never stops", () => {
  const single = tenant.breakGlass({ approvals: 1, nowMs: 1000 });
  assert.equal(single.granted, false);
  assert.equal(single.reason, "dual_control_required");
  assert.equal(single.auditDisabled, false);
  const expired = tenant.breakGlass({ approvals: 2, expiresAtMs: 500, nowMs: 1000 });
  assert.equal(expired.granted, false);
  assert.equal(expired.reason, "expired");
  const granted = tenant.breakGlass({
    approvals: 2,
    approver1: "sec-1",
    approver2: "admin-1",
    expiresAtMs: 5000,
    nowMs: 1000,
  });
  assert.equal(granted.granted, true);
  assert.equal(granted.alarm, "prominent");
  assert.equal(granted.afterActionReview, "required");
  assert.equal(granted.auditDisabled, false);
});

test("S35-WP06 all ten adversarial scenarios fail closed", () => {
  const scenarios = [
    "cross-tenant-id",
    "forged-claim",
    "recursive-group",
    "policy-rollback",
    "kms-unavailability",
    "revoked-device",
    "registry-digest-swap",
    "retention-race",
    "audit-inference",
    "break-glass-abuse",
  ];
  for (const scenario of scenarios) {
    const result = tenant.adversarial(scenario);
    assert.equal(result.contained, true, scenario);
    assert.equal(result.failClosed, true, scenario);
    assert.ok(result.mechanism.length > 0, scenario);
  }
  assert.throws(() => tenant.adversarial("social-engineering"), /unknown_adversarial_scenario/);
});
