import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { loadTraceability, validateTraceability } from "../lib/traceability.mjs";

const canonicalPath = join(process.cwd(), "docs/traceability.yaml");

test("canonical traceability has no orphan or malformed requirement", () => {
  const result = validateTraceability(loadTraceability(canonicalPath));
  assert.deepEqual(result.errors, []);
  assert.ok(result.summary.total >= 50);
  assert.ok(result.summary.p0 >= 40);
});

test("duplicate IDs fail closed", () => {
  const document = loadTraceability(canonicalPath);
  document.requirements.push(structuredClone(document.requirements[0]));
  assert.ok(validateTraceability(document).errors.some((error) => error.endsWith(":duplicate-id")));
});

test("a P0 requirement without a test is rejected", () => {
  const document = loadTraceability(canonicalPath);
  document.requirements.find(({ priority }) => priority === "P0").tests = [];
  const errors = validateTraceability(document).errors;
  assert.ok(errors.some((error) => error.endsWith(":tests")));
  assert.ok(errors.some((error) => error.endsWith(":p0-owner-test")));
});

test("unknown requirement families are rejected", () => {
  const document = loadTraceability(canonicalPath);
  document.requirements[0].id = "FR-UNKNOWN-001";
  assert.ok(validateTraceability(document).errors.some((error) => error.endsWith(":id-format")));
});
