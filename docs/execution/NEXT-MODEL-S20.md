# S20 Cross-model Execution Handoff

This is the pause point after the S19 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s19-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S20-remote-execution-realm`
- S20 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S20：Remote Execution Realm"

## Mandatory startup

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s19-complete
git rev-parse 's19-complete^{}'
git rev-parse origin/main
```

The worktree must be clean; the tag must be annotated and an ancestor of `origin/main`. Read AGENTS.md, STATE.yaml, HANDOFF.md, EVIDENCE.json, ROADMAP.md, ADR-021 and the remote-realm material in the master plan. Verify the inherited boundary:

```sh
node scripts/verify-remote-s19.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those pass: `git switch -c segment/S20-remote-execution-realm origin/main`, then immediately update STATE.yaml, HANDOFF.md and EVIDENCE.json to truthful S20 `in_progress` state.

## S20 objective

The Remote Execution Realm: heavyweight work (long builds, big test suites, batch imports) runs on remote capacity while local authority stays sovereign — remote failures never spread locally, and the local trust boundary governs everything that returns (Gate: 远程故障不扩散).

Required deliverables:

1. A remote realm contract: task submission carrying the SAME capability/policy envelope as local execution (S05/S06 semantics travel, they are not re-decided remotely).
2. Deterministic remote-state machines: submitted → running → succeeded/failed/cancelled with heartbeat leases and timeout reaping; crashed remote work never reports false success.
3. Result admission: remote artifacts/results re-enter the local trust boundary as evidence — digests verified, classification bound, no auto-promotion (INV-02/INV-03 parity).
4. Failure containment: remote faults (timeout, divergence, hostile output) fail that remote cell only; local Safe Mode and reflexes treat remote signal sources like any other H-ladder input (S18 integration).
5. Data-flow discipline: egress to the realm goes through the S06 Egress PEP; returned data is scanned/taint-labeled before entering the knowledge fabric.
6. A S20 verifier and strict remote verifier preserving every S00-S19 gate.

## Adversarial acceptance (minimum)

- remote results without matching digests are refused admission;
- a crashed/timed-out realm never reports success (heartbeat reaping proven);
- hostile/divergent remote output is contained to the remote cell and flagged;
- policy envelopes cannot be widened in transit (tamper detection);
- returned data is taint-labeled before fabric admission;
- cancellation propagates to the remote realm deterministically.

## Segment publication protocol

Unchanged from S19: one Segment branch, explicit staging, full local gate, truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S20 verification, atomic completion record through a second protected PR, then annotated `s20-complete`.

Never mark S20 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
