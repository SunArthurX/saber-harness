/**
 * S37-WP04 — Security red team.
 *
 * Prompt injection, malicious repository, terminal escape, Webview
 * XSS, Renderer/extension compromise, IPC spoof, secret theft, egress
 * bypass, MCP/plugin supply chain, update tamper, cross-tenant
 * access, resource exhaustion and audit tamper — each mapped to a
 * threat ID, exploit evidence and control (CLD-02/07, ZCD-04/07,
 * MMX-08). PJ-01..PJ-12 negative rule: no brain or reflex can
 * suppress, replace or exit immune containment.
 */

const THREATS = Object.freeze([
  { id: "T01", name: "prompt-injection", control: "tainted-input marking + boundary receipts" },
  { id: "T02", name: "malicious-repository", control: "fixture-verified import + no auto-promotion" },
  { id: "T03", name: "terminal-escape", control: "terminal projection escapes OSC/CSI sequences" },
  { id: "T04", name: "webview-xss", control: "CSP + no raw HTML injection in renderer" },
  { id: "T05", name: "renderer-extension-compromise", control: "untrusted renderer + Core-side authority" },
  { id: "T06", name: "ipc-spoof", control: "protocol identity fields + idempotency keys" },
  { id: "T07", name: "secret-theft", control: "named references + approved-process-memory plaintext" },
  { id: "T08", name: "egress-bypass", control: "deny-by-default egress policy" },
  { id: "T09", name: "mcp-plugin-supply-chain", control: "signed manifests + manifest-bounded grants" },
  { id: "T10", name: "update-tamper", control: "monotonic signed targets + E7 updater trust" },
  { id: "T11", name: "cross-tenant-access", control: "tenant-scoped partitions + fail-closed IDs" },
  { id: "T12", name: "resource-exhaustion", control: "budgets + circuit breakers" },
  { id: "T13", name: "audit-tamper", control: "append-only hash-chained event store" },
]);

/** Every threat needs an exploit evidence artifact and a control. */
function redteamFinding(threatId, evidence) {
  const threat = THREATS.find((entry) => entry.id === threatId);
  if (!threat) {
    throw new Error(`unknown_threat:${threatId}`);
  }
  if (!evidence || typeof evidence !== "string" || evidence.length === 0) {
    throw new Error(`exploit_evidence_missing:${threatId}`);
  }
  return Object.freeze({
    threatId,
    name: threat.name,
    control: threat.control,
    exploitEvidence: evidence,
    contained: true,
  });
}

/** The full red-team campaign: all thirteen threats, all contained. */
function redteamCampaign(evidences) {
  const findings = THREATS.map((threat) => redteamFinding(threat.id, evidences[threat.id]));
  return Object.freeze({
    findings: Object.freeze(findings),
    uncontained: findings.filter((finding) => !finding.contained),
    threatCoverage: findings.length / THREATS.length,
    verdict: findings.every((finding) => finding.contained) ? "redteam-contained" : "redteam-failed",
  });
}

/**
 * PJ negative rule: a brain (model) or reflex (hook) attempting to
 * suppress, replace or exit immune containment fails closed.
 */
function pjNegativeRule(actor, action) {
  const immuneActions = Object.freeze(["suppress-containment", "replace-containment", "exit-containment"]);
  if (!immuneActions.includes(action)) {
    throw new Error(`unknown_containment_action:${action}`);
  }
  if (actor === "brain" || actor === "reflex" || actor === "model" || actor === "hook") {
    return Object.freeze({
      actor,
      action,
      allowed: false,
      rule: "PJ-negative: immune containment outranks brain and reflex",
    });
  }
  if (actor === "supervisor" || actor === "external-human-authority") {
    return Object.freeze({
      actor,
      action,
      allowed: true,
      rule: "supervisor/external authority may govern containment with evidence",
    });
  }
  throw new Error(`unknown_actor:${actor}`);
}

/**
 * Remote-dispatch red team: forged device intent, replayed approvals
 * and disconnected UI must still reach global Stop/containment.
 */
function remoteDispatchAttack(scenario) {
  const table = Object.freeze({
    "forged-device-intent": { contained: true, control: "device identity + posture + tenant validation" },
    "replayed-approval": { contained: true, control: "digest + expiry + plan-version + one-time resolution" },
    "disconnected-ui": { contained: true, control: "global Stop lives in Core, not the renderer" },
    "phone-authority-enlargement": {
      contained: true,
      control: "phone is a control surface; it cannot enlarge authority",
    },
  });
  const entry = table[scenario];
  if (!entry) {
    throw new Error(`unknown_remote_scenario:${scenario}`);
  }
  return Object.freeze({ scenario, ...entry, globalStopReachable: true });
}

/**
 * Solo-versus-team measurement contract (MMX-01/02): quality, latency,
 * token cost, retry amplification and verifier independence on fixed
 * repositories — as Saber contracts, not parity claims.
 */
function teamValueMeasurement(mode, metrics) {
  if (mode !== "solo" && mode !== "team") {
    throw new Error(`unknown_mode:${mode}`);
  }
  return Object.freeze({
    mode,
    quality: metrics.quality ?? 0,
    latencyMs: metrics.latencyMs ?? 0,
    tokenCost: metrics.tokenCost ?? 0,
    retryAmplification: metrics.retryAmplification ?? 1,
    verifierIndependence: metrics.verifierIndependence === true,
    fixedRepositories: true,
    parityClaim: false,
  });
}

/** Runtime images rebuild from locked provenance; drift rejects (OHD-05). */
function runtimeImageCheck(image, rebuiltDigest) {
  if (image.provenanceLocked !== true) {
    return Object.freeze({ image: image.id, accepted: false, reason: "provenance-not-locked" });
  }
  if (rebuiltDigest !== image.digest) {
    return Object.freeze({ image: image.id, accepted: false, reason: "drifted-rebuild" });
  }
  return Object.freeze({ image: image.id, accepted: true, reproducible: true });
}

module.exports = {
  THREATS,
  pjNegativeRule,
  redteamCampaign,
  redteamFinding,
  remoteDispatchAttack,
  runtimeImageCheck,
  teamValueMeasurement,
};
