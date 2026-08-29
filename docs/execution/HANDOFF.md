# S38 Handoff — Design Partner and Production

Status: completed — PR #95 merged (9904907) with all five
required checks green and all six main contexts green on the merge
commit; this record closes S38 and with it the desktop execution
plan (S00-S38) end to end. The annotated s38-complete tag follows
this record's merge
Date: 2026-08-29
Branch: `segment/S38-completion`
Base main: `3bedc66b39548d6185df0080789e5b96f35a8682` (`s37-complete`)
Runbook: `docs/execution/desktop/S38-DESIGN-PARTNER-PRODUCTION.md`

## What landed

- **partnerCohort** — eight-clause opt-in consent without defaults;
  diversity-verified cohorts that reject cherry-picking; isolated
  tenant/workspace keys with named owners; research protocols that
  never request private data.
- **taskBenchmark** — twelve frozen categories; full measurement
  surface; honest production thresholds; models as replaceable
  routes.
- **releaseRings** — ordered alpha/beta/RC rings with fail-closed
  plans; RC production-signed on the update channel; five playbooks
  and five rehearsals; support can never request raw secrets or
  unrestricted repositories.
- **productionDecision** — eight privacy checks; independent-owner
  governance; the seven-content release packet where P0/P1 blocks;
  bounded rollout keeps monitoring and rollback; dual approval for
  critical security exceptions.
- **Scripts** — `acceptance-design-partner.mjs` evaluates the frozen
  benchmark and DJ-14..DJ-32 catalog; `verify-release-candidate.mjs`
  chains package metadata, the S37 readiness digest and KPIs into a
  verified bounded-rollout packet.
- **Evidence**: 19 tests across three suites; verify-s38 (105 checks)
  in local and hosted gates.

## Honest limits

Cohort KPIs and ring execution recorded here run against committed
frozen fixtures; live partner cohorts execute the same contracts in
the hosted program.

## Next actions

1. Create annotated `s38-complete` on this record's merge commit;
   verify the peeled SHA equals that main commit locally and remotely.
2. With `s38-complete` tagged, the desktop execution plan (S00-S38)
   is complete end to end: every segment has an annotated
   `sXX-complete` tag whose peeled SHA equals its record merge
   commit, protected main carries all work, and the full gate
   (`pnpm verify`, 277 governance tests) is green.

## Post-plan dev-app test (2026-08-29)

The real dev launch ran on darwin-arm64: pinned Node 24.18.0,
vscode 1.135.0 worktree installed + compiled (0 errors), Electron
42.8.1 fetched with a checksum-exact zip, bounded launch smoke
passed, and two persistent launches opened real workbench windows
over `fixtures/repos/basic` with the saber container active by
default, zero saber warnings and zero non-token errors. One real
defect was found and fixed (PR #97, 22e1dbd): the saber-agent
manifest used a non-existent `viewsContainers.auxiliary` key
(upstream: `secondarySidebar`), which dropped the command-center
view into Explorer. Machine note: compiles ran through PATH-first
gcc/g++ shims pinning CLT clang 17 + the MacOSX15.4 SDK libc++
(this Mac's selected Xcode 14 lacks the needed C++20 headers); the
shims live outside the repository. Screen Recording was not granted,
so verification used window titles, process state, app logs, real
palette-driven command execution (the extension host recorded
`onCommand:saber.workbench.open` activating saber.saber-agent) and
the workspace `state.vscdb`, which materialized all three saber
containers with every view visible — including the command center
under its fixed `saber-secondary` home — rather than screenshots.
