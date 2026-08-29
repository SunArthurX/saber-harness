/**
 * S28-WP05 — layout persistence and restoration.
 *
 * Layout is stored under its own format version in a dedicated storage
 * key, strictly separate from authoritative Core state and run data.
 * Restoration validates shape and clamps panes; a corrupt or
 * unsupported-version layout falls back to the default lattice WITHOUT
 * deleting run data; panes whose surfaces are unavailable are replaced
 * by explainable placeholders; and a layout restored into a different
 * Worktree or Realm never silently switches identity — the mismatch is
 * surfaced and the default lattice used instead (S28-WP05).
 */

const {
  DEFAULT_LAYOUT,
  LAYOUT_FORMAT_VERSION,
  PANE_LIMITS,
  applyPreset,
  clampPane,
  resolveSafeState,
} = require("./workbenchLayout.js");

/** Dedicated layout storage keys — never run, policy or Core state keys. */
const LAYOUT_STORAGE_KEY = "saber.workbench.layout.v1";
const LAYOUT_IDENTITY_STORAGE_KEY = "saber.workbench.layoutIdentity.v1";

/** Storage keys this module may touch (guarded by tests). */
const OWNED_STORAGE_KEYS = Object.freeze([LAYOUT_STORAGE_KEY, LAYOUT_IDENTITY_STORAGE_KEY]);

const PANE_IDS = Object.freeze(Object.keys(PANE_LIMITS));

/** Explainable placeholder for a pane whose surface is unavailable. */
function paneReplacement(paneId, reason) {
  return Object.freeze({
    paneId,
    kind: "placeholder",
    reason,
    explanation:
      reason === "surface-unavailable"
        ? "This pane's surface is not available in this build; the pane is shown as a placeholder."
        : `Pane unavailable: ${reason}`,
  });
}

/** Serialize a layout with its identity binding. Pure JSON, no side effects. */
function serializeLayout(layout, identity, nowMs) {
  const record = {
    formatVersion: LAYOUT_FORMAT_VERSION,
    layout: layout ?? DEFAULT_LAYOUT,
    identity: {
      workspaceId: identity?.workspaceId ?? null,
      worktreeId: identity?.worktreeId ?? null,
      realmId: identity?.realmId ?? null,
    },
    savedAtMs: nowMs,
  };
  return JSON.stringify(record);
}

function isPlainLayout(value) {
  if (!value || typeof value !== "object" || typeof value.preset !== "string") {
    return false;
  }
  if (!value.panes || typeof value.panes !== "object") {
    return false;
  }
  return Object.entries(value.panes).every(([paneId, width]) => PANE_IDS.includes(paneId) && Number.isFinite(width));
}

/**
 * Restore a serialized layout.
 *
 * Returns { ok, layout, reason?, replaced, identityKept }:
 * - corrupt payload or unsupported version → default fallback, run data
 *   untouched (this module only ever writes OWNED_STORAGE_KEYS);
 * - identity mismatch (different worktree/realm) → default fallback with
 *   reason "identity-mismatch" so a window can never silently switch
 *   Worktree or Realm through its saved layout;
 * - unavailable panes → replaced by explainable placeholders in order.
 */
function restoreLayout(raw, { currentIdentity = {}, availablePanes = PANE_IDS } = {}) {
  const replaced = [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: "corrupt",
      layout: applyPreset(DEFAULT_LAYOUT, "team", 1280),
      replaced,
      identityKept: false,
    };
  }
  if (!parsed || parsed.formatVersion !== LAYOUT_FORMAT_VERSION) {
    return {
      ok: false,
      reason: parsed?.formatVersion > LAYOUT_FORMAT_VERSION ? "version-unsupported" : "corrupt",
      layout: applyPreset(DEFAULT_LAYOUT, "team", 1280),
      replaced,
      identityKept: false,
    };
  }
  const stored = parsed.identity ?? {};
  const sameWorkspace = (stored.workspaceId ?? null) === (currentIdentity.workspaceId ?? null);
  const sameRealm = (stored.realmId ?? null) === (currentIdentity.realmId ?? null);
  const sameWorktree = (stored.worktreeId ?? null) === (currentIdentity.worktreeId ?? null);
  if (!sameWorkspace || !sameRealm || !sameWorktree) {
    return {
      ok: false,
      reason: "identity-mismatch",
      layout: applyPreset(DEFAULT_LAYOUT, "team", 1280),
      replaced,
      identityKept: false,
    };
  }
  if (!isPlainLayout(parsed.layout)) {
    return {
      ok: false,
      reason: "corrupt",
      layout: applyPreset(DEFAULT_LAYOUT, "team", 1280),
      replaced,
      identityKept: true,
    };
  }
  const available = new Set(availablePanes);
  const panes = {};
  for (const paneId of PANE_IDS) {
    if (parsed.layout.panes[paneId] === undefined) {
      continue;
    }
    if (!available.has(paneId)) {
      replaced.push(paneReplacement(paneId, "surface-unavailable"));
      continue;
    }
    const clamped = clampPane(paneId, parsed.layout.panes[paneId]);
    if (clamped !== null) {
      panes[paneId] = clamped;
    }
  }
  const layout = Object.freeze({
    version: LAYOUT_FORMAT_VERSION,
    preset: parsed.layout.preset,
    safeState: resolveSafeState(1280),
    panes: Object.freeze(panes),
  });
  return { ok: true, reason: null, layout, replaced, identityKept: true };
}

module.exports = {
  LAYOUT_FORMAT_VERSION,
  LAYOUT_IDENTITY_STORAGE_KEY,
  LAYOUT_STORAGE_KEY,
  OWNED_STORAGE_KEYS,
  paneReplacement,
  restoreLayout,
  serializeLayout,
};
