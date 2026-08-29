/**
 * S37-WP06 — Deterministic desktop readiness gate.
 *
 * Input only immutable descriptors and test metadata; output
 * per-family results, finding IDs and a digest. Required families:
 * DesktopTruth, CoreBoundary, FunctionalJourney, CrossPlatform,
 * Accessibility, Performance, Privacy, Recovery, SupplyChain,
 * ThreatCoverage and ReportHygiene. The verdict is ready only with
 * zero P0/P1 findings, and the report carries metadata only — no
 * source, prompt, secret or private transcript.
 */

const REQUIRED_FAMILIES = Object.freeze([
  "DesktopTruth",
  "CoreBoundary",
  "FunctionalJourney",
  "CrossPlatform",
  "Accessibility",
  "Performance",
  "Privacy",
  "Recovery",
  "SupplyChain",
  "ThreatCoverage",
  "ReportHygiene",
]);

/** Severity of a finding; P0/P1 block readiness. */
function finding(id, family, severity, detail) {
  if (!REQUIRED_FAMILIES.includes(family)) {
    throw new Error(`unknown_family:${family}`);
  }
  if (!["P0", "P1", "P2", "P3"].includes(severity)) {
    throw new Error(`unknown_severity:${severity}`);
  }
  return Object.freeze({ id, family, severity, detail });
}

/**
 * Evaluate the gate from immutable descriptors. Deterministic: same
 * descriptors in, same report and digest out.
 */
function evaluateGate(descriptors) {
  const families = Object.freeze(
    REQUIRED_FAMILIES.map((family) => {
      const entry = descriptors[family] ?? {};
      const findings = (entry.findings ?? []).map((item) => finding(item.id, family, item.severity, item.detail));
      return Object.freeze({
        family,
        status: entry.status ?? "not-run",
        findings: Object.freeze(findings),
        evidence: entry.evidence ?? "metadata-only",
      });
    }),
  );
  const blockers = families.flatMap((family) =>
    family.findings.filter((item) => item.severity === "P0" || item.severity === "P1"),
  );
  const notRun = families.filter((family) => family.status === "not-run");
  const digestInput = JSON.stringify(
    families.map((family) => ({ family, status: family.status, findings: family.findings })),
  );
  return Object.freeze({
    families,
    blockerFindings: Object.freeze(blockers),
    missingFamilies: Object.freeze(notRun.map((family) => family.family)),
    digest: `gate-${digestHash(digestInput)}`,
    verdict: blockers.length === 0 && notRun.length === 0 ? "ready" : blockers.length > 0 ? "blocked" : "incomplete",
    metadataOnly: true,
    prohibitedContent: Object.freeze(["source", "prompt", "secret", "private-transcript"]),
  });
}

function digestHash(input) {
  let hash = 0;
  for (const ch of input) {
    hash = (hash * 31 + ch.codePointAt(0)) % 0x100000000;
  }
  return hash.toString(16);
}

/** Report hygiene: refuse prohibited content classes in any field. */
function reportHygiene(report) {
  const banned = ["source", "prompt", "secret", "private-transcript"];
  const violations = banned.filter((kind) => report.includes?.[kind] === true);
  return Object.freeze({
    clean: violations.length === 0,
    violations: Object.freeze(violations),
    rule: "report contains metadata only",
  });
}

module.exports = { REQUIRED_FAMILIES, evaluateGate, finding, reportHygiene };
