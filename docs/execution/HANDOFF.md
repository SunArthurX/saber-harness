# S31 Handoff — Changes and Evidence Review

Status: completed — PR #81 merged (1bfd793) with all five required checks green and all six main contexts green on the merge commit; this record closes S31. The annotated s31-complete tag follows this record's merge; S32 starts from its runbook in a new execution round
Date: 2026-08-29
Branch: `segment/S31-changes-evidence-review`
Base main: `7f0567b1c81ababf5ea7d99ab4b74b126322e4a7` (`s30-complete`)
Runbook: `docs/execution/desktop/S31-CHANGES-EVIDENCE-REVIEW.md`

## Objective

Agent changes become an independently reviewable Change Set. Users
inspect file and hunk diffs, test evidence and boundary impact; they
can comment, request a revision, accept, reject, apply, roll back,
commit or create a PR through the Core.

## What landed

- **Core authority** (`change_set.rs`): baseline snapshot at run start;
  change-set prepare with classification (added/modified/deleted,
  binary, generated) and external-edit detection; apply requiring the
  EXACT expected tree digest (stale applies blocked); rollback that
  restores and PROVES restoration by hashes; commit that durably
  records message/authorship disclosure/signing BEFORE running real
  git in the worktree. Four new protocol methods through the shared
  dispatch on both transports.
- **Projections**: `changeSetProjection.js` (classification, stale
  preflight, rollback proof, binary metadata presentation),
  `reviewComments.js` (fingerprint-bound durable comments, stale
  marking, non-mutating hunk intents, keyboard navigation),
  `verificationEvidence.js` (seven evidence states, tree-change
  invalidation, separate security ownership, preview auto-verify with
  inconclusive outcomes, completion gate requiring an independent
  signer — a model message alone never completes),
  `boundaryDiff.js` (nine boundary categories demanding explicit
  acknowledgment).
- **Evidence**: 30 pure tests across three suites (including the
  adversarial completion suite: forged success, stale evidence,
  changed-after-approval, binary omission, partial apply crash,
  rollback failure, conflict, restart determinism); the 22-check
  review-commit e2e over the real Core; `verify-s31` (72 checks);
  the monorepo CI matrix runs the e2e on every leg.

## Honest limits

- PR creation is a separately approved network capability; the fixture
  journey stops at the local git commit and no egress was attempted.
- Hunk-level (vs file-level) apply granularity is projection-side;
  the Core applies whole change sets against the proven digest.

## Next actions

1. Create annotated `s31-complete` on this record's merge commit;
   verify the peeled SHA equals that main commit locally and remotely.
2. S32 (multi-agent worktrees) starts only from
   `docs/execution/desktop/S32-MULTI-AGENT-WORKTREES.md` in a new
   execution round.
