import { spawnSync } from "node:child_process";

export const DEFAULT_REPOSITORY = "SunArthurX/saber-harness";
export const REQUIRED_STATUS_CONTEXT = "repository-verification";
export const REQUIRED_STATUS_CONTEXTS = Object.freeze([
  REQUIRED_STATUS_CONTEXT,
  "monorepo-ubuntu-latest",
  "monorepo-macos-latest",
  "monorepo-windows-latest",
  "dependency-audit",
]);

export const repositorySettings = Object.freeze({
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  delete_branch_on_merge: true,
  allow_update_branch: true,
});

export const protectionPolicy = Object.freeze({
  required_status_checks: {
    strict: true,
    contexts: REQUIRED_STATUS_CONTEXTS,
  },
  enforce_admins: true,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 0,
    require_last_push_approval: false,
  },
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: false,
  required_conversation_resolution: true,
  lock_branch: false,
  allow_fork_syncing: false,
});

export class CommandError extends Error {
  constructor(message, { status, stdout, stderr }) {
    super(message);
    this.name = "CommandError";
    this.status = status;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function run(command, args, { input } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
    maxBuffer: 4 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new CommandError(`${command} exited with status ${result.status}`, {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    });
  }
  return result.stdout.trim();
}

export function ghApiJson(endpoint, { method = "GET", body } = {}) {
  const args = ["api"];
  if (method !== "GET") args.push("--method", method);
  args.push(endpoint);
  if (body !== undefined) args.push("--input", "-");
  const output = run("gh", args, {
    input: body === undefined ? undefined : `${JSON.stringify(body)}\n`,
  });
  return output === "" ? null : JSON.parse(output);
}

export function classifyGitHubFailure(error) {
  const message = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
  if (
    /HTTP 403|"status"\s*:\s*"?403"?/.test(message) &&
    /Upgrade to GitHub Pro|make this repository public/i.test(message)
  ) {
    return "private-branch-protection-entitlement";
  }
  if (/HTTP 401|"status"\s*:\s*"?401"?/.test(message)) return "github-authentication";
  if (/HTTP 404|"status"\s*:\s*"?404"?/.test(message)) return "repository-or-branch-not-found";
  return "github-api-error";
}

export function evaluateRepository(repository, { expectedVisibility = "public" } = {}) {
  return [
    [repository?.visibility === expectedVisibility, `repository-${expectedVisibility}`],
    [repository?.default_branch === "main", "default-branch-main"],
    [repository?.allow_squash_merge === true, "squash-merge-enabled"],
    [repository?.allow_merge_commit === false, "merge-commit-disabled"],
    [repository?.allow_rebase_merge === false, "rebase-merge-disabled"],
    [repository?.delete_branch_on_merge === true, "delete-merged-branch-enabled"],
    [repository?.allow_update_branch === true, "update-branch-enabled"],
  ].map(([passed, id]) => ({ id, passed }));
}

export function evaluateProtection(protection) {
  const contexts = protection?.required_status_checks?.contexts ?? [];
  return [
    [protection?.required_status_checks?.strict === true, "strict-status-checks"],
    ...REQUIRED_STATUS_CONTEXTS.map((context) => [contexts.includes(context), `${context}-required`]),
    [protection?.enforce_admins?.enabled === true, "admins-enforced"],
    [
      protection?.required_pull_request_reviews !== null && protection?.required_pull_request_reviews !== undefined,
      "pull-request-required",
    ],
    [protection?.required_linear_history?.enabled === true, "linear-history-required"],
    [protection?.required_conversation_resolution?.enabled === true, "conversation-resolution-required"],
    [protection?.allow_force_pushes?.enabled === false, "force-push-disabled"],
    [protection?.allow_deletions?.enabled === false, "branch-deletion-disabled"],
  ].map(([passed, id]) => ({ id, passed }));
}

export function assertChecks(checks, label) {
  const failed = checks.filter(({ passed }) => !passed);
  for (const check of checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"} ${label}: ${check.id}`);
  }
  if (failed.length > 0) {
    throw new Error(`${label} failed: ${failed.map(({ id }) => id).join(", ")}`);
  }
}

export function parseRepositoryArgument(argv) {
  const index = argv.indexOf("--repo");
  const repository = index === -1 ? DEFAULT_REPOSITORY : argv[index + 1];
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("--repo must be in owner/name form");
  }
  return repository;
}
