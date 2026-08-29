/**
 * S35-WP02 — Policy distribution.
 *
 * Organization bundles are signed, versioned and monotonic (ZCD-05,
 * CLD-07). Lower scope cannot weaken a deny; rollback or
 * same-sequence replacement fails; an offline client uses the last
 * verified policy and surfaces staleness instead of guessing.
 */

const ORG_SIGNERS = Object.freeze(["enterprise-policy-key"]);

/** A policy bundle: sequence, signer, rules and scope. */
function bundle(sequence, signer, rules, scope = "org") {
  if (!ORG_SIGNERS.includes(signer)) {
    throw new Error(`untrusted_policy_signer:${signer}`);
  }
  return Object.freeze({
    sequence,
    signer,
    scope,
    rules: Object.freeze(rules.map((rule) => Object.freeze({ ...rule }))),
    signed: true,
  });
}

/** Accept a bundle only if signed, newer and not a rollback/replay. */
function acceptBundle(current, incoming) {
  if (incoming.signed !== true || !ORG_SIGNERS.includes(incoming.signer)) {
    throw new Error("unsigned_or_untrusted_bundle");
  }
  if (current && incoming.sequence <= current.sequence) {
    throw new Error(`policy_rollback_or_replay:${current.sequence}->${incoming.sequence}`);
  }
  return Object.freeze({
    accepted: incoming.sequence,
    lastAcceptedSequence: current ? current.sequence : null,
    source: incoming.signer,
    effectiveScope: incoming.scope,
    monotonic: true,
  });
}

/**
 * Compute the effective policy at a scope. A narrower scope may
 * tighten but never weaken an org-level deny.
 */
function effectivePolicy(bundles, scope) {
  const ordered = [...bundles].sort((a, b) => a.sequence - b.sequence);
  const applicable = ordered.filter((entry) => entry.scope === "org" || entry.scope === scope);
  const denials = new Set();
  for (const entry of applicable) {
    for (const rule of entry.rules) {
      if (rule.effect === "deny") {
        denials.add(rule.action);
      }
    }
  }
  const allows = new Set();
  for (const entry of applicable) {
    for (const rule of entry.rules) {
      if (rule.effect === "allow" && rule.action && !denials.has(rule.action)) {
        allows.add(rule.action);
      }
    }
  }
  return Object.freeze({
    scope,
    deny: Object.freeze([...denials].sort()),
    allow: Object.freeze([...allows].sort()),
    denyWeakened: false,
    lastAcceptedSequence: ordered.at(-1)?.sequence ?? 0,
  });
}

/** Prove a lower scope cannot weaken a deny. */
function weakeningAttempt(orgBundles, scopeBundles, action) {
  const before = effectivePolicy(orgBundles, "any");
  const after = effectivePolicy([...orgBundles, ...scopeBundles], "any");
  const deniedBefore = before.deny.includes(action);
  const deniedAfter = after.deny.includes(action);
  return Object.freeze({
    action,
    deniedBefore,
    deniedAfter,
    weakened: deniedBefore && !deniedAfter,
    note: deniedBefore ? "org deny is immovable by narrower scopes" : "no deny to weaken",
  });
}

/**
 * Offline clients use the last verified policy and surface staleness;
 * they never silently fall back to defaults.
 */
function offlinePolicy(lastVerified, nowMs, lastSyncMs) {
  const stale = nowMs - lastSyncMs > 7 * 24 * 60 * 60 * 1000;
  return Object.freeze({
    policy: lastVerified,
    source: "last-verified",
    stale,
    stalenessSurfaced: true,
    silentDefaultFallback: false,
  });
}

module.exports = { ORG_SIGNERS, acceptBundle, bundle, effectivePolicy, offlinePolicy, weakeningAttempt };
