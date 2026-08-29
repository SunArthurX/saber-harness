/**
 * S28-WP06 — workbench accessibility and UX acceptance tests.
 *
 * Keyboard path completeness, landmark/live-region contracts, WCAG
 * contrast on the theme tokens, 200% zoom reflow, zh/en localization
 * parity, long-path truncation, pointer targets and reduced motion.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const a11y = await src("a11yAudit.js");
const layout = await src("workbenchLayout.js");

const extensionRoot = join(root, "apps/desktop-codeoss/extensions/saber-agent");
const manifest = JSON.parse(readFileSync(join(extensionRoot, "package.json"), "utf8"));
const english = JSON.parse(readFileSync(join(extensionRoot, "package.nls.json"), "utf8"));
const chinese = JSON.parse(readFileSync(join(extensionRoot, "package.nls.zh-cn.json"), "utf8"));

test("S28-WP06 the full keyboard path is bound to contributed commands", () => {
  const commands = manifest.contributes.commands.map((command) => command.command);
  const audit = a11y.auditKeyboardPath(commands);
  assert.equal(audit.complete, true, `missing steps: ${audit.missing.join(", ")}`);
  assert.deepEqual(
    a11y.KEYBOARD_PATH.map((step) => step.step),
    [
      "open-repository",
      "select-task",
      "focus-conversation",
      "focus-editor",
      "open-terminal",
      "open-evidence",
      "return-focus",
    ],
  );
});

test("S28-WP06 landmarks cover every owned region with correct roles", () => {
  for (const region of Object.keys(layout.REGIONS)) {
    assert.ok(a11y.LANDMARKS[region], `landmark for ${region}`);
  }
  assert.equal(a11y.LANDMARKS["primary-sidebar"], "navigation");
  assert.equal(a11y.LANDMARKS["agent-pane"], "main");
  assert.equal(a11y.LANDMARKS["vital-bar"], "status");
});

test("S28-WP06 live regions announce state changes without streaming noise", () => {
  assert.equal(a11y.LIVE_REGIONS["vital-bar"].politeness, "polite");
  assert.equal(a11y.LIVE_REGIONS["vital-bar"].announce, "state-changes-only");
  assert.equal(a11y.LIVE_REGIONS["agent-pane"].announce, "none-while-streaming");
});

test("S28-WP06 WCAG contrast holds for audited token pairs in all themes", () => {
  // Known-answer check for the ratio implementation (WCAG black/white = 21).
  assert.ok(Math.abs(a11y.contrastRatio("#000000", "#ffffff") - 21) < 0.01);
  const failures = a11y.auditContrast();
  assert.deepEqual(failures, [], `contrast failures: ${JSON.stringify(failures)}`);
});

test("S28-WP06 200% zoom reflow keeps panes legal or stacks safely", () => {
  const at200 = a11y.auditZoom(2560, 200);
  assert.equal(at200.cssWidth, 1280);
  assert.equal(at200.safeState, "compact");
  assert.equal(at200.reflows, true);
  assert.equal(at200.sideBySideFits, true);
  const narrow = a11y.auditZoom(900, 200);
  assert.equal(narrow.safeState, "narrow");
  assert.equal(narrow.reflows, true, "narrow state stacks instead of overflowing");
  const sideBySide = Object.values(at200.minimumPaneWidths).length > 0;
  assert.ok(sideBySide, "minimum pane widths are part of the audit");
});

test("S28-WP06 long paths truncate in the middle, keeping both ends", () => {
  const longPath = "/Users/someone/very/deeply/nested/project/structure/src/components/panel/file.tsx";
  const truncated = a11y.truncationMiddle(longPath, 32);
  assert.ok(truncated.length <= 32);
  assert.ok(truncated.startsWith("/Users"));
  assert.ok(truncated.endsWith(".tsx"));
  assert.ok(truncated.includes("…"));
  assert.equal(a11y.truncationMiddle("/short/path.ts", 32), "/short/path.ts");
});

test("S28-WP06 Chinese and English string tables keep parity", () => {
  const parity = a11y.auditLocalizationParity(Object.keys(english), Object.keys(chinese));
  assert.equal(parity.parity, true, `parity gaps: ${JSON.stringify(parity)}`);
  for (const command of manifest.contributes.commands) {
    assert.ok(command.title.startsWith("%") && command.title.endsWith("%"), `localized title for ${command.command}`);
  }
});

test("S28-WP06 pointer targets, focus ring and reduced motion are contracted", () => {
  assert.ok(a11y.POINTER_TARGET_MIN_PX >= 24);
  assert.equal(a11y.FOCUS_RING_TOKEN, "focus.ring");
  assert.ok(layout.THEME_TOKENS[a11y.FOCUS_RING_TOKEN]);
  assert.equal(layout.REDUCED_MOTION.presetTransition, "none");
  assert.equal(layout.REDUCED_MOTION.splitterAnimation, "none");
});
