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

Status: superseded by DEC-0003
Date: 2026-08-25

Decision:

- Initialize the local repository and Segment branch.
- Leave remote, hosting platform, visibility and license unresolved until the owner provides direction.

Reason:

- Those choices affect data exposure, governance and legal rights.

## DEC-0003 — Use the authenticated private GitHub repository

Status: accepted for S00
Date: 2026-08-25

Decision:

- Use the only authenticated Git hosting identity discovered on the execution machine: `SunArthurX` on GitHub.
- Use the workspace-derived repository name `saber-harness`.
- Keep the repository private and proprietary while product security, data classification, and licensing are still being established.
- Use GitHub Actions for the initial CI baseline and `@SunArthurX` as the bootstrap CODEOWNER.
- Permit later transfer to an organization through an explicit governance decision without changing repository history.

Reason:

- The user explicitly requested a remote checkpoint after every completed Segment.
- A private repository minimizes exposure of research and evolving security designs.
- The selected account is authenticated and the target repository name was previously unused, so the target is unambiguous and verifiable.

## DEC-0004 — Preserve private visibility when remote protection is unavailable

Status: accepted for S00
Date: 2026-08-25

Decision:

- Do not make the repository public merely to unlock branch protection on the current GitHub plan.
- Keep S00 open until remote main protection can be enforced by an eligible GitHub plan or organization.
- Use squash-only merging, CI-verified pull requests, CODEOWNERS, a no-force-push rule, and a main-provenance detection workflow as compensating controls.
- Treat compensating controls as risk reduction, not as proof that remote main protection exists.

Reason:

- Public visibility would expose private research and an evolving security architecture.
- Falsely equating detective workflow checks with preventative branch protection would weaken the governance model at its foundation.
