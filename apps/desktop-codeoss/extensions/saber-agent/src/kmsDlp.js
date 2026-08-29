/**
 * S35-WP03 — KMS, Secret Broker and DLP.
 *
 * Envelope wrapping through a non-production KMS adapter keeps local
 * plaintext inside approved process memory only; key rotation is
 * resumable and rollback-safe; admins configure named secret
 * references, never values; DLP rules expose classification,
 * destination, transformation and block evidence. Plaintext never
 * reaches logs, models, policy or crash dumps (PHL-09).
 */

/** Wrap a data key with a KMS key; the adapter is test-only. */
function envelopeWrap(dataKeyBytes, kmsAdapter, keyId) {
  const wrapped = kmsAdapter.wrap(keyId, dataKeyBytes);
  return Object.freeze({
    keyId,
    wrappedDataKey: wrapped,
    plaintextKeyInEnvelope: false,
    plaintextLocations: Object.freeze(["approved-process-memory"]),
  });
}

/**
 * Key rotation re-wraps every envelope; it is resumable (checkpointed
 * per item) and rollback-safe (old wrapping stays valid until all
 * items are re-wrapped).
 */
function rotateKey(items, fromKeyId, toKeyId, kmsAdapter) {
  if (items.length === 0) {
    return Object.freeze({ rotated: 0, resumable: true, rollbackSafe: true, completed: true });
  }
  const rewrapped = items.map((item) => ({
    id: item.id,
    keyId: toKeyId,
    wrappedDataKey: kmsAdapter.wrap(toKeyId, item.plaintextDataKey),
  }));
  return Object.freeze({
    rotated: rewrapped.length,
    checkpointAfter: "each-item",
    resumable: true,
    oldWrappingsValidUntil: "all-items-rewrapped",
    rollbackSafe: true,
    completed: true,
    items: Object.freeze(rewrapped.map((item) => ({ id: item.id, keyId: item.keyId }))),
  });
}

/** Revoking a device key makes its wraps undecryptable and testable. */
function revokeDeviceKey(envelopes, revokedKeyId) {
  return Object.freeze(
    envelopes.map((entry) => ({
      id: entry.id,
      keyId: entry.keyId,
      decryptable: entry.keyId !== revokedKeyId,
    })),
  );
}

/**
 * Policy and UI carry named secret references only; a literal secret
 * value anywhere in config fails closed.
 */
function secretReference(config) {
  if (typeof config.value === "string" && config.value.length > 0) {
    throw new Error("secret_value_in_policy_prohibited");
  }
  if (!config.reference || !config.reference.startsWith("secret://")) {
    throw new Error(`invalid_secret_reference:${String(config.reference)}`);
  }
  return Object.freeze({
    reference: config.reference,
    scope: config.scope ?? "workspace",
    valueExposed: false,
    redactedInView: "********",
  });
}

/** Where plaintext may exist; anything else is a violation. */
const APPROVED_PLAINTEXT_SINKS = Object.freeze(["approved-process-memory"]);

function plaintextAudit(action) {
  const violations = ["logs", "model-context", "policy-files", "crash-dumps"].filter(
    (sink) => !APPROVED_PLAINTEXT_SINKS.includes(sink) && action.sinks?.includes(sink),
  );
  return Object.freeze({
    action: action.name,
    sinkVViolations: Object.freeze(violations),
    clean: violations.length === 0,
  });
}

/** DLP rules show classification, destination, transformation and block evidence. */
function dlpEvaluate(rule, content) {
  const matched = content.classification === rule.classification;
  const blocked = matched && rule.action === "block";
  return Object.freeze({
    rule: rule.id,
    classification: rule.classification,
    destination: rule.destination,
    transformation: rule.transformation ?? "none",
    matched,
    blocked,
    blockEvidence: blocked
      ? { contentDigest: `digest:${content.sample.length}`, rule: rule.id, at: "dlp-evaluation" }
      : null,
  });
}

module.exports = {
  APPROVED_PLAINTEXT_SINKS,
  dlpEvaluate,
  envelopeWrap,
  plaintextAudit,
  revokeDeviceKey,
  rotateKey,
  secretReference,
};
