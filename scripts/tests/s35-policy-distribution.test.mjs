/**
 * S35-WP02 — policy distribution tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const policy = await src("policyDistribution.js");

test("S35-WP02 bundles are signed by the enterprise key only", () => {
  const b = policy.bundle(1, "enterprise-policy-key", [{ effect: "deny", action: "net.egress" }]);
  assert.equal(b.signed, true);
  assert.equal(b.scope, "org");
  assert.throws(() => policy.bundle(1, "intern-laptop-key", []), /untrusted_policy_signer/);
});

test("S35-WP02 distribution is monotonic: rollback and replay fail, newer is accepted", () => {
  const first = policy.acceptBundle(null, policy.bundle(1, "enterprise-policy-key", []));
  assert.equal(first.accepted, 1);
  const second = policy.acceptBundle(
    policy.bundle(1, "enterprise-policy-key", []),
    policy.bundle(2, "enterprise-policy-key", []),
  );
  assert.equal(second.accepted, 2);
  assert.equal(second.lastAcceptedSequence, 1);
  const same = policy.bundle(1, "enterprise-policy-key", []);
  assert.throws(
    () => policy.acceptBundle(policy.bundle(2, "enterprise-policy-key", []), same),
    /policy_rollback_or_replay:2->1/,
  );
  assert.throws(() => policy.acceptBundle(null, { signed: false }), /unsigned_or_untrusted_bundle/);
});

test("S35-WP02 lower scope cannot weaken an org deny", () => {
  const org = [policy.bundle(1, "enterprise-policy-key", [{ effect: "deny", action: "secret.export" }])];
  const narrowed = [
    policy.bundle(2, "enterprise-policy-key", [{ effect: "allow", action: "secret.export" }], "workspace-1"),
  ];
  const attempt = policy.weakeningAttempt(org, narrowed, "secret.export");
  assert.equal(attempt.deniedBefore, true);
  assert.equal(attempt.deniedAfter, true);
  assert.equal(attempt.weakened, false);
  const effective = policy.effectivePolicy([...org, ...narrowed], "workspace-1");
  assert.equal(effective.denyWeakened, false);
  assert.ok(effective.deny.includes("secret.export"));
});

test("S35-WP02 effective policy shows scope, deny/allow and last accepted sequence", () => {
  const bundles = [
    policy.bundle(1, "enterprise-policy-key", [{ effect: "deny", action: "net.raw" }]),
    policy.bundle(2, "enterprise-policy-key", [{ effect: "allow", action: "net.https" }], "workspace-1"),
  ];
  const effective = policy.effectivePolicy(bundles, "workspace-1");
  assert.deepEqual([...effective.deny], ["net.raw"]);
  assert.deepEqual([...effective.allow], ["net.https"]);
  assert.equal(effective.lastAcceptedSequence, 2);
  const other = policy.effectivePolicy(bundles, "workspace-2");
  assert.deepEqual([...other.allow], []);
});

test("S35-WP02 offline clients use last-verified policy and surface staleness", () => {
  const fresh = policy.offlinePolicy({ deny: ["net.raw"] }, 1000, 900);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.source, "last-verified");
  assert.equal(fresh.silentDefaultFallback, false);
  const week = 7 * 24 * 60 * 60 * 1000;
  const stale = policy.offlinePolicy({ deny: ["net.raw"] }, week + 2000, 1000);
  assert.equal(stale.stale, true);
  assert.equal(stale.stalenessSurfaced, true);
});
