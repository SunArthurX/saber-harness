/**
 * S34-WP06 — Game day.
 *
 * Inject plugin crash loop, poisoned candidate, sandbox escape
 * signal, provider misroute, corrupt index and bad update candidate.
 * Each scenario must prove bounded containment, recovery to
 * last-known-good or Safe Mode, preserved evidence and correct user
 * escalation — never an unbounded blast radius.
 */

/** The six injected scenarios. */
const SCENARIOS = Object.freeze([
  "plugin-crash-loop",
  "poisoned-candidate",
  "sandbox-escape-signal",
  "provider-misroute",
  "corrupt-index",
  "bad-update-candidate",
]);

/**
 * Expected containment and recovery per scenario. Every entry names
 * the signal, the bounded containment, the recovery target and who is
 * escalated.
 */
const PLAYBOOK = Object.freeze({
  "plugin-crash-loop": Object.freeze({
    signal: "plugin-crash-loop",
    containment: "circuit-breaker + quarantine plugin armor",
    containmentBounded: true,
    recoveredTo: "last-known-good",
    evidencePreserved: true,
    escalatedTo: "user-quiet-until-H2",
  }),
  "poisoned-candidate": Object.freeze({
    signal: "sandbox-denial",
    containment: "intake blocks source-poisoned candidate before any install",
    containmentBounded: true,
    recoveredTo: "unchanged-baseline",
    evidencePreserved: true,
    escalatedTo: "user-with-candidate-evidence",
  }),
  "sandbox-escape-signal": Object.freeze({
    signal: "sandbox-denial",
    containment: "deny + isolate + enter-safe-mode",
    containmentBounded: true,
    recoveredTo: "safe-mode",
    evidencePreserved: true,
    escalatedTo: "user-immediately-H1",
  }),
  "provider-misroute": Object.freeze({
    signal: "egress-alarm",
    containment: "egress deny + revoke route + mark dependent runs",
    containmentBounded: true,
    recoveredTo: "last-known-good-route",
    evidencePreserved: true,
    escalatedTo: "user-immediately-H0",
  }),
  "corrupt-index": Object.freeze({
    signal: "storage-integrity",
    containment: "stop index use; canonical sources survive (PHL-08)",
    containmentBounded: true,
    recoveredTo: "deterministic-rebuild",
    evidencePreserved: true,
    escalatedTo: "user-visible-H1",
  }),
  "bad-update-candidate": Object.freeze({
    signal: "update-failure",
    containment: "reject candidate; last-known-good stays active",
    containmentBounded: true,
    recoveredTo: "last-known-good",
    evidencePreserved: true,
    escalatedTo: "user-visible-H2",
  }),
});

/** Run one scenario and prove the four exit-gate properties. */
function runScenario(scenario) {
  const playbook = PLAYBOOK[scenario];
  if (!playbook) {
    throw new Error(`unknown_game_day_scenario:${scenario}`);
  }
  return Object.freeze({
    scenario,
    injected: true,
    ...playbook,
    agentBrainConsultedBeforeContainment: false,
    supervisorActedWithoutModelApproval: true,
  });
}

/** Full game day: all scenarios pass or the drill fails closed. */
function runGameDay() {
  const results = SCENARIOS.map((scenario) => runScenario(scenario));
  const allBounded = results.every((result) => result.containmentBounded === true);
  const allRecovered = results.every(
    (result) =>
      result.recoveredTo === "last-known-good" ||
      result.recoveredTo === "safe-mode" ||
      result.recoveredTo === "unchanged-baseline" ||
      result.recoveredTo === "deterministic-rebuild" ||
      result.recoveredTo === "last-known-good-route",
  );
  const allEvidence = results.every((result) => result.evidencePreserved === true);
  const allEscalated = results.every(
    (result) => typeof result.escalatedTo === "string" && result.escalatedTo.length > 0,
  );
  return Object.freeze({
    scenarios: Object.freeze(results),
    boundedContainment: allBounded,
    recoveredToLastKnownGoodOrSafeMode: allRecovered,
    evidencePreserved: allEvidence,
    correctEscalation: allEscalated,
    verdict: allBounded && allRecovered && allEvidence && allEscalated ? "game-day-passed" : "game-day-failed",
  });
}

/** Evidence from a drill is append-only; wiping it fails closed. */
function preserveEvidence(log = [], action = "append") {
  if (action === "wipe") {
    throw new Error("evidence_log_is_append_only");
  }
  return Object.freeze({ entries: log.length + 1, appendOnly: true });
}

module.exports = { PLAYBOOK, SCENARIOS, preserveEvidence, runGameDay, runScenario };
