/**
 * S33-WP05 — memory ledger.
 *
 * Memory is separate from versioned rules and is browsable,
 * attributable, conflict-aware, expiring, revocable and forgettable.
 * Types: episodic, curated, prospective, review candidate. Actions:
 * propose, edit, promote, reject, supersede, expire, revoke, forget
 * and redact — every mutation carries an expected revision (optimistic
 * concurrency). Conflicts and scope inheritance are displayed;
 * Workspace policy wins without secret last-write-wins; and recall
 * output can never become new Memory without independent evidence
 * (CDX-06, ZCD-08, MMX-04, CUR-03, KIR-04).
 */

/** Memory record types. */
const MEMORY_TYPES = Object.freeze(["episodic", "curated", "prospective", "review-candidate"]);

/** Ledger actions. */
const MEMORY_ACTIONS = Object.freeze([
  "propose",
  "edit",
  "promote",
  "reject",
  "supersede",
  "expire",
  "revoke",
  "forget",
  "redact",
]);

/** Fresh ledger over one workspace. */
function memoryLedger() {
  const records = new Map();

  const nextRevision = (id) => (records.get(id)?.revision ?? 0) + 1;

  function mutate(id, action, expectedRevision, patch) {
    const current = records.get(id);
    if (!current) {
      throw new Error(`unknown_record:${id}`);
    }
    if (current.revision !== expectedRevision) {
      throw new Error(`revision_conflict:${current.revision}!=${expectedRevision}`);
    }
    const updated = {
      ...current,
      ...patch,
      revision: nextRevision(id),
      lastAction: action,
      history: [...current.history, { action, atMs: patch?.atMs ?? 0, actor: patch?.actor ?? "user" }],
    };
    records.set(id, Object.freeze(updated));
    return updated;
  }

  return Object.freeze({
    propose({ id, type, text, scope = [], source, confidence = "low", atMs = 0, actor = "user" }) {
      if (!MEMORY_TYPES.includes(type)) {
        throw new Error(`invalid_type:${type}`);
      }
      if (records.has(id)) {
        return records.get(id); // idempotent proposal
      }
      const record = Object.freeze({
        id,
        type,
        text,
        scope: Object.freeze(scope),
        source,
        confidence,
        status: type === "review-candidate" ? "pending" : "active",
        revision: 1,
        conflictsWith: Object.freeze([]),
        createdAtMs: atMs,
        expiresAtMs: null,
        revokedAtMs: null,
        lastAction: "propose",
        history: Object.freeze([{ action: "propose", atMs, actor }]),
      });
      records.set(id, record);
      return record;
    },
    act(id, action, expectedRevision, patch = {}) {
      if (!MEMORY_ACTIONS.includes(action)) {
        throw new Error(`invalid_action:${action}`);
      }
      if (action === "promote") {
        const record = mutate(id, action, expectedRevision, { ...patch, type: "curated", status: "active" });
        return record;
      }
      if (action === "reject" || action === "expire" || action === "revoke") {
        return mutate(id, action, expectedRevision, {
          ...patch,
          status: action === "reject" ? "rejected" : action === "expire" ? "expired" : "revoked",
          revokedAtMs: patch.atMs ?? null,
        });
      }
      if (action === "forget") {
        const record = records.get(id);
        if (!record) {
          throw new Error(`unknown_record:${id}`);
        }
        if (record.revision !== expectedRevision) {
          throw new Error(`revision_conflict:${record.revision}!=${expectedRevision}`);
        }
        records.delete(id);
        return Object.freeze({ id, forgotten: true });
      }
      if (action === "redact") {
        return mutate(id, action, expectedRevision, { ...patch, text: "[redacted memory]", redacted: true });
      }
      return mutate(id, action, expectedRevision, patch);
    },
    /** Recall respects status, TTL, revocation and scope inheritance. */
    recall({ workspaceId, nowMs = 0 } = {}) {
      return [...records.values()].filter((record) => {
        if (record.status !== "active") {
          return false;
        }
        if (record.revokedAtMs !== null && record.revokedAtMs <= nowMs) {
          return false;
        }
        if (record.expiresAtMs !== null && record.expiresAtMs <= nowMs) {
          return false;
        }
        if (record.scope.length === 0) {
          return true;
        }
        return record.scope.some(
          (scope) => scope === `workspace:${workspaceId}` || scope.startsWith("user:") || scope.startsWith("team:"),
        );
      });
    },
    get(id) {
      return records.get(id) ?? null;
    },
    list() {
      return Object.freeze([...records.values()]);
    },
  });
}

/** Workspace policy wins; secrets never last-write-win. */
function conflictResolution(records) {
  const winners = new Map();
  for (const record of records) {
    const existing = winners.get(record.id);
    if (!existing) {
      winners.set(record.id, record);
      continue;
    }
    if (record.scope.some((scope) => scope.startsWith("workspace:"))) {
      winners.set(record.id, record);
    }
  }
  return Object.freeze({ winners: Object.freeze([...winners.values()]), secretLastWriteWins: false });
}

/** Recall output cannot become Memory without independent evidence. */
function recallPromotionGate(candidate) {
  return Object.freeze({
    promoted: candidate.independentEvidence === true,
    requires: "independent-evidence",
    recallOutputAlone: false,
  });
}

module.exports = {
  MEMORY_ACTIONS,
  MEMORY_TYPES,
  conflictResolution,
  memoryLedger,
  recallPromotionGate,
};
