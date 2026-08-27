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

## DEC-0009 — Make policy denial monotonic and audit a prerequisite for effects

Status: accepted for S05
Date: 2026-08-26

Decision:

- Freeze a closed, versioned action/resource vocabulary shared by manifests, policy, approval and audit; exclude any universal super-capability.
- Keep authorization in a deterministic Rust PDP/PEP. Project content is not a policy tier, any matching deny wins, and absence or failure is deny.
- Reject policy sequence rollback, same-sequence replacement and removal of an established authority tier.
- Bind approvals to exact request and operation hashes, no-broader resource scope, TTL, revocation and replay state; prohibit vague blanket approval choices.
- Persist a redacted decision in the encrypted append-only store before execution, then persist the enforcement result for recovery.

Reason:

- Models and project content are vulnerable to injection and cannot be allowed to authorize their own effects.
- Monotonic deny semantics are easier to review and prove than precedence rules that let lower scopes override higher authority.
- Hash/TTL binding closes approval TOCTOU and replay paths.
- Audit-before-effect gives the immune/recovery system deterministic evidence even when an effect or provider later fails.

## DEC-0010 — Resolve the S06 numbering collision in favor of the isolation boundary

Status: accepted for S06
Date: 2026-08-26

Decision:

- The authoritative execution roadmap (`docs/企业级开发执行与跨模型接力计划.md`) assigns S06 to Sandbox, Secret Broker and Egress, and assigns Context/Knowledge/Memory work to S09 and S10.
- Legacy FR-MEM-002 through FR-MEM-006 previously carried `segment: S06` and `S06-*` test names from an earlier draft schedule. They are realigned: FR-MEM-002, FR-MEM-004, FR-MEM-005 and FR-MEM-006 move to S09; FR-MEM-003 moves to S10; their test identifiers are renamed to the matching `S09-*`/`S10-*` form.
- S06 implements only the deterministic isolation boundary (SEC-ISO-001 through SEC-ISO-006). Context, knowledge-fabric and Memory Authority work must not be silently merged into this Segment.

Reason:

- Two disjoint bodies of work claimed one Segment ID, which would make the S06 gate unfalsifiable and dilute escape/secret-exposure review.
- Requirements, tests and CI gates inherit their meaning from the roadmap; keeping them aligned preserves the P0 orphan-free traceability invariant.

## DEC-0011 — Realign FR-RUN-006 to S08

Status: accepted for S07
Date: 2026-08-27

Decision:

- The authoritative execution roadmap assigns S07 to the Tool Broker and recoverable modifications, and S08 to ModelProvider/Router/Budget. FR-RUN-006 previously carried `segment: S07` and an `S07-*` test name from the draft schedule; it is realigned to S08 with the test renamed to `S08-MODEL-ROUTER-POLICY`.

Reason:

- Same class of numbering collision as DEC-0010; keeping the traceability matrix aligned with the roadmap preserves the P0 orphan-free invariant and keeps the S07 gate focused on tool-lifecycle integrity (no forged success, recoverable or explicitly non-retriable failures).

## DEC-0012 — Serve artifact integrity from the tool broker

Status: accepted for S07
Date: 2026-08-27

Decision:

- FR-RUN-005 (artifact hashes, rollback references) moves from the never-started S04 `crates/artifact-store` module to S07 `crates/tool-broker`: checkpoints capture full content inventories with hashes, verification recomputes them independently, and compensation restores them exactly. Its segment is realigned to S07 with `implemented` status.

Reason:

- The recoverable-modification lifecycle is where artifact integrity is actually produced; a separate artifact store without the lifecycle would duplicate hashing and rollback state.

## DEC-0013 — Serve FR-MEM-003 from a dedicated memory-authority crate

Status: accepted for S10
Date: 2026-08-27

Decision:

- FR-MEM-003 (one Memory Authority per workspace) is implemented in `crates/memory-authority` (`saber-memory-authority`) rather than the draft `packages/context-engine` module. The traceability module field is realigned accordingly.

Reason:

- The authority is trusted-core state (INV-03, TM-06) and belongs beside policy/sandbox in Rust; the TypeScript context engine consumes its contracts rather than owning them.

## DEC-0014 — Realign FR-EVO entries to the authoritative roadmap

Status: accepted for S15
Date: 2026-08-28

Decision:

- The third draft-schedule collision: FR-EVO entries carried `segment: S10` while the authoritative roadmap assigns S10 to Memory Authority (completed) and S15 to the Evolution Workshop. FR-EVO-001/002/003/004/007 realign to S15 (implemented with evidence in `crates/evolution`); FR-EVO-005 (E4 Code Capsule) realigns to S16; FR-EVO-006 (E6 protected-PR separation) realigns to S22 (release/signing). Test identifiers are renamed to the matching `S15-*`/`S16-*`/`S22-*` forms.

Reason:

- Same class as DEC-0010/0011: keeping traceability aligned with the roadmap preserves the P0 orphan-free invariant and keeps the S15 gate focused on lifecycle integrity (candidates never bypass review).

## DEC-0015 — Realign SEC-SYNC-002/003/004 to S17

Status: accepted for S17
Date: 2026-08-29

Decision:

- Fourth draft-schedule collision: SEC-SYNC-002/003/004 carried `segment: S11` (the IDE segment) while the authoritative roadmap assigns S17 to E2EE Sync. They realign to S17, implemented in `crates/sync-e2ee`, with test identifiers renamed to `S17-*`.

Reason:

- Same class as DEC-0010/0011/0014: traceability stays aligned with the roadmap, preserving the P0 orphan-free invariant.

## DEC-0016 — Realign RES-HEAL-003..006 to S18

Status: accepted for S18
Date: 2026-08-29

Decision:

- Fifth draft-schedule collision: RES-HEAL-003/004/005/006 carried `segment: S12` while the authoritative roadmap assigns S18 to Health/Safe Mode/自愈. They realign to S18, implemented in `crates/health-supervisor`, with test identifiers renamed to `S18-*`.

Reason:

- Same class as DEC-0010/0011/0014/0015: traceability stays roadmap-aligned, preserving the P0 orphan-free invariant.
