#!/usr/bin/env node
/**
 * S37 deterministic readiness gate — evaluates the eleven required
 * families from immutable committed descriptors
 * (fixtures/readiness/descriptors.json) and prints the report with
 * finding IDs and digest. Exits non-zero unless the verdict is ready.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { evaluateGate } = require(join(root, "apps/desktop-codeoss/extensions/saber-agent/src/readinessGate.js"));

const descriptors = JSON.parse(readFileSync(join(root, "fixtures/readiness/descriptors.json"), "utf8"));
const report = evaluateGate(descriptors);

console.log(
  JSON.stringify(
    {
      verdict: report.verdict,
      digest: report.digest,
      metadataOnly: report.metadataOnly,
      families: report.families.map((family) => ({
        family: family.family,
        status: family.status,
        findings: family.findings.length,
      })),
      blockerFindings: report.blockerFindings,
      missingFamilies: report.missingFamilies,
    },
    null,
    2,
  ),
);

if (report.verdict !== "ready") {
  console.error(`readiness gate NOT ready: ${report.verdict}`);
  process.exit(1);
}
console.log("readiness gate: ready");
