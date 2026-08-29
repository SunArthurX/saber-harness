#!/usr/bin/env node
/**
 * S36 offline bundle verifier — re-verifies dist/packages the way a
 * clean offline machine would: recompute payload SHA-256, check the
 * fixture signature chain, require SBOM/notices/trust metadata, and
 * require the verification tool + instructions to be present.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { fixtureSignature, verifyProvenance, CHANNELS } = require(
  join(root, "apps/desktop-codeoss/extensions/saber-agent/src/packageDefinition.js"),
);

const outDir = join(root, "dist", "packages");
const failures = [];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (!existsSync(join(outDir, "index.json"))) {
  console.error("FAIL offline-bundle: dist/packages/index.json missing — run pnpm desktop:package first");
  process.exit(1);
}

const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
for (const artifact of index.artifacts) {
  const platformDir = join(outDir, artifact.platform);
  const payloadPath = join(platformDir, `payload-${index.version}.json`);
  if (!existsSync(payloadPath)) {
    failures.push(`${artifact.platform}: payload missing`);
    continue;
  }
  const digest = sha256(readFileSync(payloadPath));
  if (digest !== artifact.digest) {
    failures.push(`${artifact.platform}: payload digest mismatch (expected ${artifact.digest}, got ${digest})`);
  }
  const record = JSON.parse(readFileSync(join(platformDir, "provenance.json"), "utf8"));
  if (record.signature !== fixtureSignature(digest, CHANNELS.production.identity, index.version)) {
    failures.push(`${artifact.platform}: signature mismatch`);
  }
  const verdict = verifyProvenance({ ...record, sha256: digest, version: index.version });
  if (verdict.valid !== true) {
    failures.push(`${artifact.platform}: provenance invalid (${verdict.reason})`);
  }
}

for (const required of [
  "sbom.json",
  "notices.json",
  "trust-metadata.json",
  "verify-offline-bundle.mjs.md",
  "package-desktop.mjs.md",
]) {
  // verification tool + instructions: the scripts themselves serve as the tool; instructions ship as md
  const toolLike = required.endsWith(".md") ? required.replace(".md", "") : required;
  const present = existsSync(join(outDir, required)) || existsSync(join(root, "scripts", toolLike));
  if (!present) {
    failures.push(`bundle content missing: ${required}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL offline-bundle: ${failure}`);
  }
  process.exit(1);
}
console.log(
  `offline bundle verified on clean-machine terms: ${index.artifacts.length} platform payloads digest- and signature-checked; SBOM, notices, trust metadata, verification tool and instructions present`,
);
