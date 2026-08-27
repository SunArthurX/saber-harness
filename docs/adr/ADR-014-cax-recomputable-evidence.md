# ADR-014 — Canonical Agent Exchange with Recomputable Evidence

Status: accepted
Date: 2026-08-28
Deciders: repository owner and S12 architecture review

## Context

The product promise includes absorbing conversations from other coding
agents. Imported transcripts are evidence, never authority (INV-02), and
an importer must not be able to invent content the raw source never
contained. The roadmap requires a versioned Canonical Agent Exchange (CAX)
schema with source references and hashes, first importers with recomputable
evidence, and deterministic re-import/revoke/delete preserving minimal
audit provenance.

## Decision

### The record is a hash chain from raw bytes to entries

A `CaxRecord` binds: schema version, tenant/workspace scope, source
reference (origin URI, format, `raw_digest` of the exact source bytes),
session/actor metadata, ordered entries (role, content, per-entry digest,
timestamp) and a `record_digest` computed over the canonical record body.
Validation recomputes every digest; any mismatch between stored and
recomputed values — a tampered source replay or a tampered record — fails
closed. Entry digests hash only content that appears verbatim in the raw
source, so an importer cannot invent content without breaking the chain it
must recompute.

### Importers are pure parsers with format identity

Each importer (JSONL transcript, Markdown transcript) declares a stable
format identifier and turns raw bytes into entries deterministically.
Importers perform no I/O, hold no keys and produce no side effects; the
same bytes always produce the same record.

### Idempotent re-import, revocable sources

The `CaxLibrary` keys records by source `raw_digest`: re-importing the
same source returns the existing record (no duplicates), and importing an
evolved source (different digest) creates a distinct record. Revoking a
source removes its records from every query immediately while retaining a
minimal provenance tombstone — the audit fact that something was imported
and revoked survives, the content does not.

### Scope and version gates

Records carry their target tenant/workspace; a record claiming a foreign
scope is rejected at admission (cross-workspace injection). Unknown schema
versions fail closed exactly like the control protocol.

### Untrusted admission into the knowledge fabric

Imported records reach the S09 fabric through a conversion that mints
`Untrusted`-trust labels with full provenance (origin = source URI) and
content digests; the fabric's existing admission, scope and redaction rules
then apply unchanged. Nothing imported can enter context as trusted
content.

## Consequences

- New agent formats are new importers plus a format id; the record shape
  and library semantics do not change.
- Re-import after source edits intentionally creates a new record; source
  evolution is visible, not merged.
- Tombstones keep the library append-mostly; compaction is a future,
  explicitly reviewed operation.

## Rejected alternatives

- Trusting importer output without recomputation: an importer bug or
  compromise becomes fabricated history.
- Merging re-imports by origin URI: silently conflates different source
  versions.
- Trusted-by-default imports: violates INV-02 and the TM-06 posture.

## Verification

- Hash mismatch (tampered source or record) fails closed.
- Recomputation equality: record content is always present verbatim in the
  raw source.
- Re-import idempotency; revocation removes from queries with provenance
  retained.
- Cross-workspace injection and unknown versions denied.
- Fabric admission lands as Untrusted with intact provenance.
