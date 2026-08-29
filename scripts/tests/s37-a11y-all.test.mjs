/**
 * S37-WP02/WP03 — accessibility and localization tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const a11y = await src("a11yLocalization.js");

test("S37-WP02 all four keyboard journeys complete without pointer input", () => {
  for (const journey of a11y.KEYBOARD_JOURNEYS) {
    const done = a11y.keyboardJourney(journey, [{ step: "focus-list" }, { step: "enter" }, { step: "confirm" }]);
    assert.equal(done.completedKeyboardOnly, true, journey);
  }
  assert.equal(
    a11y.keyboardJourney("approval", [{ step: "focus" }, { step: "click", pointer: true }]).completedKeyboardOnly,
    false,
  );
  assert.throws(() => a11y.keyboardJourney("mouse-only-tour", []), /unknown_journey/);
});

test("S37-WP02 screen-reader and visual-check coverage is complete across supported OSes", () => {
  const coverage = a11y.a11yCoverage([...a11y.A11Y_CHECKS]);
  assert.deepEqual(coverage.readers.map((r) => r.reader).sort(), ["nvda", "orca-at-spi", "voiceover"]);
  assert.equal(coverage.complete, true);
  const gaps = a11y.a11yCoverage(["zoom-200", "focus-order"]);
  assert.equal(gaps.complete, false);
  assert.ok(gaps.missing.includes("reduced-motion"));
  assert.equal(a11y.A11Y_CHECKS.length, 8);
});

test("S37-WP02 P0/P1 defects block; P2/P3 carry owners and release decisions", () => {
  const blocked = a11y.defectGate([
    { id: "d1", severity: "P0" },
    { id: "d2", severity: "P1" },
    { id: "d3", severity: "P2" },
  ]);
  assert.equal(blocked.p0p1Count, 2);
  assert.equal(blocked.verdict, "a11y-blocked");
  const passing = a11y.defectGate([{ id: "d3", severity: "P3", owner: "a11y-lead" }]);
  assert.equal(passing.verdict, "a11y-pass");
  assert.equal(passing.tracked[0].releaseDecision, "owner-and-decision-required");
});

test("S37-WP03 locale completeness demands zh/en parity and translated security decisions", () => {
  const complete = a11y.localeCompleteness(
    { en: ["goal.title", "approval.danger"], zh: ["goal.title", "approval.danger"] },
    ["approval.danger"],
  );
  assert.equal(complete.complete, true);
  assert.equal(complete.untranslatedSecurityDecisions.length, 0);
  const broken = a11y.localeCompleteness({ en: ["goal.title", "approval.danger"], zh: ["goal.title"] }, [
    "approval.danger",
  ]);
  assert.equal(broken.complete, false);
  assert.deepEqual([...broken.missingZh], ["approval.danger"]);
  assert.deepEqual([...broken.untranslatedSecurityDecisions], ["approval.danger"]);
});

test("S37-WP03 pseudo-localization expansion exposes clipped labels", () => {
  const pseudo = a11y.pseudoLocalize("Approve");
  assert.ok(pseudo.length > "Approve".length);
  const fits = a11y.pseudoExpansionCheck("Approve edit", "Approve edit - long enough");
  assert.equal(fits.fitsBudget, true);
  const clipped = a11y.pseudoExpansionCheck("Approve edit with a very long label", "Appro…");
  assert.equal(clipped.clipped, true);
  assert.equal(clipped.fitsBudget, false);
});

test("S37-WP03 formatting, IME and shortcut contracts hold per locale", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const contract = a11y.formattingContract(locale);
    assert.equal(contract.imeCompositionSafe, true);
    assert.equal(contract.shortcutLabelsLocalized, true);
    assert.equal(contract.localeDependentParserBehavior, false);
    assert.ok(contract.pluralRules.type === "cardinal" || typeof contract.pluralRules.type === "string");
  }
});

test("S37-WP03 the glossary fixes Goal/Task/Run/Realm/Worktree/Evidence meanings", () => {
  assert.deepEqual(Object.keys(a11y.GLOSSARY), ["Goal", "Task", "Run", "Realm", "Worktree", "Evidence"]);
  for (const term of Object.values(a11y.GLOSSARY)) {
    assert.ok(term.en.length > 0);
    assert.ok(term.zh.length > 0);
  }
});
