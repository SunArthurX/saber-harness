# Desktop Acceptance and Traceability

## Rule

Every product claim maps to a user journey, automated test, evidence owner and
release Gate. A mock proves component behavior only; a packaged desktop and real
Core prove product behavior.

## End-to-end journeys

| ID | Journey | First Segment | Final proof | Evidence owner |
|---|---|---|---|---|
| DJ-01 | Install, first launch, open/clone repository | S26 | signed clean-machine launch on supported OSes | Release/SDET |
| DJ-02 | Create Goal, edit Plan, select model/Realm/budget | S29/S30 | packaged desktop creates bound Run | Agent UX |
| DJ-03 | Read/edit/test real repository with approvals | S30 | all effects have matching Core evidence | Runtime/Security |
| DJ-04 | Review Hunk, verify tests, apply/rollback/commit | S31 | applied tree equals accepted digest | Editor/SDET |
| DJ-05 | Parallel Agents in isolated Worktrees | S32 | fault/conflict game day and reviewable integration | Orchestration/Git |
| DJ-06 | Import and resume external conversation | S33 | lineage recompute and drift detection | Data/Privacy |
| DJ-07 | Curate, revoke and forget Memory | S33 | future recall and deletion graph match policy | Knowledge Curator |
| DJ-08 | Install Armor and evaluate internal evolution | S34 | signed capability, isolated eval, canary and rollback | Plugin/Eval/Security |
| DJ-09 | Incident containment and Safe Mode recovery | S34 | detect→contain→repair→verify game day | Reliability/Security |
| DJ-10 | Enterprise enrollment/policy/KMS/audit | S35 | tenant/role/device adversarial suite | Enterprise/Security |
| DJ-11 | Signed upgrade, migration and rollback | S36 | kill-point matrix on every supported platform | Release/Data |
| DJ-12 | Accessible localized daily use | S28-S37 | keyboard/AT/zoom/locale production audit | Accessibility/UX |
| DJ-13 | Design-partner production task | S38 | frozen acceptance and signed release packet | Product/Release |

## DJ-03 canonical fixture

The repository contains a small intentionally failing application with:

- one deterministic defect spanning two source files;
- unit and integration tests;
- a generated fixture that must not be edited;
- an unapproved network call attempted by the task instructions;
- a canary-looking secret that must be redacted;
- a formatting/lint rule;
- Git history and a clean expected patch.

The journey:

1. Open repository.
2. Create Goal from a fixed prompt.
3. Review/modify Acceptance and Plan.
4. Approve file read; deny network; narrowly approve test command.
5. Observe Agent edit in isolated Worktree.
6. Inspect Context Receipt and Timeline.
7. Review Diff; reject one intentionally wrong Hunk; request revision.
8. Run tests and verify artifact digests.
9. Kill Renderer; reopen and continue review.
10. Apply accepted change; roll back; reapply; commit.
11. Reopen application and continue Goal from history.

Pass requires exact final tree, no network effect, canary absent from provider/log,
identical Run projection after restart and complete Evidence Receipt.

## Functional requirement matrix

| Requirement | Segment | Automated proof | Manual proof | Release blocker |
|---|---|---|---|---:|
| Desktop is default, supervisor secondary | S26/S28 | startup route test | fresh-install observation | yes |
| Shell cannot authorize effects | S27/S37 | bridge allowlist + adversarial IPC | security architecture review | yes |
| Conversation survives reconnect | S29 | stream replay/dedup test | network interruption UX | yes |
| Context is explainable and revocable | S29 | preview/receipt reconciliation | privacy comprehension test | yes |
| Plan cannot silently alter acceptance | S30 | plan version invariant | Plan Diff review | yes |
| Approval is exact and expiring | S30 | scope/TTL/TOCTOU suite | approval comprehension | yes |
| Completion requires Evidence | S31 | forged-success negative test | reviewer task | yes |
| Worktrees isolate Agents | S32 | parallel fault suite | conflict workflow | yes |
| Conversation lineage is recomputable | S33 | raw→derived rebuild | import inspection | yes |
| Memory never launders trust | S33 | taint/promotion/recall-loop tests | curator review | yes |
| Evolution is staged and reversible | S34 | eval/canary/LKG suite | candidate review | yes |
| Immune control outranks Agent | S34 | containment authority test | game day | yes |
| Tenant/device/role isolation | S35 | adversarial enterprise suite | admin audit | yes |
| Update is signed and rollback-safe | S36 | tamper/kill/migration matrix | clean machine | yes |

## Non-functional gates

Thresholds are frozen in S37 using reference hardware; any change requires a
reviewed SLO change, not a test edit hidden inside a feature PR.

| Family | Measurement | Minimum release rule |
|---|---|---|
| Startup | cold and warm, first usable Workbench | fixed P95 per reference class |
| Interaction | keystroke/input, tree update, event render | no sustained UI blocking above budget |
| Repository | 10k/100k file open/index/search | degradation documented and bounded |
| Run stream | Core event to visible projection | ordered, lossless, bounded P95 |
| Memory | idle/active/large Diff | below frozen per-process budgets |
| Disk | install, cache, 30-day metadata growth | user-visible and cleanable non-authoritative data |
| Recovery | Renderer/Core/update/migration failures | no silent loss; fixed RTO/RPO |
| Accessibility | DJ-01 through DJ-04 | no P0/P1 WCAG 2.2 AA defect |
| Privacy | logs/cache/telemetry/crash dump | zero unauthorized body/secret canary |
| Security | Core boundary and threat register | zero successful critical bypass |

## Evidence strength

From weakest to strongest:

1. design statement;
2. unit/component test;
3. integration with fake peer;
4. integration with real Core or real desktop;
5. packaged desktop on one platform;
6. packaged desktop on required platform matrix;
7. clean-machine, fault-injected, signed artifact on reviewed remote SHA;
8. design-partner evidence with fixed acceptance.

The exit Gate names the minimum permitted level. Lower levels remain useful but
cannot substitute for it.

## Traceability maintenance

- Add desktop requirements to the canonical traceability source when their
  implementation Segment starts, not as unowned placeholders.
- Every P0 requirement needs at least one negative/adversarial test.
- Verifier checks exact file/contract/test presence and rejects orphan IDs.
- Evidence references stable task/test IDs and artifact digests, never chat
  summaries.
