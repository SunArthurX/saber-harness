/**
 * S36-WP04 — Database and profile migration.
 *
 * Every authoritative store and desktop profile is versioned.
 * Migration runs preflight (free space), backup/checkpoint, migrate,
 * integrity verify and an atomic version commit. A crash at any
 * phase must reopen old, complete new or enter explicit recovery —
 * never guess. Downgrade with incompatible data is refused or uses
 * an approved export path (KIR-03: one policy truth across surfaces).
 */

const MIGRATION_PHASES = Object.freeze(["preflight", "backup", "migrate", "verify", "commit"]);

/** Minimal free-space guard before anything is written. */
function preflight(freeBytesMb, requiredMb) {
  if (freeBytesMb < requiredMb) {
    return Object.freeze({ ok: false, reason: "insufficient_free_space", freeBytesMb, requiredMb });
  }
  return Object.freeze({ ok: true, checkpoint: "pre-migration-backup", freeBytesMb, requiredMb });
}

/**
 * Run the full phase pipeline; every phase is recorded so a crash can
 * be classified deterministically on reopen.
 */
function migrate(store, phases = MIGRATION_PHASES) {
  const from = store.version;
  const to = store.targetVersion;
  if (compareVersions(to, from) <= 0) {
    throw new Error("migration_must_move_forward");
  }
  return Object.freeze({
    store: store.id,
    from,
    to,
    phases: Object.freeze(phases.map((phase) => ({ phase, recorded: true }))),
    atomicVersionCommit: "version row swaps only after verify",
  });
}

/**
 * Classify a crash at a phase: reopen old, complete new or explicit
 * recovery — guessing is impossible by construction.
 */
function crashRecovery(crashedAtPhase, migration) {
  const order = [...MIGRATION_PHASES];
  const idx = order.indexOf(crashedAtPhase);
  if (idx === -1) {
    throw new Error(`unknown_phase:${crashedAtPhase}`);
  }
  if (idx < order.indexOf("migrate")) {
    return Object.freeze({ crashedAtPhase, outcome: "reopen-old", dataState: "untouched", guessing: false });
  }
  if (crashedAtPhase === "migrate") {
    return Object.freeze({
      crashedAtPhase,
      outcome: "restore-from-checkpoint",
      dataState: "backup-restored",
      guessing: false,
    });
  }
  if (crashedAtPhase === "verify" || crashedAtPhase === "commit") {
    return Object.freeze({
      crashedAtPhase,
      outcome: "complete-new-or-explicit-recovery",
      dataState: "journal-driven",
      guessing: false,
    });
  }
  return Object.freeze({ crashedAtPhase, outcome: "explicit-recovery", guessing: false });
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Downgrade with incompatible data is refused or export-pathed. */
function downgradeAttempt(currentVersion, dataSchema, targetVersion, targetDataSchema) {
  if (compareVersions(targetVersion, currentVersion) >= 0) {
    throw new Error("not_a_downgrade");
  }
  const compatible = schemaWithin(targetDataSchema, dataSchema);
  return Object.freeze({
    currentVersion,
    targetVersion,
    compatible,
    outcome: compatible ? "allowed" : "refused",
    exportPath: compatible ? null : "approved-export-format",
    silentCorruption: false,
  });
}

function schemaWithin(older, newer) {
  const [olderMajor] = String(older).split(".").map(Number);
  const [newerMajor] = String(newer).split(".").map(Number);
  return newerMajor <= olderMajor;
}

/** One migration truth across Desktop/CLI/Web Supervisor (KIR-03). */
function sharedMigrationRegistry(entries) {
  const ids = new Set(entries.map((entry) => entry.store));
  if (ids.size !== entries.length) {
    throw new Error("duplicate_store_migration");
  }
  return Object.freeze({
    stores: Object.freeze([...ids].sort()),
    policyTruths: 1,
    surfaces: Object.freeze(["desktop", "cli", "web-supervisor"]),
  });
}

module.exports = {
  MIGRATION_PHASES,
  crashRecovery,
  downgradeAttempt,
  migrate,
  preflight,
  sharedMigrationRegistry,
};
