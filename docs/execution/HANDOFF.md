# S01 Handoff

Status: in progress
Date: 2026-08-25
Branch: `segment/S01-constitution`
Base: `s00-complete` / `37e2632191c8d8085b6fabccad8cade74114b85b`

## Objective

Ratify the Saber product constitution and non-goals; establish complete requirement traceability; accept the first six architecture decisions; freeze eight architectural invariants and E0–E7 evolution limits; and sign off trust boundaries, data classification and Threat Model v0 through protected main.

## Completed locally

- Product Constitution v1 defines PC-01 through PC-10 and eight V1 non-goals.
- `docs/traceability.yaml` contains 58 requirements across all nine required families.
- All 50 P0 requirements have a statement, owner, module, event binding, planned test, Segment and source.
- ADR-001 through ADR-006 are accepted for Rust Core, local control protocol, SQLCipher, event/projection transactions, encrypted blobs and schema code generation.
- INV-01 through INV-08 and E0 through E7 are frozen as implementation constraints.
- Trust boundaries TB-01 through TB-10, four data classes and 16-threat register are documented.
- `node scripts/verify-s01.mjs` passed 68 checks.
- `node --test scripts/tests/*.test.mjs` passed 10 tests.
- S00 regression verification passed 296 checks with S01 as the active Segment.
- Initial S01 commit `4244fdea9cbd8be098e3ff09c9e5fc5c2eb00bbf` was pushed and matched the remote Segment branch SHA.

## Pending Gate

| Item | State | Required action |
|---|---|---|
| Segment push/SHA equality | passed | local and remote matched at `4244fdea9cbd8be098e3ff09c9e5fc5c2eb00bbf` |
| Required CI | pending | GitHub `repository-verification` must pass with S01 verifier and tests |
| Constitution and boundary sign-off | pending | repository owner merges the protected S01 PR |
| Clean-clone acceptance | pending | clone protected main and run S00, S01, tests and strict remote verification |

## Non-negotiable review points

- A model or plugin never becomes the authority boundary.
- Candidate, evaluation, approval and promotion remain separate states.
- E4+ cannot be configured into approval-free publication; E7 autonomous changes are forbidden.
- E2EE and server-readable search are distinct deployment contracts.
- Approval, allowlists and scanners do not substitute for sandbox enforcement.
- Trust-boundary changes require an ADR and traceability delta.

## Next action

1. Open the S01 PR with the constitutional and trust-boundary sign-off contract.
2. Merge only after required CI passes.
3. Run clean-clone acceptance and create the `s01-complete` tag.
