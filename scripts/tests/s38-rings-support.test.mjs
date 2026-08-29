/**
 * S38-WP03/WP04 — rings and support/incident readiness tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const rings = await src("releaseRings.js");

const plan = {
  startThresholds: { readiness: "ready" },
  stopThresholds: { regression: 0 },
  cohort: "internal",
  duration: "2w",
  owner: "release-lead",
  rollback: { strategy: "demote" },
};

test("S38-WP03 ring plans fail closed without all control fields", () => {
  assert.deepEqual([...rings.RINGS], ["internal-alpha", "private-beta", "release-candidate"]);
  const alpha = rings.ringPlan("internal-alpha", plan);
  assert.equal(alpha.owner, "release-lead");
  assert.equal(alpha.productionSignedArtifacts, false);
  const rc = rings.ringPlan("release-candidate", plan);
  assert.equal(rc.productionSignedArtifacts, true);
  assert.equal(rc.usesUpdateChannel, true);
  assert.throws(() => rings.ringPlan("wild-beta", plan), /unknown_ring:wild-beta/);
  assert.throws(() => rings.ringPlan("internal-alpha", { ...plan, owner: undefined }), /ring_plan_missing:owner/);
});

test("S38-WP03 rings advance in order", () => {
  assert.equal(rings.ringProgression(["internal-alpha"], "private-beta").allowed, true);
  const skipped = rings.ringProgression(["internal-alpha"], "release-candidate");
  assert.equal(skipped.allowed, false);
  assert.deepEqual([...skipped.missingPrerequisites], ["private-beta"]);
  assert.equal(rings.ringProgression(["internal-alpha", "private-beta"], "release-candidate").allowed, true);
  assert.throws(() => rings.ringProgression([], "gamma"), /unknown_ring/);
});

test("S38-WP04 support readiness needs five playbooks and five rehearsals", () => {
  assert.deepEqual([...rings.PLAYBOOKS], ["severity", "on-call", "communication", "rca", "security-disclosure"]);
  assert.deepEqual(
    [...rings.REHEARSALS],
    ["bad-update", "provider-outage", "sync-loss", "secret-incident", "corrupted-local-profile"],
  );
  const ready = rings.supportReadiness([...rings.PLAYBOOKS], [...rings.REHEARSALS]);
  assert.equal(ready.ready, true);
  assert.equal(ready.userFacingDiagnostics, true);
  assert.equal(ready.selfServiceRecovery, true);
  const missing = rings.supportReadiness(["severity"], ["bad-update"]);
  assert.equal(missing.ready, false);
  assert.ok(missing.missingPlaybooks.includes("rca"));
  assert.ok(missing.missingRehearsals.includes("secret-incident"));
});

test("S38-WP04 support can never request raw secrets or unrestricted private repositories", () => {
  assert.equal(rings.supportRequest({ rawSecrets: true }).accepted, false);
  assert.match(rings.supportRequest({ rawSecrets: true }).reason, /raw_secrets/);
  const unrestricted = rings.supportRequest({ unrestrictedPrivateRepositories: true });
  assert.equal(unrestricted.accepted, false);
  assert.match(unrestricted.reason, /unrestricted_private_repositories/);
  const ok = rings.supportRequest({ redactedBundle: true });
  assert.equal(ok.accepted, true);
  assert.match(ok.bundle, /user-reviewed/);
});
