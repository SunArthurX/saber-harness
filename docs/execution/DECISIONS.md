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

Status: superseded by DEC-0005
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

Status: superseded by DEC-0005
Date: 2026-08-25

Decision:

- Do not make the repository public merely to unlock branch protection on the current GitHub plan.
- Keep S00 open until remote main protection can be enforced by an eligible GitHub plan or organization.
- Use squash-only merging, CI-verified pull requests, CODEOWNERS, a no-force-push rule, and a main-provenance detection workflow as compensating controls.
- Treat compensating controls as risk reduction, not as proof that remote main protection exists.

Reason:

- Public visibility would expose private research and an evolving security architecture.
- Falsely equating detective workflow checks with preventative branch protection would weaken the governance model at its foundation.

## DEC-0005 — Publish the repository with proprietary rights reserved

Status: accepted for S00
Date: 2026-08-25

Decision:

- Change `SunArthurX/saber-harness` visibility from private to public following the repository owner's explicit instruction.
- Preserve the proprietary, all-rights-reserved license posture; public readability does not grant an open-source license.
- Run a tracked-file and full-Git-history credential/material scan before changing visibility.
- Enable GitHub protected-main controls immediately after publication and require machine-verifiable remote acceptance.

Reason:

- Public repositories support the required GitHub protection controls on the current account plan.
- The owner explicitly accepted public visibility after the private-plan limitation was reported.
- Pre-publication scans found no common credentials, private keys, raw source PDFs, `.env` files, or ignored extraction artifacts in Git history.

## DEC-0006 — Pin both language ecosystems and verify on three desktop operating systems

Status: accepted for S02
Date: 2026-08-25

Decision:

- Use a Rust workspace for the trusted core and a pnpm workspace for TypeScript applications and packages.
- Pin Rust, Node.js, pnpm, TypeScript, Biome, schema/migration tools and CI Actions to exact reviewed versions.
- Commit Cargo and pnpm lockfiles and reject non-reproducible CI installation.
- Run the same build, format, lint, type, test, license and repository gates on Linux, macOS and Windows.
- Keep the product packages private and `UNLICENSED`; dependency licenses are independently inventoried and allowlisted.

Reason:

- Saber is a desktop product whose security and recovery contracts must not depend on one developer machine or operating system.
- Exact tool and Action pins make a clean rebuild auditable and reduce silent supply-chain drift.
- The split preserves Rust as the trusted authority boundary while allowing a TypeScript product shell and model-neutral agent runtime.

## DEC-0007 — Use layered repository and hosted supply-chain defenses

Status: accepted for S02
Date: 2026-08-25

Decision:

- Keep local secret-pattern and tracked-file scans in the required repository verifier.
- Enable GitHub secret scanning, push protection and Dependabot security updates for the public repository.
- Run high-severity pnpm audit and RustSec audit in CI, with third-party Actions pinned by commit SHA.

Reason:

- Local fail-fast checks protect offline development and cross-model handoffs.
- Hosted push-time and advisory checks cover credential formats and newly disclosed vulnerabilities that a static local rule set cannot know in advance.

## DEC-0008 — Separate database-key rotation from immutable blob-key lifetime

Status: accepted for S04
Date: 2026-08-25

Decision:

- Keep each workspace database key in the native OS credential store and permit no argv, ordinary environment, log or model-context fallback.
- Encode a temporary primary/fallback key pair during rotation so either side of an interrupted SQLCipher rekey can reopen the database.
- Checkpoint WAL, use rollback-journal mode only for the page rewrite, restore WAL immediately and fail closed if any transition cannot be proven.
- Generate a distinct random blob master key inside the encrypted database. Database-key rotation therefore does not invalidate immutable content-addressed blobs or require risky mass re-encryption.
- Encrypt blobs with XChaCha20-Poly1305, unique nonces and authenticated workspace, classification, media type, plaintext hash and length metadata; never deduplicate across workspace trust boundaries.

Reason:

- Replacing a single credential before or after database rekey creates a crash window that can permanently orphan the store; a staged fallback makes every interruption point recoverable.
- Separating the blob master from the database wrapping key permits frequent credential rotation while preserving stable immutable object identity.
- Authenticated metadata prevents ciphertext substitution, classification downgrade and path-only trust.
