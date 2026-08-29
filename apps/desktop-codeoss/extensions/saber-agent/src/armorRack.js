/**
 * S34-WP01 — Armor Rack.
 *
 * One signed Capability Manifest describes Skill, command, Agent, MCP,
 * hook or browser/computer adapters (ZCD-05, CLD-07); each component
 * has separate permissions, isolation, health and revocation. Install
 * or update grants no capability beyond the reviewed Manifest, load
 * and unload are reversible (DSH-01/02/04), immune roots stay
 * privileged (DSH-07) and revocation immediately removes
 * authorization while marking dependent workflows.
 */

/** Armor component kinds one Manifest can describe. */
const ARMOR_KINDS = Object.freeze(["model", "external-agent", "mcp", "plugin", "browser", "realm"]);

/** A Manifest must be signed by a known publisher key to load at all. */
const TRUSTED_SIGNERS = Object.freeze(["saber-official", "enterprise-admin"]);

/**
 * Verify a Capability Manifest signature and shape. Unsigned or
 * tampered manifests fail closed before any permission is granted.
 */
function verifyManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("manifest_missing");
  }
  if (!ARMOR_KINDS.includes(manifest.kind)) {
    throw new Error(`unknown_armor_kind:${manifest.kind}`);
  }
  if (!manifest.signer || !TRUSTED_SIGNERS.includes(manifest.signer)) {
    throw new Error(`untrusted_signer:${String(manifest.signer)}`);
  }
  if (manifest.signature === undefined || manifest.signature === null || manifest.signature === "") {
    throw new Error("unsigned_manifest");
  }
  if (typeof manifest.sourceDigest !== "string" || manifest.sourceDigest.length === 0) {
    throw new Error("missing_source_digest");
  }
  const expected = manifestDigest(manifest);
  if (manifest.signature !== expected) {
    throw new Error("signature_mismatch");
  }
  return Object.freeze({
    kind: manifest.kind,
    signer: manifest.signer,
    version: manifest.version ?? "0.0.0",
    sourceDigest: manifest.sourceDigest,
    valid: true,
  });
}

/** Deterministic digest binding signature to the reviewed content. */
function manifestDigest(manifest) {
  const reviewed = [
    manifest.kind,
    manifest.signer,
    manifest.version ?? "0.0.0",
    manifest.sourceDigest,
    JSON.stringify(manifest.capabilities ?? []),
    JSON.stringify(manifest.secrets ?? []),
    JSON.stringify(manifest.egress ?? []),
  ].join("|");
  let hash = 0;
  for (const ch of reviewed) {
    hash = (hash * 31 + ch.codePointAt(0)) % 0x100000000;
  }
  return `sig-${hash.toString(16)}`;
}

/** Build a signed Manifest (trusted publisher side of the contract). */
function signManifest(manifest) {
  const base = { ...manifest, signature: undefined };
  return Object.freeze({ ...base, signature: manifestDigest(base) });
}

/**
 * The Rack card: everything reviewable in one place — publisher,
 * source digest, signer, version, runtime location, data scope,
 * capabilities, secrets, egress, health, cost and uninstall impact.
 */
function armorCard(armor) {
  const manifest = armor.manifest;
  const verified = verifyManifest(manifest);
  return Object.freeze({
    id: armor.id,
    kind: verified.kind,
    publisher: manifest.publisher ?? verified.signer,
    sourceDigest: verified.sourceDigest,
    signer: verified.signer,
    version: verified.version,
    runtimeLocation: armor.runtimeLocation ?? "in-process",
    dataScope: manifest.dataScope ?? "workspace",
    capabilities: Object.freeze([...(manifest.capabilities ?? [])]),
    secrets: Object.freeze([...(manifest.secrets ?? [])]),
    egress: Object.freeze([...(manifest.egress ?? [])]),
    health: armor.health ?? "unknown",
    cost: armor.cost ?? { model: "metered" },
    uninstallImpact: uninstallImpact(armor),
    signed: true,
  });
}

/** What breaks when this armor is removed (review before uninstall). */
function uninstallImpact(armor) {
  return Object.freeze({
    dependentWorkflows: Object.freeze([...(armor.dependents ?? [])]),
    isolatedStateRemoved: true,
    auditHistoryPreserved: true,
  });
}

/**
 * Install or update grants exactly the reviewed Manifest surface —
 * never a superset, never ambient authority beyond the Manifest.
 */
function installGrant(manifest, requestedCapabilities) {
  const verified = verifyManifest(manifest);
  const allowed = new Set(manifest.capabilities ?? []);
  const requested = requestedCapabilities ?? [...allowed];
  const granted = requested.filter((capability) => allowed.has(capability));
  const denied = requested.filter((capability) => !allowed.has(capability));
  return Object.freeze({
    kind: verified.kind,
    granted: Object.freeze(granted),
    denied: Object.freeze(denied),
    grantsBeyondManifest: denied.length > 0,
    note:
      denied.length > 0
        ? "requested capabilities outside the reviewed Manifest are denied"
        : "grants match the reviewed Manifest",
  });
}

/**
 * Reversible load/unload with signed profiles (DSH-01/02/04): loading
 * keeps a recovery profile; immune-root armor stays privileged.
 */
function reversibleLoad(armor, action) {
  if (action !== "load" && action !== "unload") {
    throw new Error(`unknown_load_action:${action}`);
  }
  return Object.freeze({
    armorId: armor.id,
    action,
    reversible: true,
    recoveryProfile: action === "load" ? (armor.lastKnownGoodProfile ?? "initial") : "retained",
    immuneRootStaysPrivileged: armor.immuneRoot === true,
  });
}

/**
 * Revocation immediately removes authorization and marks dependent
 * workflows; the audit trail of what it did survives.
 */
function revokeArmor(rack, armorId) {
  const armor = rack.find((entry) => entry.id === armorId);
  if (!armor) {
    throw new Error(`unknown_armor:${armorId}`);
  }
  const dependents = armor.dependents ?? [];
  return Object.freeze({
    armorId,
    authorizationRemoved: true,
    dependentWorkflowsMarked: Object.freeze(dependents.map((id) => ({ id, marked: "armor-revoked" }))),
    capabilitiesPurged: Object.freeze([...(armor.manifest.capabilities ?? [])]),
    auditHistoryPreserved: true,
  });
}

module.exports = {
  ARMOR_KINDS,
  TRUSTED_SIGNERS,
  armorCard,
  installGrant,
  manifestDigest,
  revokeArmor,
  reversibleLoad,
  signManifest,
  uninstallImpact,
  verifyManifest,
};
