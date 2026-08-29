/**
 * S38-WP05/WP06 — privacy closeout, governance review and the
 * production decision tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const decision = await src("productionDecision.js");

function packetInput(overrides = {}) {
  return {
    "signed-artifact-provenance": [{ platform: "macos", sha256: "a".repeat(64) }],
    "s37-readiness-digest": "gate-abc",
    "design-partner-kpis": { completionRate: 0.9 },
    "open-findings": [],
    rollback: { strategy: "ring-demotion" },
    "support-coverage": "complete",
    "accountable-approvals": [
      { role: "lead", id: "a1" },
      { role: "security", id: "a2" },
    ],
    approved: true,
    ...overrides,
  };
}

test("S38-WP05 privacy closeout covers eight checks", () => {
  assert.equal(decision.PRIVACY_CHECKS.length, 8);
  const complete = decision.privacyCloseout([...decision.PRIVACY_CHECKS]);
  assert.equal(complete.complete, true);
  const partial = decision.privacyCloseout(["opt-in-telemetry", "export"]);
  assert.equal(partial.complete, false);
  assert.ok(partial.missing.includes("dsr-workflow"));
});

test("S38-WP05 governance review requires independent owners", () => {
  const independent = decision.governanceReview([
    { area: "enterprise-policy", owner: "sec-lead", implementer: "platform-eng", independent: true },
    { area: "model-destination", owner: "privacy-lead", implementer: "runtime-eng", independent: true },
    { area: "plugin-registry", owner: "supply-chain", implementer: "platform-eng", independent: true },
    { area: "break-glass-audit", owner: "audit-lead", implementer: "security-eng", independent: true },
  ]);
  assert.equal(independent.allIndependent, true);
  const selfReviewed = decision.governanceReview([
    { area: "enterprise-policy", owner: "platform-eng", implementer: "platform-eng", independent: true },
    { area: "model-destination", owner: "privacy-lead", implementer: "runtime-eng", independent: true },
    { area: "plugin-registry", owner: "supply-chain", implementer: "platform-eng", independent: true },
    { area: "break-glass-audit", owner: "audit-lead", implementer: "security-eng", independent: true },
  ]);
  assert.equal(selfReviewed.allIndependent, false);
});

test("S38-WP06 the release packet requires seven contents", () => {
  assert.equal(decision.PACKET_CONTENTS.length, 7);
  assert.throws(() => decision.releasePacket(packetInput({ rollback: undefined })), /packet_incomplete:rollback/);
});

test("S38-WP06 unresolved P0/P1 findings block the production decision", () => {
  const blocked = decision.releasePacket(
    packetInput({ "open-findings": [{ id: "F1", severity: "P0", detail: "uncontained threat" }] }),
  );
  assert.equal(blocked.decision, "blocked");
  assert.equal(blocked.blockers.length, 1);
  assert.equal(blocked.packet, null);
});

test("S38-WP06 approval yields a bounded rollout that keeps monitoring and rollback", () => {
  const approved = decision.releasePacket(packetInput());
  assert.equal(approved.decision, "bounded-rollout-approved");
  assert.equal(approved.monitoringRemoved, false);
  assert.equal(approved.rollbackRemoved, false);
  assert.match(approved.packet.digest, /^packet-/);
  assert.equal(approved.packet.s37ReadinessDigest, "gate-abc");
  const deterministic = decision.releasePacket(packetInput());
  assert.equal(deterministic.packet.digest, approved.packet.digest);
});

test("S38-WP06 critical security exceptions need dual approval", () => {
  const single = decision.criticalExceptionApproval([{ id: "a1" }]);
  assert.equal(single.approved, false);
  assert.match(single.rule, /no one-person approval/);
  const dual = decision.criticalExceptionApproval([{ id: "a1" }, { id: "a2" }]);
  assert.equal(dual.approved, true);
  const samePerson = decision.criticalExceptionApproval([{ id: "a1" }, { id: "a1" }]);
  assert.equal(samePerson.approved, false);
});

test("S38-WP06 approval never removes monitoring or rollback", () => {
  assert.equal(decision.approvalBoundaries(["expand-cohort"]).allowed, true);
  const stripped = decision.approvalBoundaries(["remove-monitoring", "remove-rollback"]);
  assert.equal(stripped.allowed, false);
  assert.equal(stripped.removedMonitoring, true);
  assert.equal(stripped.removedRollback, true);
});
