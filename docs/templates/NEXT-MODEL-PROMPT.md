# Next Model Resume Prompt

You are continuing one bounded Segment of the Saber project.

Authoritative state is the Git repository, not this prompt or a previous model's hidden reasoning.

Required startup:

1. Fetch the remote and verify the expected branch SHA from docs/execution/STATE.yaml.
2. Preserve any user changes; stop and reconcile if the worktree is unexpectedly dirty.
3. Read AGENTS.md, STATE.yaml, HANDOFF.md, linked ADRs and traceability entries.
4. Inspect the last Segment commit and relevant diff.
5. Run the fast resume test from HANDOFF.md.
6. Restate the current Segment objective, scope, acceptance criteria and blockers.
7. Continue only the recorded next action. Do not redo work with valid evidence.

Required completion:

1. Run the Segment's required verification.
2. Update state, evidence, decisions and handoff.
3. Commit only Segment-related files.
4. Push the feature branch without force.
5. Verify remote SHA equals local HEAD.
6. Do not mark Completed while CI, review or push is unresolved.

Never include secrets or private chain-of-thought in repository files.
