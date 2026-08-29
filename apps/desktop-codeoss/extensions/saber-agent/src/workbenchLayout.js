/**
 * S28-WP01 — workbench layout tokens and pane lattice.
 *
 * Pure layout math for the three-zone Desktop Agent Workbench: safe
 * states, pane min/max ownership, keyboard splitter movement, default
 * reset, the named Focus/Build/Review/Team presets and the
 * Workspace/Task/Realm Layout Receipt that binds the lattice to the
 * visible Realm and revision identity (CDX-01, CLD-01, ZCD-01, CUR-05,
 * DSH-05). The module owns no workbench state and renders nothing: the
 * native Code-OSS workbench is the only renderer, and every custom theme
 * token carries light/dark/high-contrast values plus reduced-motion
 * behavior so the lattice stays accessible in all three themes.
 */

/** Layout format version — stored separately from authoritative state (S28-WP05). */
const LAYOUT_FORMAT_VERSION = 1;

/** Safe states: minimum 1280px full lattice, compact 900px, narrow stack below. */
const SAFE_STATES = Object.freeze({
  minimum: Object.freeze({ minWidthPx: 1280, behavior: "full-lattice" }),
  compact: Object.freeze({ minWidthPx: 900, behavior: "compact-lattice" }),
  narrow: Object.freeze({ minWidthPx: 0, behavior: "narrow-stack" }),
});

/** The six owned regions and their owners (S28-WP01 zone ownership). */
const REGIONS = Object.freeze({
  "primary-sidebar": Object.freeze({ role: "navigation", owner: "workbench" }),
  "agent-pane": Object.freeze({ role: "main", owner: "workbench" }),
  editor: Object.freeze({ role: "region", owner: "code-oss-native" }),
  "secondary-sidebar": Object.freeze({ role: "complementary", owner: "workbench" }),
  "bottom-panel": Object.freeze({ role: "region", owner: "code-oss-native" }),
  "evidence-drawer": Object.freeze({ role: "region", owner: "workbench" }),
  "vital-bar": Object.freeze({ role: "status", owner: "workbench" }),
});

/**
 * Pane width bounds in px. `max: null` means unbounded (the editor grows
 * with the window); every bounded pane clamps inside [min, max].
 */
const PANE_LIMITS = Object.freeze({
  "primary-sidebar": Object.freeze({ min: 170, max: 520 }),
  "agent-pane": Object.freeze({ min: 320, max: 900 }),
  editor: Object.freeze({ min: 380, max: null }),
  "secondary-sidebar": Object.freeze({ min: 220, max: 560 }),
  "bottom-panel": Object.freeze({ min: 160, max: 640 }),
  "evidence-drawer": Object.freeze({ min: 240, max: 720 }),
});

/** Keyboard splitter movement steps (px): small for arrows, large for Shift+arrows. */
const SPLITTER_STEPS = Object.freeze({ small: 16, large: 64 });

/** Default lattice — the Team preset (all zones visible). */
const DEFAULT_LAYOUT = Object.freeze({
  version: LAYOUT_FORMAT_VERSION,
  preset: "team",
  safeState: "minimum",
  panes: Object.freeze({
    "primary-sidebar": 260,
    "agent-pane": 480,
    "secondary-sidebar": 300,
    "bottom-panel": 240,
    "evidence-drawer": 320,
  }),
});

/** Named presets (CDX-01, CLD-01, ZCD-01). */
const PRESETS = Object.freeze({
  focus: Object.freeze({
    "primary-sidebar": 190,
    "agent-pane": 720,
    "secondary-sidebar": 220,
    "bottom-panel": 160,
    "evidence-drawer": 240,
  }),
  build: Object.freeze({
    "primary-sidebar": 220,
    "agent-pane": 560,
    "secondary-sidebar": 300,
    "bottom-panel": 400,
    "evidence-drawer": 320,
  }),
  review: Object.freeze({
    "primary-sidebar": 190,
    "agent-pane": 520,
    "secondary-sidebar": 300,
    "bottom-panel": 240,
    "evidence-drawer": 640,
  }),
  team: DEFAULT_LAYOUT.panes,
});

/**
 * Custom theme tokens. Every token carries light, dark and
 * high-contrast values (S28-WP01); REDUCED_MOTION describes the
 * reduced-motion behavior for every animated lattice transition.
 */
