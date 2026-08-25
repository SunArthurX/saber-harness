# Canonical schemas

JSON Schema 2020-12 documents in this directory are the authoritative wire vocabulary. Generated Rust and TypeScript files contain a source banner and must be reproduced with:

    node scripts/generate-contracts.mjs

Run `node scripts/generate-contracts.mjs --check` in CI. Generated files are never edited manually. Closed objects reject unknown fields; semantic schema and protocol versions make N/N-1 behavior explicit.
