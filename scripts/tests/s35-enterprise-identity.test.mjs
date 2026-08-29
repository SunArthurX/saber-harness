/**
 * S35-WP01 — identity and device enrollment tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const identity = await src("enterpriseIdentity.js");

const ISSUER = "https://idp.example.test";

function assertion(overrides = {}) {
  return {
    issuer: ISSUER,
    subject: "user-1",
    tenantId: "tenant-a",
    roles: ["developer"],
    issuedAtMs: 1000,
    expiresAtMs: 2000,
    ...overrides,
  };
}

test("S35-WP01 OIDC/SAML exchange yields short-lived claims and never touches passwords", () => {
  const claims = identity.exchangeAssertion(assertion(), 1500);
  assert.equal(claims.shortLived, true);
  assert.equal(claims.passwordSeen, false);
  assert.equal(claims.tenantId, "tenant-a");
  assert.throws(
    () => identity.exchangeAssertion({ ...assertion(), password: "hunter2" }, 1500),
    /password_handling_prohibited/,
  );
});

test("S35-WP01 forged claims fail closed", () => {
  assert.throws(
    () => identity.exchangeAssertion(assertion({ issuer: "https://evil.test" }), 1500),
    /forged_claim:issuer/,
  );
  assert.throws(() => identity.exchangeAssertion(assertion({ subject: "" }), 1500), /forged_claim:subject/);
  assert.throws(() => identity.exchangeAssertion({ ...assertion(), tenantId: undefined }, 1500), /forged_claim:tenant/);
  assert.throws(() => identity.exchangeAssertion(assertion(), 2000 + identity.CLOCK_SKEW_MS + 1), /assertion_expired/);
});

test("S35-WP01 SCIM group resolution is tenant-scoped and depth-bounded", () => {
  const graph = {
    eng: { tenantId: "tenant-a", members: ["user-1"], groups: ["leads"] },
    leads: { tenantId: "tenant-a", members: ["user-2"] },
    other: { tenantId: "tenant-b", members: ["user-x"] },
  };
  assert.deepEqual(identity.resolveGroups("eng", graph, "tenant-a"), ["user-1", "user-2"]);
  assert.throws(() => identity.resolveGroups("eng", graph, "tenant-b"), /cross_tenant_group:eng/);
  const cyclic = {
    a: { tenantId: "t", members: ["u1"], groups: ["b"] },
    b: { tenantId: "t", members: ["u2"], groups: ["a"] },
  };
  assert.throws(() => identity.resolveGroups("a", cyclic, "t"), /recursive_group/);
  assert.equal(identity.MAX_GROUP_DEPTH, 5);
});

test("S35-WP01 SCIM mapping is deterministic", () => {
  const graph = {
    eng: { tenantId: "tenant-a", members: ["user-1"], groups: ["leads", "security"] },
    leads: { tenantId: "tenant-a", members: [] },
    security: { tenantId: "tenant-a", members: [] },
  };
  const user = { tenantId: "tenant-a", externalId: "ext-1", roles: ["developer"], groupIds: ["eng", "eng"] };
  const first = identity.scimMap(user, graph);
  const second = identity.scimMap(user, graph);
  assert.deepEqual(first.roles, second.roles);
  assert.deepEqual([...first.roles].sort(), ["developer", "lead", "security"]);
  assert.equal(first.deterministic, true);
});

test("S35-WP01 device enrollment exposes the full identity surface", () => {
  const device = identity.enrollDevice({
    deviceId: "dev-1",
    tenantId: "tenant-a",
    ownerId: "user-1",
    posture: "compliant",
    lastCheckInMs: 5000,
    ownership: "corporate",
  });
  assert.equal(device.posture, "compliant");
  assert.equal(device.revoked, false);
  assert.equal(device.ownership, "corporate");
  assert.throws(() => identity.enrollDevice({ deviceId: "dev-1" }), /device_identity_incomplete/);
});

test("S35-WP01 high-risk actions fail closed on revoked, deprovisioned, lost, mismatched or stale devices", () => {
  const claims = { tenantId: "tenant-a" };
  const base = { deviceId: "dev-1", tenantId: "tenant-a", lastCheckInMs: 1000, posture: "compliant" };
  assert.equal(
    identity.authorizeHighRisk({ ...base, revoked: true }, claims, "secret.export", 2000).reason,
    "device_revoked",
  );
  assert.equal(
    identity.authorizeHighRisk({ ...base, deprovisioned: true }, claims, "secret.export", 2000).reason,
    "user_deprovisioned",
  );
  assert.equal(
    identity.authorizeHighRisk({ ...base, lost: true }, claims, "secret.export", 2000).reason,
    "device_lost",
  );
  assert.equal(
    identity.authorizeHighRisk(base, { tenantId: "tenant-b" }, "secret.export", 2000).reason,
    "tenant_mismatch",
  );
  const beyondGrace = identity.GRACE_MS + identity.CLOCK_SKEW_MS + 1000;
  assert.equal(
    identity.authorizeHighRisk(base, claims, "secret.export", base.lastCheckInMs + beyondGrace).reason,
    "offline_grace_exceeded",
  );
  const ok = identity.authorizeHighRisk(base, claims, "secret.export", 2000);
  assert.equal(ok.allowed, true);
  assert.equal(identity.authorizeHighRisk({ ...base, lastCheckInMs: 0 }, claims, "secret.export", 2000).allowed, true);
});
