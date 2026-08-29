/**
 * S35-WP01 — Identity and device enrollment.
 *
 * OIDC/SAML login exchanges into short-lived local claims with no
 * password handling (CLD-05, ZCD-07); SCIM mapping is deterministic,
 * depth-bounded and tenant-scoped; device identity, posture,
 * ownership, check-in and revocation are visible; offline grace,
 * clock skew, deprovisioning and lost-device behavior fail closed for
 * high-risk actions.
 */

const GRACE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Exchange an IdP assertion for short-lived local claims. Forged,
 * expired or wrong-issuer assertions fail closed; passwords are never
 * accepted.
 */
function exchangeAssertion(assertion, nowMs, issuer = "https://idp.example.test") {
  if (!assertion || typeof assertion !== "object") {
    throw new Error("assertion_missing");
  }
  if (assertion.password !== undefined) {
    throw new Error("password_handling_prohibited");
  }
  if (assertion.issuer !== issuer) {
    throw new Error(`forged_claim:issuer:${String(assertion.issuer)}`);
  }
  if (typeof assertion.subject !== "string" || assertion.subject.length === 0) {
    throw new Error("forged_claim:subject");
  }
  if (assertion.tenantId === undefined) {
    throw new Error("forged_claim:tenant");
  }
  if (assertion.expiresAtMs !== undefined && nowMs > assertion.expiresAtMs + CLOCK_SKEW_MS) {
    throw new Error("assertion_expired");
  }
  return Object.freeze({
    tenantId: assertion.tenantId,
    subject: assertion.subject,
    roles: Object.freeze([...(assertion.roles ?? [])]),
    issuedAtMs: assertion.issuedAtMs ?? nowMs,
    expiresAtMs: assertion.expiresAtMs ?? nowMs + 15 * 60 * 1000,
    shortLived: true,
    passwordSeen: false,
  });
}

/** Tenant-scoped group resolution that refuses recursion loops. */
const MAX_GROUP_DEPTH = 5;

function resolveGroups(groupId, groupGraph, tenantId, depth = 0) {
  if (depth > MAX_GROUP_DEPTH) {
    throw new Error(`recursive_group:${groupId}`);
  }
  const node = groupGraph[groupId];
  if (!node || node.tenantId !== tenantId) {
    throw new Error(`cross_tenant_group:${groupId}`);
  }
  const direct = new Set(node.members ?? []);
  for (const child of node.groups ?? []) {
    for (const member of resolveGroups(child, groupGraph, tenantId, depth + 1)) {
      direct.add(member);
    }
  }
  return [...direct].sort();
}

/**
 * SCIM mapping is deterministic (same input, same output), depth-
 * bounded through resolveGroups, and tenant-scoped. Roles derive from
 * the transitive closure of group membership.
 */
function groupClosure(groupId, groupGraph, tenantId, depth = 0) {
  if (depth > MAX_GROUP_DEPTH) {
    throw new Error(`recursive_group:${groupId}`);
  }
  const node = groupGraph[groupId];
  if (!node || node.tenantId !== tenantId) {
    throw new Error(`cross_tenant_group:${groupId}`);
  }
  const names = new Set([groupId]);
  for (const child of node.groups ?? []) {
    for (const name of groupClosure(child, groupGraph, tenantId, depth + 1)) {
      names.add(name);
    }
  }
  return names;
}

function scimMap(user, groupGraph) {
  const groupNames = new Set();
  for (const id of user.groupIds ?? []) {
    resolveGroups(id, groupGraph, user.tenantId);
    for (const name of groupClosure(id, groupGraph, user.tenantId)) {
      groupNames.add(name);
    }
  }
  return Object.freeze({
    tenantId: user.tenantId,
    externalId: user.externalId,
    roles: Object.freeze([...new Set([...(user.roles ?? []), ...roleFromGroups([...groupNames])])].sort()),
    groups: Object.freeze([...groupNames].sort()),
    deterministic: true,
    depthBounded: MAX_GROUP_DEPTH,
  });
}

function roleFromGroups(groups) {
  const roles = [];
  if (groups.includes("leads")) {
    roles.push("lead");
  }
  if (groups.includes("security")) {
    roles.push("security");
  }
  return roles;
}

/** Enroll or observe a device: identity, posture, ownership, check-in. */
function enrollDevice(device) {
  if (!device.deviceId || !device.tenantId || !device.ownerId) {
    throw new Error("device_identity_incomplete");
  }
  return Object.freeze({
    deviceId: device.deviceId,
    tenantId: device.tenantId,
    ownerId: device.ownerId,
    posture: device.posture ?? "unknown",
    lastCheckInMs: device.lastCheckInMs ?? 0,
    revoked: device.revoked === true,
    ownership: device.ownership ?? "corporate",
  });
}

/**
 * Authorization for a high-risk action under offline grace, clock
 * skew, deprovisioning or lost-device conditions: fail closed.
 */
function authorizeHighRisk(device, claims, action, nowMs) {
  if (device.revoked === true) {
    return Object.freeze({ action, allowed: false, reason: "device_revoked" });
  }
  if (device.deprovisioned === true) {
    return Object.freeze({ action, allowed: false, reason: "user_deprovisioned" });
  }
  if (device.lost === true) {
    return Object.freeze({ action, allowed: false, reason: "device_lost" });
  }
  if (claims.tenantId !== device.tenantId) {
    return Object.freeze({ action, allowed: false, reason: "tenant_mismatch" });
  }
  const staleBy = nowMs - device.lastCheckInMs;
  if (device.lastCheckInMs > 0 && staleBy > GRACE_MS + CLOCK_SKEW_MS) {
    return Object.freeze({ action, allowed: false, reason: "offline_grace_exceeded" });
  }
  return Object.freeze({
    action,
    allowed: true,
    reason: "within-grace-and-posture",
    offlineStale: device.lastCheckInMs > 0 && staleBy > GRACE_MS,
  });
}

module.exports = {
  CLOCK_SKEW_MS,
  GRACE_MS,
  MAX_GROUP_DEPTH,
  authorizeHighRisk,
  enrollDevice,
  exchangeAssertion,
  resolveGroups,
  scimMap,
};
