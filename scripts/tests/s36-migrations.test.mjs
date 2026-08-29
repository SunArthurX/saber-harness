/**
 * S36-WP04 — database/profile migration tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const migration = await src("storeMigration.js");

test("S36-WP04 preflight guards free space and takes a checkpoint", () => {
  const ok = migration.preflight(2048, 512);
  assert.equal(ok.ok, true);
  assert.equal(ok.checkpoint, "pre-migration-backup");
  const tight = migration.preflight(100, 512);
  assert.equal(tight.ok, false);
  assert.equal(tight.reason, "insufficient_free_space");
});

test("S36-WP04 migrations record every phase and commit atomically", () => {
  assert.deepEqual([...migration.MIGRATION_PHASES], ["preflight", "backup", "migrate", "verify", "commit"]);
  const result = migration.migrate({ id: "event-store", version: "3.0", targetVersion: "4.0" });
  assert.equal(result.from, "3.0");
  assert.equal(result.to, "4.0");
  assert.equal(result.phases.length, 5);
  assert.ok(result.phases.every((phase) => phase.recorded === true));
  assert.equal(result.atomicVersionCommit, "version row swaps only after verify");
  assert.throws(
    () => migration.migrate({ id: "x", version: "4.0", targetVersion: "4.0" }),
    /migration_must_move_forward/,
  );
});

test("S36-WP04 crashes at every phase resolve without guessing", () => {
  const expectations = {
    preflight: "reopen-old",
    backup: "reopen-old",
    migrate: "restore-from-checkpoint",
    verify: "complete-new-or-explicit-recovery",
    commit: "complete-new-or-explicit-recovery",
  };
  for (const [phase, outcome] of Object.entries(expectations)) {
    const result = migration.crashRecovery(phase, { from: "3.0", to: "4.0" });
    assert.equal(result.outcome, outcome, phase);
    assert.equal(result.guessing, false, phase);
  }
  assert.throws(() => migration.crashRecovery("during-lunch", {}), /unknown_phase/);
});

test("S36-WP04 incompatible downgrades are refused or export-pathed", () => {
  const refused = migration.downgradeAttempt("4.0", "4.1", "3.0", "3.1");
  assert.equal(refused.compatible, false);
  assert.equal(refused.outcome, "refused");
  assert.equal(refused.exportPath, "approved-export-format");
  assert.equal(refused.silentCorruption, false);
  const allowed = migration.downgradeAttempt("4.2", "4.1", "4.0", "4.1");
  assert.equal(allowed.outcome, "allowed");
  assert.throws(() => migration.downgradeAttempt("3.0", "3.1", "4.0", "4.1"), /not_a_downgrade/);
});

test("S36-WP04 desktop, CLI and web supervisor share one migration truth (KIR-03)", () => {
  const registry = migration.sharedMigrationRegistry([
    { store: "event-store" },
    { store: "desktop-profile" },
    { store: "policy-cache" },
  ]);
  assert.deepEqual([...registry.stores], ["desktop-profile", "event-store", "policy-cache"]);
  assert.equal(registry.policyTruths, 1);
  assert.deepEqual([...registry.surfaces], ["desktop", "cli", "web-supervisor"]);
  assert.throws(
    () => migration.sharedMigrationRegistry([{ store: "event-store" }, { store: "event-store" }]),
    /duplicate_store_migration/,
  );
});
