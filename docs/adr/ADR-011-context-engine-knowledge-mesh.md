# ADR-011 — Permission-Aware Context Engine and Knowledge Mesh

Status: accepted
Date: 2026-08-27
Deciders: repository owner and S09 architecture review

## Context

The roadmap requires one query fabric over code, conversations, documents,
issues, decisions and rules, with provenance/scope/sensitivity/freshness and
selection-reason labels on every chunk entering model context (the
"nutrition label", PC-04), scope isolation without cross-workspace/tenant
leakage, explain/inspect/exclude/revoke controls, and hybrid retrieval over
rebuildable derived indexes. INV-02 already fixed the trust posture:
imported and unclassified content is evidence, never instruction, and can
never enter context unlabeled.

## Decision

### Nutrition labels are structural, not optional

Every chunk carries a `NutritionLabel`: chunk id, tenant/workspace scope,
data classification, provenance (origin, trust level, imported time),
freshness policy and — once selected — the selection reason. Admission to
the fabric fails closed without an explicit classification and origin, and
imported content is labeled `Untrusted` unless an explicit promotion path
changes it. The label binds a content digest; the fabric re-verifies the
digest at query time so a label cannot be forged onto different content.

### One fabric, scope-qualified everything

The `KnowledgeFabric` keys chunks by tenant and workspace. A query executed
inside one scope can only ever observe chunks of that scope: the planner
filters by scope before any matching, so leakage is structurally impossible
rather than policy-checked afterwards. Chunk sensitivity above the asker's
ceiling excludes the chunk; field-level sensitivity inside an admissible
structured chunk is redacted at query time with a stable marker.

### Hybrid retrieval over derived, rebuildable indexes

Keyword (tokenized text), symbol (identifier) and structured (key-path)
indexes are pure derivations of chunk content. They carry a digest, are
never authoritative, and any corruption is recovered by rebuilding from the
fabric — losing an index can never lose knowledge. Match results carry
per-channel selection reasons; ordering is deterministic (score channels,
then chunk id) so identical queries select identically.

### Explanation, exclusion and revocation

Every query result can be explained deterministically: which chunks were
selected, from which channel, with which label fields, and which were
excluded (scope, sensitivity, freshness, revocation, user exclusion).
Users may exclude a source from future context and revoke a chunk outright;
revocation removes the chunk and every index entry immediately, and
expired-freshness chunks are excluded with the reason recorded.

### Taint-carrying export

Exporting a selection produces a `ContextBundle` whose taint set derives
from the selected labels (untrusted provenance taints the bundle) and whose
data classification is the maximum of the members. The bundle composes
into an S06 `EgressRequest`, so tainted or over-classified context cannot
leave through the egress boundary regardless of the caller's intent.

### Deterministic audit trail

The fabric records stable event names (`knowledge.queried`,
`context.chunk_selected`, `knowledge.redacted`, `context.explained`,
`context.source_excluded`, `index.rebuilt`, `retrieval.completed`) with
metadata-only payloads for the durable journal; it performs no I/O itself.

## Consequences

- Adding a source type means mapping it onto `ChunkContent` and a trust
  level; the fabric does not care where content came from.
- Vector retrieval joins later segments as one more channel over the same
  label/planner/explain machinery, not a parallel system.
- Query-time redaction means cached selections are scope- and
  ceiling-specific; bundles are not reusable across scopes.
- Digest re-verification costs one hash per chunk per query; acceptable at
  S09 scale and revisit only with profile evidence.

## Rejected alternatives

- Labels as sidecar metadata the model could omit: INV-02 violation.
- Post-hoc scope filtering after matching: a leak becomes a policy bug, not
  a structural impossibility.
- Authoritative indexes: index corruption would mean knowledge loss.
- Redacting at admission: destroys originals that higher-clearance scopes
  may lawfully see.

## Verification

- Cross-scope/tenant/ceiling leakage tests return zero foreign chunks.
- Unclassified admission rejected; untrusted content stays labeled.
- Forged labels (digest mismatch) detected at query time.
- Corrupted indexes rebuilt from the fabric; digests restored.
- Revocation and user exclusion take effect on the next query; freshness
  expiry excludes with reason.
- Query-time field redaction with a stable marker; deterministic explain
  output and selection ordering.
- Tainted bundles denied or classified by the S06 egress PEP.
- S09 verifier and strict remote verifier preserve every S00-S08 gate.
