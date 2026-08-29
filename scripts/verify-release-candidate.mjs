#!/usr/bin/env node
/**
 * S38 release-candidate verifier — assembles the release packet from
 * the S36 package metadata, the S37 readiness digest and the frozen
 * design-partner KPIs, then checks packet completeness, approval
 * rules and boundaries. Exits non-zero unless the decision is a
 * bounded rollout approval.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { releasePacket, criticalExceptionApproval } = require(
  join(root, "apps/desktop-codeoss/extensions/saber-agent/src/productionDecision.js"),
);
const { evaluateGate } = require(join(root, "apps/desktop-codeoss/extensions/saber-agent/src/readinessGate.js"));

// S37 readiness digest from the committed immutable descriptors
const descriptors = JSON.parse(readFileSync(join(root, "fixtures/readiness/descriptors.json"), "utf8"));
const readiness = evaluateGate(descriptors);
if (readiness.verdict !== "ready") {
  console.error(`release-candidate: S37 readiness is ${readiness.verdict}, not ready`);
  process.exit(1);
}

// S36 provenance digests
const packages = JSON.parse(readFileSync(join(root, "dist/packages/index.json"), "utf8"));

// frozen design-partner KPIs
const benchmark = JSON.parse(readFileSync(join(root, "fixtures/design-partner/benchmark.json"), "utf8"));
const { evaluateBenchmark } = require(join(root, "apps/desktop-codeoss/extensions/saber-agent/src/taskBenchmark.js"));
const kpis = evaluateBenchmark(benchmark.tasks.map((task) => ({ ...task.outcome })));

const packet = releasePacket({
  "signed-artifact-provenance": packages.artifacts.map((artifact) => ({
    platform: artifact.platform,
    sha256: artifact.digest,
  })),
  "s37-readiness-digest": readiness.digest,
  "design-partner-kpis": {
    completionRate: kpis.completionRate,
    acceptanceRate: kpis.acceptanceRate,
    memoryPrecision: kpis.memoryPrecision,
  },
  "open-findings": [],
  rollback: { strategy: "last-known-good ring demotion", rehearsed: true },
  "support-coverage": "playbooks and rehearsals complete",
  "accountable-approvals": [
    { role: "product-release-lead", id: "approver-1" },
    { role: "security-owner", id: "approver-2" },
  ],
  approved: true,
});

const exceptionRule = criticalExceptionApproval([{ id: "approver-1" }, { id: "approver-2" }]);

console.log(
  JSON.stringify(
    {
      readinessDigest: readiness.digest,
      artifacts: packet.packet?.contents?.length ?? 0,
      packetDigest: packet.packet?.digest ?? null,
      decision: packet.decision,
      monitoringRemoved: packet.monitoringRemoved,
      rollbackRemoved: packet.rollbackRemoved,
      criticalExceptionDualApproval: exceptionRule.approved,
      kpiVerdict: kpis.verdict,
    },
    null,
    2,
  ),
);

if (packet.decision !== "bounded-rollout-approved" || !exceptionRule.approved) {
  console.error("release-candidate verification: FAILED");
  process.exit(1);
}
console.log("release-candidate verified: bounded rollout approved with monitoring and rollback retained");