const THEME_TOKENS = Object.freeze({
  "pane.border": Object.freeze({ light: "#c8c8c8", dark: "#2b2b2b", highContrast: "#ffffff" }),
  "focus.ring": Object.freeze({ light: "#005fb8", dark: "#3794ff", highContrast: "#ffff00" }),
  "identity.badge": Object.freeze({ light: "#005fb8", dark: "#3794ff", highContrast: "#ffff00" }),
  "vital.bar": Object.freeze({ light: "#005fb8", dark: "#3794ff", highContrast: "#ffff00" }),
  "pane.surface": Object.freeze({ light: "#ffffff", dark: "#1e1e1e", highContrast: "#000000" }),
  "pane.foreground": Object.freeze({ light: "#1f1f1f", dark: "#cccccc", highContrast: "#ffffff" }),
});

/** Reduced-motion contract: lattice transitions animate only when allowed. */
const REDUCED_MOTION = Object.freeze({
  splitterAnimation: "none",
  presetTransition: "none",
  announcementPoliteness: "polite",
});

/** Resolve the safe state for a window width. */
function resolveSafeState(widthPx) {
  if (widthPx >= SAFE_STATES.minimum.minWidthPx) {
    return "minimum";
  }
  if (widthPx >= SAFE_STATES.compact.minWidthPx) {
    return "compact";
  }
  return "narrow";
}

/** Clamp a pane width into its [min, max] bounds. */
function clampPane(paneId, widthPx) {
  const limits = PANE_LIMITS[paneId];
  if (!limits) {
    return null;
  }
  const lower = Math.max(limits.min, Math.round(widthPx));
  return limits.max === null ? lower : Math.min(limits.max, lower);
}

/** Deep-freeze a plain layout object without mutating the input. */
function frozenLayout(preset, safeState, panes) {
  return Object.freeze({
    version: LAYOUT_FORMAT_VERSION,
    preset,
    safeState,
    panes: Object.freeze(panes),
  });
}

/**
 * Move a pane splitter by a keyboard delta and return the new layout.
 * Unbounded maxima still clamp at a practical ceiling (the delta can
 * never push a pane past 4096px, so one pane cannot consume the window).
 */
function moveSplitter(layout, paneId, deltaPx, windowWidthPx = 1280) {
  const base = layout ?? DEFAULT_LAYOUT;
  const limits = PANE_LIMITS[paneId];
  if (!limits) {
    throw new Error(`unknown_pane:${paneId}`);
  }
  const ceiling = limits.max ?? Math.max(limits.min, Math.min(4096, windowWidthPx));
  const current = base.panes[paneId] ?? limits.min;
  const next = Math.min(Math.max(current + deltaPx, limits.min), ceiling);
  const panes = { ...base.panes, [paneId]: next };
  return frozenLayout(base.preset, resolveSafeState(windowWidthPx), panes);
}

/** Apply a named preset, clamped into bounds, at the given window width. */
function applyPreset(_layout, preset, windowWidthPx = 1280) {
  const panes = PRESETS[preset];
  if (!panes) {
    throw new Error(`unknown_preset:${preset}`);
  }
  const clamped = {};
  for (const [paneId, width] of Object.entries(panes)) {
    const value = clampPane(paneId, width);
    if (value !== null) {
      clamped[paneId] = value;
    }
  }
  return frozenLayout(preset, resolveSafeState(windowWidthPx), clamped);
}

/** Reset to the default lattice (user-reachable default reset, S28-WP01). */
function resetLayout(windowWidthPx = 1280) {
  return applyPreset(DEFAULT_LAYOUT, "team", windowWidthPx);
}

/**
 * Workspace/Task/Realm Layout Receipt (CDX-01): an immutable record of
 * which lattice was applied under which identity and revision, so layout
 * and identity can be audited together (CUR-05, DSH-05).
 */
function layoutReceipt(layout, identity, revision, issuedAtMs) {
  const base = layout ?? DEFAULT_LAYOUT;
  return Object.freeze({
    formatVersion: LAYOUT_FORMAT_VERSION,
    workspaceId: identity?.workspaceId ?? null,
    taskId: identity?.taskId ?? null,
    realmId: identity?.realmId ?? null,
    revision: revision ?? null,
    preset: base.preset,
    safeState: base.safeState,
    panes: base.panes,
    issuedAtMs,
  });
}

module.exports = {
  DEFAULT_LAYOUT,
  LAYOUT_FORMAT_VERSION,
  PANE_LIMITS,
  PRESETS,
  REDUCED_MOTION,
  REGIONS,
  SAFE_STATES,
  SPLITTER_STEPS,
  THEME_TOKENS,
  applyPreset,
  clampPane,
  layoutReceipt,
  moveSplitter,
  resetLayout,
  resolveSafeState,
};
