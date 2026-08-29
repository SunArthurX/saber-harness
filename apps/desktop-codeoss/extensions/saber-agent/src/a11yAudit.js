/**
 * S28-WP06 — accessibility and UX acceptance contract.
 *
 * Pure descriptors and audits for the workbench shell: the full keyboard
 * path, landmark and live-region rules, 200% zoom reflow, WCAG contrast
 * on the theme tokens, Chinese/English string parity, long-path
 * truncation, pointer targets, focus ring and reduced-motion behavior.
 * The extension registers the described keybindings and roles; the tests
 * assert the contract so the shipped manifest cannot drift from the
 * audited path (ZCD-01 keyboard lattice, S28-WP06).
 */

const { PANE_LIMITS, REGIONS, SAFE_STATES, THEME_TOKENS } = require("./workbenchLayout.js");

/** The full keyboard path — every step must have a bound command. */
const KEYBOARD_PATH = Object.freeze([
  Object.freeze({ step: "open-repository", command: "saber.workbench.openRepository" }),
  Object.freeze({ step: "select-task", command: "saber.workbench.selectTask" }),
  Object.freeze({ step: "focus-conversation", command: "saber.workbench.focusConversation" }),
  Object.freeze({ step: "focus-editor", command: "saber.workbench.focusEditor" }),
  Object.freeze({ step: "open-terminal", command: "saber.workbench.openTerminal" }),
  Object.freeze({ step: "open-evidence", command: "saber.workbench.openEvidence" }),
  Object.freeze({ step: "return-focus", command: "saber.workbench.returnFocus" }),
]);

/** Landmark role per region (screen-reader navigation). */
const LANDMARKS = Object.freeze(Object.fromEntries(Object.entries(REGIONS).map(([region, def]) => [region, def.role])));

/**
 * Live regions: the Vital Bar announces state changes politely; the
 * agent pane never streams token noise into the live region.
 */
const LIVE_REGIONS = Object.freeze({
  "vital-bar": Object.freeze({ politeness: "polite", announce: "state-changes-only" }),
  "agent-pane": Object.freeze({ politeness: "polite", announce: "none-while-streaming" }),
});

/** Minimum pointer target in px (comfortable touch/pointer operation). */
const POINTER_TARGET_MIN_PX = 24;

/** The token that draws the visible focus ring. */
const FOCUS_RING_TOKEN = "focus.ring";

/** Middle truncation for long paths (keeps filename and root). */
function truncationMiddle(value, maxLength = 48) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }
  const keep = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, keep)}…${text.slice(text.length - keep)}`;
}

/** Relative luminance of an sRGB hex color (WCAG 2.x definition). */
function relativeLuminance(hex) {
  const value = String(hex ?? "").replace("#", "");
  if (value.length !== 6) {
    return null;
  }
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio between two hex colors; null when unparsable. */
function contrastRatio(foreground, background) {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  if (l1 === null || l2 === null) {
    return null;
  }
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Audited foreground/background token pairs (≥ 4.5 required). */
const CONTRAST_PAIRS = Object.freeze([
  Object.freeze({ token: "pane.foreground", background: "pane.surface", minimum: 4.5 }),
  Object.freeze({ token: "focus.ring", background: "pane.surface", minimum: 3 }),
  Object.freeze({ token: "identity.badge", background: "pane.surface", minimum: 3 }),
  Object.freeze({ token: "vital.bar", background: "pane.surface", minimum: 3 }),
]);

/** Audit all contrast pairs in every theme; returns failures only. */
function auditContrast() {
  const failures = [];
  for (const theme of ["light", "dark", "highContrast"]) {
    for (const pair of CONTRAST_PAIRS) {
      const foreground = THEME_TOKENS[pair.token]?.[theme];
      const background = THEME_TOKENS[pair.background]?.[theme];
      const ratio = contrastRatio(foreground, background);
      if (ratio === null || ratio < pair.minimum) {
        failures.push({ theme, pair, ratio });
      }
    }
  }
  return failures;
}

/**
 * 200% zoom reflow audit: at 200% the effective CSS width halves, so the
 * lattice must still resolve a safe state and keep every visible pane at
 * or above its minimum width (or reflow to the compact/narrow stack).
 */
function auditZoom(windowWidthPx, zoomPercent = 200) {
  const cssWidth = Math.floor((windowWidthPx * 100) / zoomPercent);
  const safeState = SAFE_STATES.compact.minWidthPx <= cssWidth ? "compact" : "narrow";
  const compactCapable = cssWidth >= SAFE_STATES.compact.minWidthPx;
  const minimumPaneWidths = Object.fromEntries(
    Object.entries(PANE_LIMITS).map(([paneId, limits]) => [paneId, limits.min]),
  );
  const sideBySideMinimum = PANE_LIMITS["primary-sidebar"].min + PANE_LIMITS["agent-pane"].min + PANE_LIMITS.editor.min;
  return Object.freeze({
    cssWidth,
    safeState,
    reflows: compactCapable || safeState === "narrow",
    sideBySideMinimum,
    sideBySideFits: cssWidth >= sideBySideMinimum,
    minimumPaneWidths: Object.freeze(minimumPaneWidths),
  });
}

/** Audit that every keyboard-path step has a contributed command. */
function auditKeyboardPath(contributedCommands) {
  const available = new Set(contributedCommands);
  const missing = KEYBOARD_PATH.filter((step) => !available.has(step.command)).map((step) => step.step);
  return Object.freeze({ missing, complete: missing.length === 0 });
}

/** Audit zh/en localization parity between two nls string tables. */
function auditLocalizationParity(englishKeys, chineseKeys) {
  const en = new Set(englishKeys);
  const zh = new Set(chineseKeys);
  const missingChinese = [...en].filter((key) => !zh.has(key));
  const missingEnglish = [...zh].filter((key) => !en.has(key));
  return Object.freeze({
    missingChinese,
    missingEnglish,
    parity: missingChinese.length === 0 && missingEnglish.length === 0,
  });
}

module.exports = {
  CONTRAST_PAIRS,
  FOCUS_RING_TOKEN,
  KEYBOARD_PATH,
  LANDMARKS,
  LIVE_REGIONS,
  POINTER_TARGET_MIN_PX,
  auditContrast,
  auditKeyboardPath,
  auditLocalizationParity,
  auditZoom,
  contrastRatio,
  relativeLuminance,
  truncationMiddle,
};
