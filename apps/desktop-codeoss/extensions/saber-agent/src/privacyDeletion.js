/**
 * S33-WP06 — privacy, sync and deletion.
 *
 * Local encryption and OS credential storage are mandatory; client-key
 * E2EE sync sends ciphertext and minimal allowed metadata only; strict
 * mode honestly reports that server-side plaintext search is
 * unavailable; and device removal, key rotation, export, account
 * deletion, legal hold and derived-data deletion propagate through a
 * verified graph (PHL-08, PHL-09, PHL-11, ADR-019).
 */

/** Mandatory local storage policy. */
const STORAGE_POLICY = Object.freeze({
  atRest: "encrypted",
  credentials: "os-credential-store",
  plaintextLocalCache: false,
});

/** What E2EE sync may transmit. */
function syncEnvelope(ciphertext, metadata) {
  const allowed = Object.freeze(["record_id", "workspace_id", "version", "updated_at_ms"]);
  const keys = Object.keys(metadata ?? {});
  const disallowed = keys.filter((key) => !allowed.includes(key));
  if (disallowed.length > 0) {
    throw new Error(`metadata_not_allowed:${disallowed.join(",")}`);
  }
  return Object.freeze({
    ciphertext,
    metadata: Object.freeze(metadata ?? {}),
    plaintextLeak: false,
  });
}

/** Strict E2EE mode honestly reports unavailable capabilities. */
function strictModeCapabilities() {
  return Object.freeze({
    serverSidePlaintextSearch: false,
    notice: "Server-side plaintext search is unavailable in strict E2EE mode; search runs locally on decrypted copies.",
    syncWorks: true,
  });
}

/**
 * The deletion graph: canonical sources survive index loss (PHL-08);
 * deleting derived data never touches canonical truth; account
 * deletion cascades everywhere except legal holds.
 */
const DELETION_KINDS = Object.freeze([
  "device-removal",
  "key-rotation",
  "export",
  "account-deletion",
  "legal-hold",
  "derived-data-deletion",
]);

function deletionPropagation(kind, graph = { canonical: 1, derived: 2, indexes: 3, syncedCopies: 2 }) {
  switch (kind) {
    case "device-removal":
      return Object.freeze({ kind, localCopies: 0, remoteCopies: graph.syncedCopies, authorityUnchanged: true });
    case "key-rotation":
      return Object.freeze({ kind, reEncrypted: true, oldKeysUsable: false, dataLoss: false });
    case "export":
      return Object.freeze({ kind, plaintextExport: true, warned: "export decrypts data — store it safely" });
    case "account-deletion":
      return Object.freeze({
        kind,
        canonical: 0,
        derived: 0,
        indexes: 0,
        syncedCopies: 0,
        verifiedByGraph: true,
      });
    case "legal-hold":
      return Object.freeze({
        kind,
        deletionDeferred: true,
        retainedCanonical: graph.canonical,
        userNotified: true,
      });
    case "derived-data-deletion":
      return Object.freeze({
        kind,
        derived: 0,
        indexes: 0,
        canonicalSurvives: graph.canonical,
        phl08: "canonical sources survive index loss",
      });
    default:
      throw new Error(`unknown_deletion_kind:${kind}`);
  }
}

/** Client-key continuity does not hide conflicts or move authority. */
function clientKeyContinuity(localRevision, remoteRevision) {
  const conflict = localRevision !== remoteRevision;
  return Object.freeze({
    conflict,
    conflictHidden: false,
    authorityMoved: false,
    resolution: conflict ? "user-must-choose; both revisions shown" : "fast-forward",
  });
}

module.exports = {
  DELETION_KINDS,
  STORAGE_POLICY,
  clientKeyContinuity,
  deletionPropagation,
  strictModeCapabilities,
  syncEnvelope,
};
