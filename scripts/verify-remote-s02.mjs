#!/usr/bin/env node

import {
  assertChecks,
  evaluateProtection,
  evaluateRepository,
  ghApiJson,
  parseRepositoryArgument,
  run,
} from "./lib/github-protection.mjs";

const argv = process.argv.slice(2);
const repository = parseRepositoryArgument(argv);
const branchIndex = argv.indexOf("--branch");
const branch = branchIndex === -1 ? run("git", ["branch", "--show-current"]) : argv[branchIndex + 1];
if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("--branch must name a valid Git branch");

const expectedSshRemote = `git@github.com:${repository}.git`;
const expectedHttpsRemote = `https://github.com/${repository}.git`;

function verifySuccessfulWorkflow(workflow, expectedHead) {
  const result = ghApiJson(
    `repos/${repository}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(branch)}&status=success&per_page=10`,
  );
  const workflowRun = result?.workflow_runs?.find((item) => item.head_sha === expectedHead);
  const passed = workflowRun?.conclusion === "success";
  console.log(
    `${passed ? "PASS" : "FAIL"} branch-workflow: ${workflow} branch=${branch}${workflowRun?.id ? ` run=${workflowRun.id}` : ""}`,
  );
  if (!passed) throw new Error(`no successful ${workflow} run found for ${branch}@${expectedHead}`);
}

const remoteUrl = run("git", ["remote", "get-url", "origin"]);
if (![expectedSshRemote, expectedHttpsRemote].includes(remoteUrl)) throw new Error(`unexpected origin: ${remoteUrl}`);
console.log(`PASS origin: ${remoteUrl}`);

const localHead = run("git", ["rev-parse", "HEAD"]);
const remoteHead = run("git", ["ls-remote", "origin", `refs/heads/${branch}`]).split(/\s+/)[0];
if (remoteHead !== localHead) throw new Error(`local/remote mismatch for ${branch}: ${localHead} != ${remoteHead}`);
console.log(`PASS remote-branch-sha: ${branch}@${remoteHead}`);

const repositoryInfo = ghApiJson(`repos/${repository}`);
assertChecks(evaluateRepository(repositoryInfo), "repository-setting");
const security = repositoryInfo?.security_and_analysis ?? {};
assertChecks(
  [
    [security.secret_scanning?.status === "enabled", "secret-scanning-enabled"],
    [security.secret_scanning_push_protection?.status === "enabled", "push-protection-enabled"],
    [security.dependabot_security_updates?.status === "enabled", "dependabot-security-updates-enabled"],
  ].map(([passed, id]) => ({ passed, id })),
  "security-setting",
);

const protection = ghApiJson(`repos/${repository}/branches/main/protection`);
assertChecks(evaluateProtection(protection), "main-protection");
verifySuccessfulWorkflow("repository-verification.yml", localHead);
verifySuccessfulWorkflow("monorepo-ci.yml", localHead);
console.log(`S02 remote verification passed: ${repository}:${branch}@${localHead}`);
