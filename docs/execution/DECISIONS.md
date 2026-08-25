# Execution Decisions

## DEC-0001 — Repository state outranks model conversation

Status: accepted for S00
Date: 2026-08-25

Decision:

- Git commits, tests, ADRs, schemas, traceability and evidence are the development source of truth.
- Chat and model summaries are non-authoritative.
- Cross-model continuation uses STATE, HANDOFF and EVIDENCE.

Reason:

- Model/provider quotas and context are not durable.
- A new model must be able to validate state without access to hidden reasoning.

## DEC-0002 — Do not choose hosting, visibility or license implicitly

Status: accepted for S00
Date: 2026-08-25

Decision:

- Initialize the local repository and Segment branch.
- Leave remote, hosting platform, visibility and license unresolved until the owner provides direction.

Reason:

- Those choices affect data exposure, governance and legal rights.
