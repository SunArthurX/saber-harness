/**
 * S37-WP01 — Performance and resource SLO.
 *
 * Cold/warm start, first repository open, first Agent response, event
 * latency, 10k-file indexing, large Diff, memory idle/active, CPU
 * idle, disk growth and shutdown measured on reference low/mid/high
 * machines; median/P95 recorded as raw metadata without user content
 * (DSH-06, OHD-03 budgets).
 */

/** Metric families and their reference thresholds (P95, ms or MB). */
const SLO_TABLE = Object.freeze({
  "cold-start": { unit: "ms", low: 4000, mid: 2500, high: 1500 },
  "warm-start": { unit: "ms", low: 1500, mid: 900, high: 500 },
  "first-repository-open": { unit: "ms", low: 3000, mid: 1500, high: 700 },
  "first-agent-response": { unit: "ms", low: 8000, mid: 5000, high: 3000 },
  "event-latency": { unit: "ms", low: 250, mid: 100, high: 40 },
  "index-10k-files": { unit: "ms", low: 30000, mid: 15000, high: 8000 },
  "large-diff-render": { unit: "ms", low: 2000, mid: 1000, high: 500 },
  "memory-idle": { unit: "MB", low: 700, mid: 500, high: 350 },
  "memory-active": { unit: "MB", low: 1600, mid: 1200, high: 900 },
  "cpu-idle": { unit: "%", low: 5, mid: 3, high: 1 },
  "disk-growth-per-day": { unit: "MB", low: 250, mid: 150, high: 80 },
  shutdown: { unit: "ms", low: 3000, mid: 1500, high: 800 },
});

const MACHINE_CLASSES = Object.freeze(["low", "mid", "high"]);

/** Median of a numeric sample. */
function median(sample) {
  const sorted = [...sample].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** P95 of a numeric sample (nearest-rank). */
function p95(sample) {
  const sorted = [...sample].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(0.95 * sorted.length));
  return sorted[rank - 1];
}

/**
 * Evaluate a measured sample against the SLO for its metric on a
 * machine class. Lower-is-better for every metric in the table.
 */
function evaluateSlo(metric, machineClass, sample) {
  const slo = SLO_TABLE[metric];
  if (!slo) {
    throw new Error(`unknown_slo_metric:${metric}`);
  }
  if (!MACHINE_CLASSES.includes(machineClass)) {
    throw new Error(`unknown_machine_class:${machineClass}`);
  }
  if (!Array.isArray(sample) || sample.length === 0) {
    throw new Error("empty_sample");
  }
  const threshold = slo[machineClass];
  const value = p95(sample);
  return Object.freeze({
    metric,
    machineClass,
    unit: slo.unit,
    median: median(sample),
    p95: value,
    threshold,
    met: value <= threshold,
    rawMetadataOnly: true,
    userContentIncluded: false,
  });
}

/** Evaluate a full report of samples; unmet SLOs are findings. */
function evaluateReport(samplesByMetric, machineClass) {
  const results = Object.entries(samplesByMetric).map(([metric, sample]) => evaluateSlo(metric, machineClass, sample));
  const unmet = results.filter((result) => !result.met);
  return Object.freeze({
    machineClass,
    results: Object.freeze(results),
    findings: Object.freeze(unmet.map((result) => `SLO-${result.metric}`)),
    verdict: unmet.length === 0 ? "performance-ready" : "performance-findings",
  });
}

module.exports = { MACHINE_CLASSES, SLO_TABLE, evaluateReport, evaluateSlo, median, p95 };
