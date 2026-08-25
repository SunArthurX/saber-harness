# Segment Checklist

## Start

- [ ] Fetch/prune remote.
- [ ] Verify branch and expected HEAD.
- [ ] Confirm worktree is clean or reconcile user changes.
- [ ] Read AGENTS.md, STATE.yaml, HANDOFF.md and linked ADRs.
- [ ] Run fast resume test.
- [ ] Restate objective, acceptance, scope and blockers.

## During

- [ ] Changes remain within Segment scope.
- [ ] New side effects have Capability/Policy.
- [ ] Schema/types/migrations stay synchronized.
- [ ] Tests are added with implementation.
- [ ] Decisions are written to ADR/DECISIONS.
- [ ] No secrets, private transcript dumps or hidden reasoning are stored.
- [ ] Checkpoint before model/quota switch.

## Gate

- [ ] Acceptance criteria have authoritative evidence.
- [ ] Lint/unit/integration/security/fault tests pass as required.
- [ ] git diff --check passes.
- [ ] Generated files match source Schema.
- [ ] Traceability and docs are current.
- [ ] STATE/HANDOFF/EVIDENCE are current.
- [ ] Explicit-path git add used.
- [ ] Commit message includes Segment ID.
- [ ] Feature branch pushed without force.
- [ ] Remote SHA equals local HEAD.
- [ ] Required CI passes.
- [ ] PR/review state recorded.

## Final state

- [ ] Completed
- [ ] AwaitingCI
- [ ] AwaitingReview
- [ ] PushFailed
- [ ] Blocked
- [ ] WIPCheckpoint
