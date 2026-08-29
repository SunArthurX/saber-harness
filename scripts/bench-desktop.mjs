#!/usr/bin/env node
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { evaluateReport, p95, median } = require(
  join(root, "apps/desktop-codeoss/extensions/saber-agent/src/performanceSlo.js"),
);

function time(fn, runs = 12) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  return samples;
}

// large-diff render proxy: JSON-projection of a synthesized 5k-line diff
const bigDiff = Array.from({ length: 5000 }, (_, i) => ({ path: `src/f${i}.ts`, added: 12, removed: 3 }));
const diffSamples = time(() => {
  const rows = bigDiff.map((entry) => `${entry.path}:+${entry.added}-${entry.removed}`);
  JSON.stringify(rows);
});

// event decode proxy: parse 2k control frames
const frame = JSON.stringify({
  method: "run.start",
  context: { actor_id: "a", workspace_id: "w" },
  params: { run_id: "r" },
});
const frames = Array.from({ length: 2000 }, (_, i) => frame.replace('"r"', `"run-${i}"`));
const decodeSamples = time(() => {
  let seen = 0;
  for (const raw of frames) {
    const parsed = JSON.parse(raw);
    seen += parsed.params.run_id.length;
  }
  if (seen === 0) {
    throw new Error("decode_invariant_failed");
  }
});

// 10k-entry indexing walk proxy over an in-memory inventory
const inventory = Array.from({ length: 10000 }, (_, i) => ({ path: `pkg/src/file-${i}.ts`, size: 100 + (i % 500) }));
const indexSamples = time(() => {
  let total = 0;
  for (const entry of inventory) {
    total += entry.size;
  }
  if (total <= 0) {
    throw new Error("index_invariant_failed");
  }
});

const measured = {
  "large-diff-render": diffSamples,
  "event-latency": decodeSamples.map((ms) => (ms / frames.length) * 1),
  "index-10k-files": indexSamples,
};

const report = {
  environment: process.env.REFERENCE_MACHINE_CLASS ?? "non-reference-ci-machine",
  measuredAt: new Date().toISOString(),
  metrics: Object.fromEntries(
    Object.entries(measured).map(([metric, samples]) => [
      metric,
      { median: Number(median(samples).toFixed(3)), p95: Number(p95(samples).toFixed(3)), samples: samples.length },
    ]),
  ),
  rawMetadataOnly: true,
  userContentIncluded: false,
};

const machineClass = process.env.REFERENCE_MACHINE_CLASS;
if (machineClass) {
  const slo = evaluateReport(measured, machineClass);
  report.sloEvaluation = { machineClass, verdict: slo.verdict, findings: slo.findings };
  console.log(`reference evaluation (${machineClass}): ${slo.verdict}`);
  if (slo.findings.length > 0) {
    console.log(`SLO findings: ${slo.findings.join(", ")}`);
  }
} else {
  console.log("raw measurements recorded; SLO evaluation skipped (not a reference environment — honest labeling)");
}

console.log(JSON.stringify(report, null, 2));
