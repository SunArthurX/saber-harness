import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGitHubFailure,
  evaluateProtection,
  evaluateRepository,
  parseRepositoryArgument
} from "../lib/github-protection.mjs";

test("repository evaluation accepts the S00 governance settings", () => {
  const checks = evaluateRepository({
    private: true,
    default_branch: "main",
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
    allow_update_branch: true
  });
  assert.equal(checks.every(({passed}) => passed), true);
});

test("protection evaluation rejects a missing required check", () => {
  const checks = evaluateProtection({
    required_status_checks: {strict: true, contexts: []},
    enforce_admins: {enabled: true},
    required_pull_request_reviews: {},
    required_linear_history: {enabled: true},
    required_conversation_resolution: {enabled: true},
    allow_force_pushes: {enabled: false},
    allow_deletions: {enabled: false}
  });
  assert.equal(checks.find(({id}) => id === "repository-verification-required")?.passed, false);
});

test("protection evaluation accepts the intended GitHub response", () => {
  const checks = evaluateProtection({
    required_status_checks: {strict: true, contexts: ["repository-verification"]},
    enforce_admins: {enabled: true},
    required_pull_request_reviews: {},
    required_linear_history: {enabled: true},
    required_conversation_resolution: {enabled: true},
    allow_force_pushes: {enabled: false},
    allow_deletions: {enabled: false}
  });
  assert.equal(checks.every(({passed}) => passed), true);
});

test("GitHub entitlement errors are classified without treating them as success", () => {
  const classification = classifyGitHubFailure({
    stdout: '{"message":"Upgrade to GitHub Pro or make this repository public","status":"403"}',
    stderr: "gh: HTTP 403"
  });
  assert.equal(classification, "private-branch-protection-entitlement");
});

test("repository argument defaults and validates owner/name", () => {
  assert.equal(parseRepositoryArgument([]), "SunArthurX/saber-harness");
  assert.equal(parseRepositoryArgument(["--repo", "owner/repo"]), "owner/repo");
  assert.throws(() => parseRepositoryArgument(["--repo", "invalid"]));
});
