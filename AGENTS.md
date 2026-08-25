# Saber Repository Instructions

These rules apply to every human or coding model working in this repository.

## Authority

1. Remote Git commits, signed release metadata and tests are authoritative.
2. Repository state, ADRs, schemas, traceability and evidence outrank chat summaries.
3. A previous model's handoff is a navigation aid, not proof.

## Scope

- Work on one Segment at a time.
- Read docs/execution/STATE.yaml and docs/execution/HANDOFF.md before changing files.
- Preserve user changes and unrelated work.
- Record architectural decisions in docs/adr or docs/execution/DECISIONS.md.

## Safety

- Never commit secrets, credentials, private keys, raw private transcripts or hidden chain-of-thought.
- Do not weaken Policy, Sandbox, Secret, Egress, Audit, Update or Recovery boundaries to make a test pass.
- Do not use force push.
- Do not mark a Segment completed while tests, review, CI or remote push verification is unresolved.

## Git

- Use segment/Sxx-slug branches.
- Stage explicit paths.
- Include the Segment ID in commit messages.
- Push the Segment branch and verify remote SHA equals local HEAD.
- Protected main is updated only through the selected review/merge process.

## Verification

For S00 run:

    node scripts/verify-s00.mjs

This verifier includes repository structure, continuity state, Markdown fences, whitespace, tracked-file safety and common credential-pattern checks. Do not bypass a failure; fix it or record a justified, reviewed exception.

Later Segments must add their own focused verification without deleting earlier checks.

## Cross-model handoff

Before changing model/provider or stopping:

1. Run available verification.
2. Update STATE.yaml, HANDOFF.md and EVIDENCE.json.
3. Record partial work truthfully.
4. Commit a completed Segment or explicit WIP checkpoint.
5. Push when a remote is available and verify the remote SHA.
