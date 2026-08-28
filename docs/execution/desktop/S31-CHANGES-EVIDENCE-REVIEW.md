# S31 Runbook — Changes and Evidence Review

Status: planned

Release train: RT-1 Governed Coding Alpha — first desktop CodingAgent MVP

Duration: 10-15 working days

Owners: Editor Tech Lead (A), Editor/Runtime/Frontend Engineers (R), Security and
QA reviewers (R), SDET (R)

Risk: critical

## Outcome

Agent changes become an independently reviewable Change Set. Users inspect file
and Hunk Diffs, test evidence and boundary impact; they can comment, request a
revision, accept, reject, apply, roll back, commit or create a PR through Core.

## Competitive-derived requirements

- `CDX-07`, `ZCD-01`: review stays attached to the persistent Task and exposes
  its terminal/test provenance after restart.
- `CLD-02`, `ZCD-04`: Preview Auto-Verify records server identity, DOM/a11y
  assertions, ordered actions, screenshots and test results; inconclusive is a
  valid outcome and screenshots alone cannot pass.
- `CLD-06`: inline review comments are durable Task inputs and PR/CI monitoring
  is a Core projection with candidate auto-fix, never implicit auto-merge.
- `MMX-07`: Developer, Tester and Reviewer evidence is attributable; a producer
  cannot be the sole signer of completion.

## Advanced harness and philosophy requirements

- `CUR-02`, `ZED-04`, `KIR-05`, `CLN-03`, `AID-03`: checkpoint/rewind previews
  repository, event, context and external-effect consequences and preserves
  unrelated manual drift.
- `CUR-05`, `KIR-01`, `OHD-01`, `AID-04`: browser, lint, test and review results
  are independent Observations linked back to the current requirement revision.
- Platelet behavior from `PHL-06` closes the write gate on partial effect,
  records uncertainty and verifies rollback before resuming.

## Work packages

### S31-WP01 — Change Set projection

- Bind baseline commit/tree, Worktree, Run and Artifact hashes.
- Classify added, modified, deleted, renamed, binary, generated and untracked.
- Detect external/manual edits after snapshot and block stale apply.
- Large/binary files show metadata and approved preview, never silently omit.

### S31-WP02 — Diff and comments

- Reuse native Diff where possible; add Task/Run/Evidence header.
- Keep/Reject Hunk creates a review intent, not direct file mutation.
- Comments bind path, side, line/hunk fingerprint and revision; stale comments
  are marked, not relocated silently.
- Keyboard navigation covers file list, hunks, comments and decisions.

### S31-WP03 — Verification evidence

- Show command, environment, exit code, duration, stdout/stderr digest, test
  counts and artifact links.
- Distinguish not run, running, passed, failed, flaky, cancelled and stale.
- A changed tree invalidates affected evidence until rerun or justified.
- Security/static/license checks have separate severity and ownership.

### S31-WP04 — Apply, rollback and commit

- Core methods require exact expected tree/revision and idempotency key.
- Apply is transactional or leaves an explicit recovery state.
- Rollback proves restored inventory hashes and preserves audit history.
- Commit message, authorship disclosure and signing choice are shown before
  action; PR creation uses a separately approved network capability.

### S31-WP05 — Boundary Diff

Summarize new network destinations, commands, secrets, capabilities, plugins,
generated executables, policy files, dependencies and migrations. Boundary
changes cannot be hidden inside ordinary code review.

### S31-WP06 — Completion adversarial suite

Test forged success text, stale tests, changed file after approval, binary
omission, partial apply crash, rollback failure, conflict, secret canary and
renderer restart mid-review.

## Verification

```sh
node scripts/verify-s31.mjs
pnpm desktop:test:change-set
pnpm desktop:test:review-a11y
pnpm desktop:test:apply-rollback
pnpm desktop:e2e:review-commit
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- Accepted files/Hunks exactly match the applied tree digest.
- Stale evidence and stale approvals cannot complete or apply.
- Rollback restores all tracked/untracked fixture content proven by hash.
- Boundary changes receive explicit review.
- A model message alone never produces completed state.
