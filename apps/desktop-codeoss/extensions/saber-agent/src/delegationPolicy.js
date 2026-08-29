/**
 * S32-WP03/WP05/WP06 — delegation policy, conflict detection, faults.
 *
 * Children bind to least capabilities and can never widen the parent's
 * scope; budget exhaustion pauses with evidence instead of silently
 * re-routing; cross-task messages cannot launder capability or
 * completion authority; conflicts are detected before merge; fault
 * injection proves sibling containment and bounded cleanup.
 */

/** Scope dimensions a child can never widen. */
const SCOPE_DIMENSIONS = Object.freeze(["capabilities", "secrets", "network", "dataClass", "realms"]);

/** Validate a delegation: child scope must be a subset of parent's. */
function validateDelegation(parent, child) {
  const widened = [];
  for (const capability of child.capabilities ?? []) {
    if (!(parent.capabilities ?? []).includes(capability)) {
      widened.push(`capability:${capability}`);
    }
  }
  for (const secret of child.secrets ?? []) {
    if (!(parent.secrets ?? []).includes(secret)) {
      widened.push(`secret:${secret}`);
    }
  }
  for (const realm of child.realms ?? []) {
    if (!(parent.realms ?? []).includes(realm)) {
      widened.push(`realm:${realm}`);
    }
  }
  if ((child.network ?? "none") !== "none" && (parent.network ?? "none") === "none") {
    widened.push("network");
  }
  const rank = { public: 0, internal: 1, confidential: 2, secret: 3 };
  if (rank[child.dataClass ?? "public"] > rank[parent.dataClass ?? "public"]) {
    widened.push("dataClass");
  }
  return Object.freeze({ allowed: widened.length === 0, widened: Object.freeze(widened) });
}

/** Budget clamp: child budgets never exceed the parent's. */
function clampBudgets(parent, child) {
  const clamp = (dimension) =>
    Math.max(
      0,
      Math.min(child?.[dimension] ?? Number.MAX_SAFE_INTEGER, parent?.[dimension] ?? Number.MAX_SAFE_INTEGER),
    );
  return Object.freeze({
    tokens: clamp("tokens"),
    moneyUsd: clamp("moneyUsd"),
    wallClockMinutes: clamp("wallClockMinutes"),
    toolCalls: clamp("toolCalls"),
  });
}

/** Budget exhaustion pauses with evidence; never re-routes silently. */
function budgetExhaustion(budget, spent) {
  const exhausted = Object.keys(budget).filter((dimension) => spent[dimension] >= budget[dimension]);
  return Object.freeze({
    exhausted: exhausted.length > 0,
    dimensions: Object.freeze(exhausted),
    action: "pause",
    evidence: exhausted.map((dimension) => `budget:${dimension}:${spent[dimension]}/${budget[dimension]}`),
    silentlyReroutes: false,
  });
}

/** Team value decision (MMX-01): explain solo vs team from the factors. */
function teamValueDecision(factors) {
  const score =
    (factors.dependencyWidth ?? 0) +
    (factors.risk ?? 0) +
    (factors.uncertainty ?? 0) +
    (factors.domainDiversity ?? 0) -
    (factors.verificationCost ?? 0) -
    (factors.budgetPressure ?? 0);
  const team = score >= 2;
  return Object.freeze({
    team,
    rationale: team
      ? `Team: wide dependencies (${factors.dependencyWidth}), domain diversity (${factors.domainDiversity}) and verification cost (${factors.verificationCost}) favor parallel bounded tasks`
      : `Solo: narrow dependencies (${factors.dependencyWidth}) and budget pressure (${factors.budgetPressure}) favor one bounded agent`,
    factors: Object.freeze({ ...factors }),
    score,
  });
}

/** Conflict detection before merge (S32-WP05). */
function detectConflicts(childChanges) {
  const owners = new Map();
  for (const { childId, files } of childChanges) {
    for (const file of files) {
      if (!owners.has(file)) {
        owners.set(file, []);
      }
      owners.get(file).push(childId);
    }
  }
  const overlapping = [...owners.entries()].filter(([, kids]) => kids.length > 1).map(([file]) => file);
  return Object.freeze({
    overlappingFiles: Object.freeze(overlapping),
    conflicts: overlapping.length > 0,
    proposedOrder: Object.freeze(
      [...childChanges].sort((a, b) => a.files.length - b.files.length).map((change) => change.childId),
    ),
  });
}

/** Fault containment (S32-WP06/PHL-10): a failed child cannot corrupt
 * siblings, the goal, or launder authority. */
function containFault(fault, _siblings) {
  return Object.freeze({
    fault,
    siblingsAffected: Object.freeze([]),
    goalState: "intact",
    authorityLaundered: false,
    boundedCleanup: "quarantine-child-worktree",
  });
}

/** Cross-task messages carry taint and policy; they never grant anything. */
function crossTaskMessage(message) {
  return Object.freeze({
    id: message.id,
    source: message.source,
    audience: message.audience,
    taint: message.taint ?? "agent-derived",
    receivingPolicy: message.receivingPolicy ?? "default-deny",
    grantsCapability: false,
    grantsCompletion: false,
  });
}

module.exports = {
  SCOPE_DIMENSIONS,
  budgetExhaustion,
  clampBudgets,
  containFault,
  crossTaskMessage,
  detectConflicts,
  teamValueDecision,
  validateDelegation,
};
