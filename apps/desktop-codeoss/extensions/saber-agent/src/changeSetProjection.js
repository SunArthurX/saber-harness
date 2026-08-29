/**
 * S31-WP01/WP02/WP04 — Change Set projection.
 *
 * A governed run's worktree changes become an independently reviewable
 * Change Set: baseline-bound (commit/tree, worktree, run and artifact
 * digests), classified (added/modified/deleted, binary, generated,
 * untracked), stale-apply-safe (external edits block), with review
 * decisions expressed as intents — a projection NEVER mutates files.
 */

/** File classifications (S31-WP01). */
const CHANGE_KINDS = Object.freeze(["added", "modified", "deleted", "renamed", "unchanged"]);

/** Review decisions a user can express (S31-WP02/WP04). */
const REVIEW_DECISIONS = Object.freeze([
  "comment",
  "request-revision",
  "accept",
  "reject",
  "apply",
  "roll-back",
  "commit",
]);

/** Classify one inventory diff between baseline and current. */
function classifyFile(path, baseline, current) {
  if (baseline === undefined && current !== undefined) {
    return "added";
  }
  if (baseline !== undefined && current === undefined) {
    return "deleted";
  }
  if (baseline?.sha256 === current?.sha256) {
    return "unchanged";
  }
  return "modified";
}

/** Full classification record for one file (binary/generated flags). */
function fileRecord(path, baseline, current) {
  const change = classifyFile(path, baseline, current);
  const bytes = current?.size ?? baseline?.size ?? 0;
  const binary = Boolean(current?.binary ?? baseline?.binary);
  const generated = /(^|\/)(dist|build|generated)\//.test(path) || /\.min\./.test(path);
  return Object.freeze({
    path,
    change,
    binary,
    generated,
    untracked: Boolean(current?.untracked ?? true),
    // Large/binary files show metadata and approved preview, never a
    // silent omission (S31-WP01).
    presentation: binary || bytes > 512 * 1024 ? "metadata-and-approved-preview" : "diff",
  });
}

/**
 * Build the change set projection from baseline and current inventories
 * (path → {sha256, size}). The tree digest binds the whole set.
 */
function buildChangeSet(runId, baseline, current) {
  const paths = new Set([...Object.keys(baseline ?? {}), ...Object.keys(current ?? {})]);
  const files = [...paths]
    .map((path) => fileRecord(path, baseline?.[path], current?.[path]))
    .filter((record) => record.change !== "unchanged")
    .sort((a, b) => a.path.localeCompare(b.path));
  const treeDigest = digestInventory(current);
  return Object.freeze({
    runId,
    files: Object.freeze(files),
    treeDigest,
    baselineDigest: digestInventory(baseline),
    counts: Object.freeze({
      added: files.filter((file) => file.change === "added").length,
      modified: files.filter((file) => file.change === "modified").length,
      deleted: files.filter((file) => file.change === "deleted").length,
      binary: files.filter((file) => file.binary).length,
      generated: files.filter((file) => file.generated).length,
    }),
  });
}

/** Deterministic tree digest over a sorted inventory (mirrors the Core). */
function digestInventory(inventory) {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(inventory ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  );
  return sha256Hex(canonical);
}

let sha256Sync = null;
/** Inject the digest primitive (Node crypto in tests/host; the pure
 * projection never assumes a specific runtime). */
function useSha256(fn) {
  sha256Sync = fn;
}

function sha256Hex(text) {
  if (sha256Sync) {
    return sha256Sync(text);
  }
  // Fallback: stable non-cryptographic digest — never used for approval
  // digests (those come from the Core), only for projection identity.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv-${hash.toString(16).padStart(8, "0")}-${text.length}`;
}

/**
 * Apply preflight (S31-WP04/WP06): the expected tree digest must match
 * the current tree exactly; drift means stale apply, blocked.
 */
function applyPreflight(changeSet, expectedTreeDigest, currentInventory) {
  const failures = [];
  if (changeSet.treeDigest !== expectedTreeDigest) {
    failures.push("changeset-digest-mismatch");
  }
  const currentDigest = digestInventory(currentInventory);
  if (currentDigest !== expectedTreeDigest) {
    failures.push("stale-apply-blocked");
  }
  return Object.freeze({ allowed: failures.length === 0, failures: Object.freeze(failures), currentDigest });
}

/** Rollback proof check: every hash must equal the baseline manifest. */
function rollbackProof(baseline, restored) {
  const mismatches = [];
  for (const [path, entry] of Object.entries(baseline ?? {})) {
    if (restored?.[path]?.sha256 !== entry.sha256) {
      mismatches.push(path);
    }
  }
  for (const path of Object.keys(restored ?? {})) {
    if (!(path in (baseline ?? {}))) {
      mismatches.push(`${path}:unexpected`);
    }
  }
  return Object.freeze({
    restored: mismatches.length === 0,
    mismatches: Object.freeze(mismatches),
    fileCount: Object.keys(restored ?? {}).length,
  });
}

module.exports = {
  CHANGE_KINDS,
  REVIEW_DECISIONS,
  applyPreflight,
  buildChangeSet,
  classifyFile,
  digestInventory,
  fileRecord,
  rollbackProof,
  useSha256,
};
