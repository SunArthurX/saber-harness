/**
 * S34-WP06 — Game day tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const gameDay = await src("gameDay.js");
const health = await src("healthMonitor.js");

test("S34-WP06 all six scenarios exist with bounded containment", () => {
  assert.deepEqual(
    [...gameDay.SCENARIOS],
    [
      "plugin-crash-loop",
      "poisoned-candidate",
      "sandbox-escape-signal",
      "provider-misroute",
      "corrupt-index",
      "bad-update-candidate",
    ],
  );
  for (const scenario of gameDay.SCENARIOS) {
    const result = gameDay.runScenario(scenario);
    assert.equal(result.injected, true);
    assert.equal(result.containmentBounded, true);
    assert.equal(result.evidencePreserved, true);
    assert.ok(result.recoveredTo.length > 0);
  }
  assert.throws(() => gameDay.runScenario("zombie-apocalypse"), /unknown_game_day_scenario/);
});

test("S34-WP06 game day proves last-known-good or safe-mode recovery and escalation", () => {
  const drill = gameDay.runGameDay();
  assert.equal(drill.scenarios.length, 6);
  assert.equal(drill.boundedContainment, true);
  assert.equal(drill.recoveredToLastKnownGoodOrSafeMode, true);
  assert.equal(drill.evidencePreserved, true);
  assert.equal(drill.correctEscalation, true);
  assert.equal(drill.verdict, "game-day-passed");
});

test("S34-WP06 containment outranks the agent brain in every scenario", () => {
  const drill = gameDay.runGameDay();
  for (const scenario of drill.scenarios) {
    assert.equal(scenario.agentBrainConsultedBeforeContainment, false, scenario.scenario);
    assert.equal(scenario.supervisorActedWithoutModelApproval, true, scenario.scenario);
  }
});

test("S34-WP06 scenario mappings use real vital signals", () => {
  for (const scenario of gameDay.SCENARIOS) {
    assert.ok(health.VITAL_SIGNALS.includes(gameDay.PLAYBOOK[scenario].signal), scenario);
  }
  assert.equal(gameDay.PLAYBOOK["sandbox-escape-signal"].recoveredTo, "safe-mode");
  assert.equal(gameDay.PLAYBOOK["corrupt-index"].recoveredTo, "deterministic-rebuild");
  assert.equal(gameDay.PLAYBOOK["provider-misroute"].signal, "egress-alarm");
});

test("S34-WP06 evidence from drills is append-only; wiping fails closed", () => {
  const log = gameDay.preserveEvidence([]);
  assert.equal(log.appendOnly, true);
  assert.equal(log.entries, 1);
  assert.throws(() => gameDay.preserveEvidence([], "wipe"), /evidence_log_is_append_only/);
});
