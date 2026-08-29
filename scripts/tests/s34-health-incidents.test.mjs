/**
 * S34-WP04/S34-WP05 — Vital Bar, incident UX and immune controls tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const health = await src("healthMonitor.js");

test("S34-WP04 every vital signal classifies into H0-H4; unknown signals fail closed", () => {
  assert.equal(health.VITAL_SIGNALS.length, 11);
  for (const signal of health.VITAL_SIGNALS) {
    const incident = health.classifyIncident(signal);
    assert.ok(health.HEALTH_SEVERITIES.includes(incident.severity), signal);
  }
  assert.equal(health.classifyIncident("egress-alarm").severity, "H0");
  assert.equal(health.classifyIncident("secret-alarm").severity, "H0");
  assert.equal(health.classifyIncident("degraded-model").severity, "H4");
  assert.throws(() => health.classifyIncident("vibes-off"), /unknown_vital_signal:vibes-off/);
});

test("S34-WP04 incidents carry detect/contain/repair/verify/escalate phases and verified repair", () => {
  const lifecycle = health.incidentLifecycle("core-crash-loop", {
    detectedAt: 1,
    containedAt: 2,
    repairedAt: 3,
    verifiedAt: 4,
    escalatedAt: 5,
  });
  assert.equal(lifecycle.phases.detectedAt, 1);
  assert.equal(lifecycle.phases.containedAt, 2);
  assert.equal(lifecycle.repairVerified, true);
  assert.equal(lifecycle.escalate, true);
  const unrepaired = health.incidentLifecycle("sync-failure", { detectedAt: 1, containedAt: 2 });
  assert.equal(unrepaired.repairVerified, false);
  assert.equal(unrepaired.escalate, false);
  assert.throws(() => health.incidentLifecycle("sync-failure", { detectedAt: 1 }), /containment_before_anything_else/);
});

test("S34-WP04 low severity is quiet; serious events show impact, action, risk and choices", () => {
  const quiet = health.incidentPresentation("degraded-model");
  assert.equal(quiet.mode, "quiet");
  assert.equal(quiet.shown, false);
  const serious = health.incidentPresentation("egress-alarm");
  assert.equal(serious.mode, "visible");
  assert.equal(serious.shown, true);
  assert.match(serious.automaticAction, /contain-egress-alarm/);
  assert.ok(serious.userChoices.includes("request-support-bundle"));
});

test("S34-WP04 support bundles are redaction-first and export only after user review", () => {
  const bundle = health.supportBundle(
    { incident: "egress-alarm", rawDiagnostics: "AWS_KEY=AKIA...", secretsStripped: false },
    { userReviewed: false },
  );
  assert.equal(bundle.bundle.secretsStripped, true);
  assert.equal(bundle.bundle.sourceRedacted, true);
  assert.equal(bundle.bundle.metadataFirst, true);
  assert.equal(bundle.bundle.rawDiagnostics, undefined);
  assert.equal(bundle.exportState.exported, false);
  const approved = health.supportBundle({ incident: "x" }, { userReviewed: true });
  assert.equal(approved.exportState.exported, true);
});

test("S34-WP05 supervisor immune controls need no model approval", () => {
  for (const control of health.IMMUNE_CONTROLS) {
    const result = health.immuneControl(control);
    assert.equal(result.modelApprovalRequired, false);
    assert.equal(result.supervisorAuthority, true);
  }
  assert.equal(health.IMMUNE_CONTROLS.includes("exit-safe-mode"), false);
  assert.throws(() => health.immuneControl("ask-model-then-maybe-stop"), /unknown_immune_control/);
});

test("S34-WP05 the agent cannot suppress health events, edit audit history or exit safe mode", () => {
  for (const action of ["suppress-health-event", "edit-audit-history", "exit-safe-mode"]) {
    const attempt = health.agentHealthAttempt(action);
    assert.equal(attempt.allowed, false);
  }
  assert.equal(health.agentHealthAttempt("report-signal").allowed, true);
  assert.throws(() => health.agentHealthAttempt("do-anything"), /unknown_agent_health_action/);
});

test("S34-WP05 safe mode entry is supervisor-driven; exit needs external authority", () => {
  const enter = health.safeModeTransition("normal", "safe-mode", "supervisor");
  assert.equal(enter.allowed, true);
  const agentExit = health.safeModeTransition("safe-mode", "normal", "agent");
  assert.equal(agentExit.allowed, false);
  assert.match(agentExit.reason, /external human\/admin\/vendor authority/);
  const adminExit = health.safeModeTransition("safe-mode", "normal", "human-admin");
  assert.equal(adminExit.allowed, true);
  const vendorExit = health.safeModeTransition("safe-mode", "normal", "vendor-with-evidence");
  assert.equal(vendorExit.allowed, true);
});

test("S34-WP05 the circuit breaker bounds inflammatory crash loops", () => {
  const closed = health.circuitBreaker(2, 3);
  assert.equal(closed.state, "closed");
  assert.equal(closed.retriesRemaining, 1);
  const open = health.circuitBreaker(3, 3);
  assert.equal(open.state, "open");
  assert.equal(open.retriesRemaining, 0);
  assert.equal(open.inflammatoryLoop, false);
});
