#!/usr/bin/env node

import {
  assertChecks,
  classifyGitHubFailure,
  evaluateProtection,
  evaluateRepository,
  ghApiJson,
  parseRepositoryArgument,
  run,
} from "./lib/github-protection.mjs";

const repository = parseRepositoryArgument(process.argv.slice(2));
const expectedSshRemote = `git@github.com:${repository}.git`;
const expectedHttpsRemote = `https://github.com/${repository}.git`;

function verifySuccessfulWorkflow(workflow) {
  const result = ghApiJson(
    `repos/${repository}/actions/workflows/${workflow}/runs?branch=main&status=success&per_page=1`,
  );
  const run = result?.workflow_runs?.[0];
  const passed = run?.conclusion === "success" && run?.head_branch === "main";
  console.log(`${passed ? "PASS" : "FAIL"} main-workflow: ${workflow}${run?.id ? ` run=${run.id}` : ""}`);
  if (!passed) throw new Error(`no successful main run found for ${workflow}`);
}

try {
  const remoteUrl = run("git", ["remote", "get-url", "origin"]);
  if (![expectedSshRemote, expectedHttpsRemote].includes(remoteUrl)) {
    throw new Error(`origin points to unexpected remote: ${remoteUrl}`);
  }
  console.log(`PASS origin: ${remoteUrl}`);

  const remoteMain = run("git", ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(remoteMain)) throw new Error("origin/main did not resolve to a commit SHA");
  console.log(`PASS remote-main-sha: ${remoteMain}`);

  const repositoryInfo = ghApiJson(`repos/${repository}`);
  assertChecks(evaluateRepository(repositoryInfo), "repository-setting");
  verifySuccessfulWorkflow("repository-verification.yml");
  verifySuccessfulWorkflow("main-provenance.yml");

  const protection = ghApiJson(`repos/${repository}/branches/main/protection`);
  assertChecks(evaluateProtection(protection), "main-protection");
  console.log(`S00 remote verification passed: ${repository}@${remoteMain}`);
} catch (error) {
  const classification = classifyGitHubFailure(error);
  if (classification === "private-branch-protection-entitlement") {
    console.error("BLOCKED private-branch-protection-entitlement");
    console.error(
      "All read-only remote checks before branch protection passed; GitHub rejected the protection query for this private repository.",
    );
    process.exitCode = 2;
  } else {
    console.error(`FAIL ${classification}: ${error.message}`);
    process.exitCode = 1;
  }
}
