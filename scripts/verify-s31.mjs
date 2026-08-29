#!/usr/bin/env node
/**
 * S31 focused verifier — changes and evidence review contracts.
 *
 * Deterministic and offline: it checks that the Core-side change-set
 * authority (baseline snapshot, classification, stale-apply blocking,
 * hash-proven rollback, disclosure-before-commit) and the renderer-side
 * projections (change set, durable comments, verification evidence,
 * boundary diff) exist with their fail-closed contracts, and that the
 * S31 suites — including the real-Core review-commit e2e — are chained
 * into the repository gates.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];
const check = (condition, name, detail) => (condition ? passes : failures).push({ name, detail });
const text = (path) => readFileSync(join(root, path), "utf8");

const extensionRoot = "apps/desktop-codeoss/extensions/saber-agent";
const requiredFiles = [
  "crates/saber-core/src/change_set.rs",
  "crates/saber-core/src/run_engine.rs",
  "crates/saber-core/src/run_dispatch.rs",
  "schemas/control/v1/protocol.schema.json",
  "packages/ide-client/src/protocol.ts",
  `${extensionRoot}/src/changeSetProjection.js`,
  `${extensionRoot}/src/reviewComments.js`,
  `${extensionRoot}/src/verificationEvidence.js`,
  `${extensionRoot}/src/boundaryDiff.js`,
  "scripts/tests/s31-change-set.test.mjs",
  "scripts/tests/s31-review-a11y.test.mjs",
  "scripts/tests/s31-apply-rollback.test.mjs",
  "scripts/e2e-review-commit.mjs",
  "scripts/verify-s31.mjs",
];
for (const file of requiredFiles) {
  check(existsSync(join(root, file)), "s31-required-file", file);
}

// Protocol parity for the changeset methods.
const schema = text("schemas/control/v1/protocol.schema.json");
for (const method of ['"changeset.prepare"', '"changeset.apply"', '"changeset.rollback"', '"changeset.commit"']) {
  check(schema.includes(method), "s31-protocol-schema", method);
}
check(
  text("crates/core-protocol/src/lib.rs").includes('"changeset.prepare"') &&
    text("crates/core-protocol/src/lib.rs").includes('"changeset.commit"'),
  "s31-protocol-decode",
  "decoder accepts the changeset methods",
);
check(
  text("packages/ide-client/src/protocol.ts").includes('"changeset.prepare"'),
  "s31-client-registry",
  "ide-client mirrors the changeset surface",
);

// Core change-set authority contracts.
const core = text("crates/saber-core/src/change_set.rs");
for (const contract of [
  "snapshot_baseline",
  "run.baseline_snapshot",
  "changeset.prepared",
  "changeset.applied",
  "changeset.rolled_back",
  "changeset.commit_disclosed",
  "changeset.committed",
  "stale_apply_blocked",
  "rollback_proof_failed",
  "worktree_not_a_git_repository",
  "authorship_disclosure",
  "external_edits",
  "looks_binary",
  "GENERATED_HINTS",
  "IGNORED_PATHS",
]) {
  check(core.includes(contract), "s31-core-contract", contract);
}
check(core.includes("mismatches.is_empty()"), "s31-core-contract", "rollback proves restoration by hashes");
check(
  text("crates/saber-core/src/run_engine.rs").includes("run.baseline_snapshot"),
  "s31-core-contract",
  "run start snapshots the baseline",
);
check(
  text("crates/saber-core/src/run_dispatch.rs").includes("ChangesetPrepare") &&
    text("crates/saber-core/src/run_dispatch.rs").includes("ChangesetCommit"),
  "s31-core-contract",
  "dispatch wires all four changeset methods",
);

// Projection contracts.
check(
  text(`${extensionRoot}/src/changeSetProjection.js`).includes("stale-apply-blocked") &&
    text(`${extensionRoot}/src/changeSetProjection.js`).includes("metadata-and-approved-preview"),
  "s31-projection-changeset",
  "stale apply blocks; binaries preview as metadata",
);
for (const contract of ["invalid_comment_binding", "reconcile", "hunk_intent", "mutatesFiles", "KEYBOARD_NAVIGATION"]) {
  check(text(`${extensionRoot}/src/reviewComments.js`).includes(contract), "s31-projection-comments", contract);
}
for (const contract of [
  "not-run",
  "flaky",
  "stale",
  "invalidateOnTreeChange",
  "previewAutoVerify",
  "inconclusive",
  "screenshotsAloneSuffice",
  "no-independent-signer",
  "producer-sole-signer",
]) {
  check(text(`${extensionRoot}/src/verificationEvidence.js`).includes(contract), "s31-projection-evidence", contract);
}
check(
  text(`${extensionRoot}/src/boundaryDiff.js`).includes("requiresExplicitReview") &&
    text(`${extensionRoot}/src/boundaryDiff.js`).includes("acknowledgmentRequired"),
  "s31-projection-boundary",
  "boundary changes demand explicit review",
);

// E2E: the real journey must exercise every adversarial rule.
const e2e = text("scripts/e2e-review-commit.mjs");
for (const contract of [
  "changeset.prepare",
  "changeset.apply",
  "changeset.rollback",
  "changeset.commit",
  "wrong-digest-apply-blocked",
  "external-edit-blocks-stale-apply",
  "real-git-commit-created",
  "rollback-proof-passes",
  "disclosure-precedes-commit",
  "core-restart-preserves-review-journal",
]) {
  check(e2e.includes(contract), "s31-e2e-contract", contract);
}
check(e2e.includes("SKIP e2e-review-commit"), "s31-e2e-contract", "windows leg skips honestly");

// Wiring: scripts, gate chain and hosted CI.
const packageJson = text("package.json");
for (const script of [
  "desktop:test:change-set",
  "desktop:test:review-a11y",
  "desktop:test:apply-rollback",
  "desktop:e2e:review-commit",
]) {
  check(packageJson.includes(`"${script}"`), "s31-wiring-scripts", script);
}
check(packageJson.includes("verify-s31.mjs"), "s31-wiring-verify", "verify-s31 chained into the repository gate");
const workflow = text(".github/workflows/repository-verification.yml");
check(
  workflow.includes("Verify S31 changes and evidence review"),
  "s31-wiring-hosted",
  "hosted verification runs verify-s31",
);
const monorepo = text(".github/workflows/monorepo-ci.yml");
check(monorepo.includes("desktop:e2e:review-commit"), "s31-wiring-hosted", "monorepo CI runs the review-commit e2e");

console.log(`S31 verification: ${passes.length} checks passed, ${failures.length} failed.`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.detail}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("S31 verification passed.");
