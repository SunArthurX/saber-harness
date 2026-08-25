#!/usr/bin/env node

import {
  assertChecks,
  classifyGitHubFailure,
  evaluateProtection,
  evaluateRepository,
  ghApiJson,
  parseRepositoryArgument,
  protectionPolicy,
  repositorySettings,
} from "./lib/github-protection.mjs";

const argv = process.argv.slice(2);
const repository = parseRepositoryArgument(argv);
const apply = argv.includes("--apply");

function printEntitlementBlocker() {
  console.error("BLOCKED private-branch-protection-entitlement");
  console.error("GitHub requires Pro or an eligible organization plan for protection on this private repository.");
  console.error("Do not make the repository public merely to bypass this control.");
}

try {
  let repositoryInfo = ghApiJson(`repos/${repository}`);
  assertChecks(evaluateRepository(repositoryInfo), "repository-setting");

  if (apply) {
    console.log(`APPLY repository settings: ${repository}`);
    ghApiJson(`repos/${repository}`, { method: "PATCH", body: repositorySettings });
    console.log("APPLY branch protection: main");
    ghApiJson(`repos/${repository}/branches/main/protection`, {
      method: "PUT",
      body: protectionPolicy,
    });
    repositoryInfo = ghApiJson(`repos/${repository}`);
    assertChecks(evaluateRepository(repositoryInfo), "repository-setting-after-apply");
  } else {
    console.log("VERIFY-ONLY mode; pass --apply to configure the policy before verification.");
  }

  const protection = ghApiJson(`repos/${repository}/branches/main/protection`);
  assertChecks(evaluateProtection(protection), "main-protection");
  console.log(`PASS protected main baseline: ${repository}`);
} catch (error) {
  const classification = classifyGitHubFailure(error);
  if (classification === "private-branch-protection-entitlement") {
    printEntitlementBlocker();
    process.exitCode = 2;
  } else {
    console.error(`FAIL ${classification}: ${error.message}`);
    process.exitCode = 1;
  }
}
