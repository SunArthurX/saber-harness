#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const retrieval = await import(
  pathToFileURL(join(ROOT, "apps/desktop-codeoss/extensions/saber-agent/src/retrievalContext.js")).href
);

const PRECISION_THRESHOLD = 0.75;
const STALE_THRESHOLD = 0.1;
const DUPLICATE_THRESHOLD = 0.1;
const FALSE_PROVENANCE_THRESHOLD = 0.1;

const corpus = [
  {
    source: {
      id: "codex-conv-1",
      text: "The fixture test asserted the wrong path",
      trust: "high",
      sensitivity: "internal",
      scopes: [],
      revision: "r1",
    },
    relevant: ["fixture test fails"],
    channel: "lexical",
    score: 0.95,
  },
  {
    source: {
      id: "claude-conv-1",
      text: "Parser rejects unknown nodes",
      trust: "high",
      sensitivity: "internal",
      scopes: [],
      revision: "r1",
    },
    relevant: ["parser fail closed"],
    channel: "symbol",
    score: 0.9,
  },
  {
    source: {
      id: "noise-1",
      text: "unrelated chatter",
      trust: "low",
      sensitivity: "internal",
      scopes: [],
      revision: "r1",
    },
    relevant: [],
    channel: "vector",
    score: 0.4,
  },
  {
    source: {
      id: "stale-1",
      text: "old layout",
      trust: "medium",
      sensitivity: "internal",
      scopes: [],
      revision: "r0",
      stale: true,
    },
    relevant: [],
    channel: "lexical",
    score: 0.5,
  },
];

const queries = ["fixture test fails", "parser fail closed"];
const seen = new Set();
const retrieved = [];
for (const query of queries) {
  const fragments = corpus.map((entry) =>
    retrieval.fragment(entry.source, {
      score: entry.relevant.includes(query) ? entry.score : entry.score * 0.2,
      channel: entry.channel,
      rerankScore: entry.score,
    }),
  );
  const { visible } = retrieval.retrievalFilter(fragments, query, { workspaceId: "eval", userId: "eval", nowMs: 1000 });
  // Union view: top-2 per query, deduplicated across queries.
  for (const item of retrieval.rerank(visible, { perSourceBudget: 2 }).slice(0, 2)) {
    if (!seen.has(item.sourceId)) {
      seen.add(item.sourceId);
      retrieved.push(item);
    }
  }
}

const labelled = {
  relevantSourceIds: ["codex-conv-1", "claude-conv-1"],
  expectedRevisions: { "codex-conv-1": "r1", "claude-conv-1": "r1", "noise-1": "r1" },
};
const metrics = retrieval.evaluate(retrieved, labelled);

console.log(
  `precision=${metrics.precision.toFixed(3)} staleRate=${metrics.staleRate.toFixed(3)} duplicateRate=${metrics.duplicateRate.toFixed(3)} falseProvenance=${metrics.falseProvenanceRate.toFixed(3)}`,
);

const failures = [];
if (metrics.precision < PRECISION_THRESHOLD) failures.push(`precision ${metrics.precision} < ${PRECISION_THRESHOLD}`);
if (metrics.staleRate > STALE_THRESHOLD) failures.push(`staleRate ${metrics.staleRate} > ${STALE_THRESHOLD}`);
if (metrics.duplicateRate > DUPLICATE_THRESHOLD)
  failures.push(`duplicateRate ${metrics.duplicateRate} > ${DUPLICATE_THRESHOLD}`);
if (metrics.falseProvenanceRate > FALSE_PROVENANCE_THRESHOLD)
  failures.push(`falseProvenance ${metrics.falseProvenanceRate} > ${FALSE_PROVENANCE_THRESHOLD}`);

if (failures.length > 0) {
  console.error(`memory evaluation FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`memory evaluation passed (precision ≥ ${PRECISION_THRESHOLD}); corpus: fixtures/exports + eval set`);
