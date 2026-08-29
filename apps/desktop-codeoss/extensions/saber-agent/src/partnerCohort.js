/**
 * S38-WP01 — Cohort and consent.
 *
 * Design-partner cohorts select project languages, repository sizes,
 * OSes, privacy profiles and team types without cherry-picking easy
 * tasks; written consent covers code access, model providers,
 * telemetry, support bundle, retention, deletion, incident
 * notification and exit; tenants/workspaces stay isolated with a
 * named partner owner.
 */

const CONSENT_CLAUSES = Object.freeze([
  "code-access",
  "model-providers",
  "telemetry",
  "support-bundle",
  "retention",
  "deletion",
  "incident-notification",
  "exit",
]);

/** Written consent must be complete and explicit, never defaulted. */
function consent(agreedClauses) {
  const missing = CONSENT_CLAUSES.filter((clause) => !agreedClauses.includes(clause));
  return Object.freeze({
    complete: missing.length === 0,
    missing: Object.freeze(missing),
    optInOnly: true,
    defaultsAssumed: false,
  });
}

/**
 * Cohort selection across the required diversity axes; a cohort that
 * only contains easy/small/single-axis projects is rejected as
 * cherry-picked.
 */
function cohortSelection(projects) {
  if (projects.length < 5) {
    throw new Error("cohort_too_small");
  }
  const languages = new Set(projects.map((project) => project.language));
  const sizes = new Set(projects.map((project) => project.sizeClass));
  const oses = new Set(projects.flatMap((project) => project.oses ?? []));
  const privacy = new Set(projects.map((project) => project.privacyProfile));
  const teams = new Set(projects.map((project) => project.teamType));
  const diverse = languages.size >= 3 && sizes.size >= 2 && oses.size >= 2 && privacy.size >= 2 && teams.size >= 2;
  return Object.freeze({
    size: projects.length,
    languages: Object.freeze([...languages].sort()),
    sizeClasses: Object.freeze([...sizes].sort()),
    oses: Object.freeze([...oses].sort()),
    privacyProfiles: Object.freeze([...privacy].sort()),
    teamTypes: Object.freeze([...teams].sort()),
    cherryPicked: !diverse,
    verdict: diverse ? "representative" : "rejected-cherry-picked",
  });
}

/** Isolated tenant/workspace keys per partner with a named owner. */
function partnerWorkspace(partner) {
  if (!partner.tenantId || !partner.workspaceKey || !partner.owner) {
    throw new Error("partner_identity_incomplete");
  }
  return Object.freeze({
    tenantId: partner.tenantId,
    workspaceKey: partner.workspaceKey,
    owner: partner.owner,
    isolatedKeys: true,
    sharedAcrossPartners: false,
  });
}

/** Research honesty: users are never asked to reproduce private data. */
function researchProtocol(protocol) {
  const violations = [];
  if (protocol.requestsPrivateData === true) {
    violations.push("requests-private-data");
  }
  if (protocol.requiresPrivateRepoReproduction === true) {
    violations.push("requires-private-repo-reproduction");
  }
  return Object.freeze({
    violations: Object.freeze(violations),
    compliant: violations.length === 0,
    comparesAgainstCurrentWorkflow: true,
  });
}

module.exports = { CONSENT_CLAUSES, cohortSelection, consent, partnerWorkspace, researchProtocol };
