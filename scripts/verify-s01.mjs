#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {join} from "node:path";

import {loadTraceability, validateTraceability} from "./lib/traceability.mjs";

const root = process.cwd();
const failures = [];
const passes = [];

function check(condition, name, detail) {
  (condition ? passes : failures).push({name, detail});
}

function text(path) {
  return readFileSync(join(root, path), "utf8");
}

const requiredFiles = [
  "docs/governance/PRODUCT-CONSTITUTION.md",
  "docs/governance/EVOLUTION-BOUNDARIES.md",
  "docs/architecture/INVARIANTS.md",
  "docs/security/DATA-CLASSIFICATION.md",
  "docs/security/TRUST-BOUNDARIES.md",
  "docs/security/THREAT-MODEL-v0.md",
  "docs/adr/ADR-001-rust-trusted-core.md",
  "docs/adr/ADR-002-versioned-local-control-protocol.md",
  "docs/adr/ADR-003-sqlcipher-local-fact-store.md",
  "docs/adr/ADR-004-events-transactional-projections.md",
  "docs/adr/ADR-005-content-addressed-encrypted-blobs.md",
  "docs/adr/ADR-006-canonical-schema-codegen.md",
  "docs/traceability.yaml"
];

for (const file of requiredFiles) {
  try {
    check(text(file).trim().length > 0, "required-file", file);
  } catch {
    check(false, "required-file", file);
  }
}

try {
  const traceability = loadTraceability(join(root, "docs/traceability.yaml"));
  const validation = validateTraceability(traceability);
  check(validation.errors.length === 0, "traceability-contract", validation.errors.join(", ") || "valid");
  check(validation.summary.total >= 50, "requirement-count", String(validation.summary.total));
  check(validation.summary.p0 >= 40, "p0-count", String(validation.summary.p0));
  check(validation.summary.families === 9, "requirement-families", String(validation.summary.families));
} catch (error) {
  check(false, "traceability-json-compatible-yaml", error.message);
}

const constitution = text("docs/governance/PRODUCT-CONSTITUTION.md");
const principles = constitution.match(/^### PC-\d{2} —/gm) ?? [];
const nonGoals = constitution.match(/^- NG-\d{2}:/gm) ?? [];
check(principles.length === 10, "constitutional-principles", String(principles.length));
check(nonGoals.length >= 8, "v1-non-goals", String(nonGoals.length));
check(constitution.includes("ratified when its S01 pull request is merged"), "constitution-ratification", "protected-main PR");

const invariants = text("docs/architecture/INVARIANTS.md");
const invariantIds = invariants.match(/^## INV-\d{2} —/gm) ?? [];
check(invariantIds.length === 8, "architecture-invariants", String(invariantIds.length));

const evolution = text("docs/governance/EVOLUTION-BOUNDARIES.md");
for (let level = 0; level <= 7; level += 1) {
  check(evolution.includes(`| E${level} |`), "evolution-level", `E${level}`);
}
check(evolution.includes("least-powerful medium"), "least-powerful-evolution", "present");

for (let number = 1; number <= 6; number += 1) {
  const id = String(number).padStart(3, "0");
  const file = requiredFiles.find((path) => path.includes(`ADR-${id}-`));
  const adr = text(file);
  check(adr.includes(`ADR-${id}`), "adr-id", `ADR-${id}`);
  check(adr.includes("Status: accepted"), "adr-status", `ADR-${id}`);
  check(adr.includes("## Decision"), "adr-decision", `ADR-${id}`);
  check(adr.includes("## Rejected alternatives"), "adr-alternatives", `ADR-${id}`);
  check(adr.includes("## Verification"), "adr-verification", `ADR-${id}`);
}

const threatModel = text("docs/security/THREAT-MODEL-v0.md");
const threats = threatModel.match(/^\| TM-\d{2} \|/gm) ?? [];
check(threats.length >= 16, "threat-register", String(threats.length));
check(threatModel.includes("## Residual risks"), "residual-risks", "present");

const classification = text("docs/security/DATA-CLASSIFICATION.md");
for (const dataClass of ["public", "internal", "confidential", "restricted"]) {
  check(classification.includes(`| \`${dataClass}\` |`), "data-class", dataClass);
}

const boundaries = text("docs/security/TRUST-BOUNDARIES.md");
const boundaryIds = boundaries.match(/^\| TB-\d{2} /gm) ?? [];
check(boundaryIds.length >= 10, "trust-boundaries", String(boundaryIds.length));
check(boundaries.includes("The S01 pull request is the sign-off object"), "trust-boundary-signoff", "protected-main PR");

for (const pass of passes) console.log(`PASS ${pass.name}: ${pass.detail}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log(`S01 verification passed with ${passes.length} checks.`);
