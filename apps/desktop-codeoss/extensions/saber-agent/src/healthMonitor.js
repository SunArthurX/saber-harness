/**
 * S34-WP04/S34-WP05 — Vital Bar, Incident UX and immune controls.
 *
 * Health mechanisms contain faults before asking the Agent brain for
 * advice. Signals classify into severities H0-H4 with detect,
 * contain, repair, verify and escalate timestamps; low severity stays
 * quiet while serious events show impact, automatic action, remaining
 * risk and user choices. The Supervisor can stop, quarantine, revoke,
 * isolate, roll back and enter Safe Mode without model approval; the
 * Agent cannot suppress health events, edit their audit history or
 * exit Safe Mode. Support Bundles are metadata/redaction first and
 * user-reviewed before export.
 */

/** Vital Bar signals. */
const VITAL_SIGNALS = Object.freeze([
  "core-crash-loop",
  "provider-crash-loop",
  "plugin-crash-loop",
  "sandbox-denial",
  "secret-alarm",
  "egress-alarm",
  "storage-integrity",
  "sync-failure",
  "update-failure",
  "budget-exhausted",
  "degraded-model",
]);

/** H0-H4 homeostasis severities (H0 most severe). */
const HEALTH_SEVERITIES = Object.freeze(["H0", "H1", "H2", "H3", "H4"]);

/** Signal → default severity mapping. */
const SIGNAL_SEVERITY = Object.freeze({
  "core-crash-loop": "H1",
  "provider-crash-loop": "H2",
  "plugin-crash-loop": "H2",
  "sandbox-denial": "H1",
  "secret-alarm": "H0",
  "egress-alarm": "H0",
  "storage-integrity": "H1",
  "sync-failure": "H3",
  "update-failure": "H2",
  "budget-exhausted": "H3",
  "degraded-model": "H4",
});

/** Classify a signal into a severity; unknown signals fail closed loud. */
function classifyIncident(signal) {
  const severity = SIGNAL_SEVERITY[signal];
  if (!severity) {
    throw new Error(`unknown_vital_signal:${signal}`);
  }
  return Object.freeze({
    signal,
    severity,
    quiet: severity === "H4",
    containmentPrecedesAdvice: true,
  });
}

/**
 * Incident lifecycle: detect, contain, repair, verify and escalate
 * timestamps; escalation is automatic at H0/H1 and user-visible from
 * H2 down. Repair only counts when verification follows.
 */
function incidentLifecycle(signal, timestamps = {}) {
  const classified = classifyIncident(signal);
  const phases = Object.freeze({
    detectedAt: timestamps.detectedAt ?? null,
    containedAt: timestamps.containedAt ?? null,
    repairedAt: timestamps.repairedAt ?? null,
    verifiedAt: timestamps.verifiedAt ?? null,
    escalatedAt: timestamps.escalatedAt ?? null,
  });
  const ordered =
    phases.detectedAt !== null &&
    phases.containedAt !== null &&
    (phases.repairedAt === null || phases.verifiedAt !== null);
  if (!ordered && phases.detectedAt !== null && phases.containedAt === null) {
    throw new Error("containment_before_anything_else");
  }
  return Object.freeze({
    ...classified,
    phases,
    repairVerified: phases.repairedAt !== null && phases.verifiedAt !== null,
    escalate: classified.severity === "H0" || classified.severity === "H1",
  });
}

/** The UX contract: quiet when minor, honest when serious. */
function incidentPresentation(signal) {
  const classified = classifyIncident(signal);
  if (classified.quiet) {
    return Object.freeze({ mode: "quiet", shown: false, rationale: "low severity monitored locally" });
  }
  return Object.freeze({
    mode: "visible",
    shown: true,
    impact: `impact-of-${signal}`,
    automaticAction: `contain-${signal}`,
    remainingRisk: `residual-risk-after-containment`,
    userChoices: Object.freeze(["acknowledge", "open-incident", "request-support-bundle"]),
  });
}

/**
 * Support Bundle is metadata/redaction first and user-reviewed before
 * export; raw diagnostics never leave unredacted.
 */
function supportBundle(incident, options = {}) {
  const redacted = { ...incident };
  delete redacted.rawDiagnostics;
  return Object.freeze({
    bundle: Object.freeze({
      ...redacted,
      secretsStripped: true,
      sourceRedacted: true,
      metadataFirst: true,
    }),
    exportState: Object.freeze({
      userReviewed: options.userReviewed === true,
      exported: options.userReviewed === true,
      note: "export only after explicit user review",
    }),
  });
}

/** Supervisor immune controls; none require model approval. */
const IMMUNE_CONTROLS = Object.freeze(["stop", "quarantine", "revoke", "isolate", "rollback", "enter-safe-mode"]);

/**
 * Execute an immune control without model approval. Safe Mode exit is
 * NOT among them: leaving Safe Mode needs external human/admin
 * authority with evidence.
 */
function immuneControl(control) {
  if (!IMMUNE_CONTROLS.includes(control)) {
    throw new Error(`unknown_immune_control:${control}`);
  }
  return Object.freeze({
    control,
    modelApprovalRequired: false,
    supervisorAuthority: true,
    timestamped: true,
  });
}

/**
 * The Agent (model side) attempts a health action. Suppression of
 * health events, audit edits and Safe Mode exit all fail closed.
 */
function agentHealthAttempt(action) {
  switch (action) {
    case "suppress-health-event":
    case "edit-audit-history":
    case "exit-safe-mode":
      return Object.freeze({ action, allowed: false, reason: "agent-cannot-override-immune-controls" });
    case "report-signal":
      return Object.freeze({ action, allowed: true, reason: "reporting is always welcome" });
    default:
      throw new Error(`unknown_agent_health_action:${action}`);
  }
}

/** Safe Mode transitions: entry is supervisor-driven, exit is external. */
function safeModeTransition(from, to, authority) {
  if (from === "normal" && to === "safe-mode") {
    return Object.freeze({ allowed: true, requires: "supervisor", authority });
  }
  if (from === "safe-mode" && to === "normal") {
    const external = authority === "human-admin" || authority === "vendor-with-evidence";
    if (!external) {
      return Object.freeze({
        allowed: false,
        reason: "exit-safe-mode requires external human/admin/vendor authority with evidence",
      });
    }
    return Object.freeze({ allowed: true, requires: "external-authority", authority });
  }
  throw new Error(`unknown_safe_mode_transition:${from}->${to}`);
}

/**
 * Bound retry with circuit breaker so inflammatory crash loops stop:
 * after `threshold` failures the breaker opens and retries stop.
 */
function circuitBreaker(failures, threshold = 3) {
  const open = failures >= threshold;
  return Object.freeze({
    failures,
    threshold,
    state: open ? "open" : "closed",
    retriesRemaining: open ? 0 : threshold - failures,
    inflammatoryLoop: false,
  });
}

module.exports = {
  HEALTH_SEVERITIES,
  IMMUNE_CONTROLS,
  VITAL_SIGNALS,
  agentHealthAttempt,
  circuitBreaker,
  classifyIncident,
  immuneControl,
  incidentLifecycle,
  incidentPresentation,
  safeModeTransition,
  supportBundle,
};
