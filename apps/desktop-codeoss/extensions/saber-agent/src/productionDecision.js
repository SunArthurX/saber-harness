/**
 * S38-WP05/WP06 — Privacy/governance closeout and the production
 * decision.
 *
 * Opt-in telemetry, data map, subprocessors, retention/deletion,
 * export, DSR and regional claims verified; enterprise policy, model
 * destination, plugin registry and Break Glass audit reviewed by
 * independent owners; public docs match actual behavior. The release
 * packet carries signed artifact/provenance, the S37 readiness
 * digest, design-partner KPIs, open findings, rollback, support
 * coverage and accountable approvals. No one-person approval for a
 * critical security exception; approval never removes monitoring or
 * rollback.
 */

const PRIVACY_CHECKS = Object.freeze([
  "opt-in-telemetry",
  "data-map",
  "subprocessors",
  "retention-deletion",
  "export",
  "dsr-workflow",
  "regional-deployment-claims",
  "docs-match-behavior",
]);

function privacyCloseout(verified) {
  const missing = PRIVACY_CHECKS.filter((check) => !verified.includes(check));
  return Object.freeze({
    missing: Object.freeze(missing),
    complete: missing.length === 0,
  });
}

/** Governance review by independent owners. */
function governanceReview(reviews) {
  const required = Object.freeze(["enterprise-policy", "model-destination", "plugin-registry", "break-glass-audit"]);
  const entries = required.map((area) => {
    const review = reviews.find((entry) => entry.area === area);
    if (!review || review.owner === review.implementer || review.independent !== true) {
      return { area, independent: false };
    }
    return { area, independent: true, owner: review.owner };
  });
  return Object.freeze({
    areas: Object.freeze(entries),
    allIndependent: entries.every((entry) => entry.independent),
  });
}

const PACKET_CONTENTS = Object.freeze([
  "signed-artifact-provenance",
  "s37-readiness-digest",
  "design-partner-kpis",
  "open-findings",
  "rollback",
  "support-coverage",
  "accountable-approvals",
]);

/** Build the immutable release packet with a deterministic digest. */
function releasePacket(input) {
  const missing = PACKET_CONTENTS.filter((item) => input[item] === undefined);
  if (missing.length > 0) {
    throw new Error(`packet_incomplete:${missing.join(",")}`);
  }
  const openFindings = input["open-findings"] ?? [];
  if (openFindings.some((finding) => finding.severity === "P0" || finding.severity === "P1")) {
    return Object.freeze({
      packet: null,
      decision: "blocked",
      blockers: Object.freeze(openFindings.filter((finding) => finding.severity === "P0" || finding.severity === "P1")),
      reason: "unresolved P0/P1 findings block the production decision",
    });
  }
  const digestSource = JSON.stringify({
    provenance: input["signed-artifact-provenance"],
    readiness: input["s37-readiness-digest"],
    kpis: input["design-partner-kpis"],
    rollback: input.rollback,
    approvals: input["accountable-approvals"],
  });
  return Object.freeze({
    packet: Object.freeze({
      contents: Object.freeze(PACKET_CONTENTS),
      s37ReadinessDigest: input["s37-readiness-digest"],
      openFindings: Object.freeze(openFindings),
      rollback: Object.freeze({ ...input.rollback }),
      digest: `packet-${digestHash(digestSource)}`,
    }),
    decision: input.approved === true ? "bounded-rollout-approved" : "awaiting-approvals",
    monitoringRemoved: false,
    rollbackRemoved: false,
  });
}

function digestHash(input) {
  let hash = 0;
  for (const ch of input) {
    hash = (hash * 31 + ch.codePointAt(0)) % 0x100000000;
  }
  return hash.toString(16);
}

/**
 * Critical security exceptions require at least two approvers — no
 * one-person approval.
 */
function criticalExceptionApproval(approvers) {
  const distinct = new Set((approvers ?? []).map((approver) => approver.id));
  return Object.freeze({
    approvers: Object.freeze([...distinct]),
    approved: distinct.size >= 2,
    rule: "no one-person approval for a critical security exception",
  });
}

/** Approval is never permission to remove monitoring or rollback. */
function approvalBoundaries(modifications) {
  const removedMonitoring = modifications.includes("remove-monitoring");
  const removedRollback = modifications.includes("remove-rollback");
  return Object.freeze({
    allowed: !removedMonitoring && !removedRollback,
    removedMonitoring,
    removedRollback,
    rule: "production approval retains monitoring and rollback",
  });
}

module.exports = {
  PACKET_CONTENTS,
  PRIVACY_CHECKS,
  approvalBoundaries,
  criticalExceptionApproval,
  governanceReview,
  privacyCloseout,
  releasePacket,
};
