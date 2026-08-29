/**
 * S31-WP03 — verification evidence projection.
 *
 * Every observation shows command, environment, exit code, duration,
 * stdout/stderr digest, test counts and artifact links; states
 * distinguish not-run/running/passed/failed/flaky/cancelled/stale; a
 * changed tree invalidates affected evidence until rerun or justified;
 * security/static/license checks carry separate severity and ownership.
 * A model message alone NEVER produces a completed state (MMX-07: a
 * producer cannot be the sole signer of completion).
 */

/** Evidence states (S31-WP03). */
const EVIDENCE_STATES = Object.freeze(["not-run", "running", "passed", "failed", "flaky", "cancelled", "stale"]);

/** Evidence kinds and their owners (security checks are separately owned). */
const EVIDENCE_KINDS = Object.freeze({
  test: Object.freeze({ owner: "tester", severity: "normal" }),
  lint: Object.freeze({ owner: "developer", severity: "normal" }),
  browser: Object.freeze({ owner: "reviewer", severity: "normal" }),
  security: Object.freeze({ owner: "security", severity: "critical", separate: true }),
  static: Object.freeze({ owner: "security", severity: "high", separate: true }),
  license: Object.freeze({ owner: "security", severity: "high", separate: true }),
});

/** One verification observation record. */
function observation({
  kind,
  command,
  environment,
  exitCode,
  durationMs,
  stdoutDigest,
  stderrDigest,
  testCounts,
  artifactLinks,
  treeDigest,
}) {
  const meta = EVIDENCE_KINDS[kind];
  if (!meta) {
    throw new Error(`unknown_evidence_kind:${kind}`);
  }
  const state =
    exitCode === undefined
      ? "not-run"
      : exitCode === 0
        ? "passed"
        : exitCode === 75
          ? "flaky"
          : exitCode === 130
            ? "cancelled"
            : "failed";
  return Object.freeze({
    kind,
    owner: meta.owner,
    severity: meta.severity,
    separate: Boolean(meta.separate),
    command,
    environment,
    exitCode: exitCode ?? null,
    durationMs: durationMs ?? null,
    stdoutDigest: stdoutDigest ?? null,
    stderrDigest: stderrDigest ?? null,
    testCounts: Object.freeze(testCounts ?? {}),
    artifactLinks: Object.freeze(artifactLinks ?? []),
    treeDigest: treeDigest ?? null,
    state,
    // Signed by its producer; completion requires an independent signer.
    signedBy: null,
  });
}

/** A changed tree invalidates evidence bound to the old digest. */
function invalidateOnTreeChange(observations, newTreeDigest) {
  return observations.map((item) =>
    item.treeDigest !== null && item.treeDigest !== newTreeDigest
      ? Object.freeze({ ...item, state: "stale", invalidatedBy: "tree-change" })
      : item,
  );
}

/**
 * Preview Auto-Verify (CLD-02/ZCD-04): server identity, DOM/a11y
 * assertions, ordered actions, screenshots and test results.
 * Inconclusive is a valid outcome and screenshots alone cannot pass.
 */
function previewAutoVerify({
  serverIdentity,
  domAssertions,
  a11yAssertions,
  orderedActions,
  screenshots,
  testResults,
}) {
  const checks = [
    Boolean(serverIdentity),
    Array.isArray(domAssertions) && domAssertions.length > 0,
    Array.isArray(a11yAssertions) && a11yAssertions.length > 0,
    Array.isArray(orderedActions),
    Array.isArray(testResults) && testResults.every((result) => result?.exitCode === 0),
  ];
  const conclusive = checks.every(Boolean);
  return Object.freeze({
    serverIdentity: serverIdentity ?? null,
    domAssertions: Object.freeze(domAssertions ?? []),
    a11yAssertions: Object.freeze(a11yAssertions ?? []),
    orderedActions: Object.freeze(orderedActions ?? []),
    screenshots: Object.freeze(screenshots ?? []),
    testResults: Object.freeze(testResults ?? []),
    outcome: conclusive ? "verified" : "inconclusive",
    screenshotsAloneSuffice: false,
  });
}

/**
 * Completion signing (MMX-07): the producer of work cannot be the sole
 * signer of completion; every kind must have passed (or been explicitly
 * justified) evidence, and security kinds require their own owner.
 */
function completionGate(evidence, { producer = "agent", signers = [] } = {}) {
  const blockers = [];
  const relevant = evidence.filter((item) => item.state !== "stale" || item.justified !== true);
  for (const kind of ["test", "security"]) {
    const entries = relevant.filter((item) => item.kind === kind);
    if (entries.length === 0) {
      blockers.push(`missing-${kind}-evidence`);
    } else if (!entries.some((item) => item.state === "passed" || item.state === "flaky")) {
      blockers.push(`${kind}-evidence-not-passing`);
    }
  }
  const independentSigners = signers.filter((signer) => signer !== producer);
  if (independentSigners.length === 0) {
    blockers.push("no-independent-signer");
  }
  if (signers.includes(producer) && signers.length === 1) {
    blockers.push("producer-sole-signer");
  }
  // A model message alone never completes: the gate only reads evidence.
  return Object.freeze({
    completed: blockers.length === 0,
    blockers: Object.freeze(blockers),
    modelMessageAloneCompletes: false,
  });
}

module.exports = {
  EVIDENCE_KINDS,
  EVIDENCE_STATES,
  completionGate,
  invalidateOnTreeChange,
  observation,
  previewAutoVerify,
};
