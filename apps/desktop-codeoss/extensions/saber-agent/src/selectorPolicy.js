/**
 * S29-WP04 — Model, Realm, autonomy and budget selectors.
 *
 * Displays provider, model, local/cloud status, context limit, price
 * class and POLICY ELIGIBILITY for every choice; Realm selection shows
 * the execution boundary and data egress; autonomy maps to a closed
 * capability set where "full access" can never exceed Core policy; and
 * the budget selector covers token, money, wall time and tool calls.
 * Every selector is advisory to the Core: the projection shows what
 * policy permits, it does not grant it (ZED-01).
 */

/** Closed capability set — anything outside is not an autonomy level. */
const CAPABILITIES = Object.freeze([
  "read.browse",
  "read.search",
  "write.edit",
  "write.create",
  "exec.sandboxed",
  "exec.host",
  "net.egress",
  "secret.read",
]);

/** Autonomy presets map to closed capability subsets. */
const AUTONOMY_PRESETS = Object.freeze({
  "read-only": Object.freeze(["read.browse", "read.search"]),
  "sandboxed-edit": Object.freeze(["read.browse", "read.search", "write.edit", "write.create", "exec.sandboxed"]),
  "governed-full": Object.freeze([
    "read.browse",
    "read.search",
    "write.edit",
    "write.create",
    "exec.sandboxed",
    "exec.host",
    "net.egress",
  ]),
});

/** Model registry with policy eligibility per provider/model. */
const MODELS = Object.freeze([
  Object.freeze({
    provider: "local",
    model: "saber-local-8b",
    deployment: "local",
    contextLimitTokens: 32768,
    priceClass: "free",
    policyTags: Object.freeze(["offline", "no-egress"]),
  }),
  Object.freeze({
    provider: "cloud-a",
    model: "standard",
    deployment: "cloud",
    contextLimitTokens: 128000,
    priceClass: "standard",
    policyTags: Object.freeze(["egress-approved"]),
  }),
  Object.freeze({
    provider: "cloud-b",
    model: "premium",
    deployment: "cloud",
    contextLimitTokens: 200000,
    priceClass: "premium",
    policyTags: Object.freeze(["egress-approved", "enterprise-only"]),
  }),
]);

/** Realms show the execution boundary and data egress (S29-WP04). */
const REALMS = Object.freeze([
  Object.freeze({ id: "local", boundary: "this machine", dataEgress: "none" }),
  Object.freeze({ id: "ssh", boundary: "remote host over SSH", dataEgress: "ssh-channel-only" }),
  Object.freeze({ id: "container", boundary: "local container sandbox", dataEgress: "denied-by-default" }),
  Object.freeze({ id: "cloud", boundary: "approved cloud realm", dataEgress: "policy-approved-channels" }),
]);

/** Budget selector bounds (hard ceilings; policy may lower them). */
const BUDGET_LIMITS = Object.freeze({
  tokens: 200000,
  moneyUsd: 20,
  wallClockMinutes: 120,
  toolCalls: 500,
});

/**
 * Core policy input: which capability tags, realms and price classes the
 * current policy permits. The selector layer may only narrow, never
 * widen it.
 */
function effectiveSelection(policy, { modelKey, realmId, autonomy, budget } = {}) {
  const divergences = [];
  const model = MODELS.find((entry) => `${entry.provider}/${entry.model}` === modelKey) ?? null;
  const modelEligible = Boolean(
    model &&
      model.policyTags.every((tag) => policy.policyTags.includes(tag)) &&
      (policy.priceClasses.length === 0 || policy.priceClasses.includes(model.priceClass)),
  );
  if (model && !modelEligible) {
    divergences.push(`model-not-eligible:${modelKey}`);
  }
  const realm = REALMS.find((entry) => entry.id === realmId) ?? null;
  const realmEligible = Boolean(realm && policy.realms.includes(realm.id));
  if (realm && !realmEligible) {
    divergences.push(`realm-not-permitted:${realmId}`);
  }

  // Autonomy maps to the closed capability set, then policy clamps it:
  // "full access" can request, but never receive, capabilities policy
  // does not grant.
  const requested = AUTONOMY_PRESETS[autonomy] ?? [];
  const unknown = requested.filter((capability) => !CAPABILITIES.includes(capability));
  if (unknown.length > 0) {
    divergences.push(`unknown-capabilities:${unknown.join(",")}`);
  }
  const grantedCapabilities = Object.freeze(requested.filter((capability) => policy.capabilities.includes(capability)));
  const droppedCapabilities = requested.filter((capability) => !policy.capabilities.includes(capability));
  if (droppedCapabilities.length > 0) {
    divergences.push(`clamped-by-policy:${droppedCapabilities.join(",")}`);
  }

  const clampedBudget = {};
  for (const [dimension, ceiling] of Object.entries(BUDGET_LIMITS)) {
    const requestedValue = Number(budget?.[dimension] ?? ceiling);
    clampedBudget[dimension] = Math.max(
      0,
      Math.min(requestedValue, ceiling, policy.budgetCeilings?.[dimension] ?? ceiling),
    );
  }

  return Object.freeze({
    model: model
      ? {
          key: modelKey,
          eligible: modelEligible,
          deployment: model.deployment,
          contextLimitTokens: model.contextLimitTokens,
          priceClass: model.priceClass,
        }
      : null,
    realm: realm
      ? { id: realm.id, eligible: realmEligible, boundary: realm.boundary, dataEgress: realm.dataEgress }
      : null,
    autonomy: { requested: autonomy ?? null, grantedCapabilities, droppedCapabilities },
    budget: Object.freeze(clampedBudget),
    divergences: Object.freeze(divergences),
  });
}

module.exports = {
  AUTONOMY_PRESETS,
  BUDGET_LIMITS,
  CAPABILITIES,
  MODELS,
  REALMS,
  effectiveSelection,
};
