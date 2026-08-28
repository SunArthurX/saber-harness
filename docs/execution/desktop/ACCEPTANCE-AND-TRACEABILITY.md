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
| DJ-14 | Import Codex/Claude/ZCode/MiniMax conversation and resume safely | S29/S33 | source-specific fixtures normalize to recomputable lineage | Import/Privacy |
| DJ-15 | Hand off a live Task across Local/Worktree/approved Remote Realm | S27/S32/S33 | identical Goal state plus explicit environment drift receipt | Runtime/Git |
| DJ-16 | Ask a Side Inquiry without contaminating the main conversation | S29 | cursor-pinned fork is read-only until explicit promotion | Agent UX/Context |
| DJ-17 | Preview and auto-verify a changed application | S28/S31/S37 | server, DOM/a11y, action, screenshot and test receipts reconcile | Preview/SDET |
| DJ-18 | Persist a Goal across multiple verified rounds and restart | S30 | independent verifier continues/pauses/completes from frozen Acceptance | Agent Runtime |
| DJ-19 | Dynamically choose solo/team and run Leader/Worker/Verifier | S32 | bounded team produces isolated, independently verified integration | Orchestration/Eval |
| DJ-20 | Select or migrate between supported Agent harnesses | S27/S29/S33 | capability gaps visible; normalized events preserve provenance | Adapter/Runtime |
| DJ-21 | Dispatch remotely and operate an approved browser/computer Realm | S34/S35/S37 | device-bound intent, allowlist, action receipts and global stop | Remote/Security |
| DJ-22 | Schedule independent Automation Run or contextual Goal Heartbeat | S30/S34 | missed-run, budget, approval, isolation and stop behavior proven | Automation/SDET |
| DJ-23 | Promote experience from Memory to Skill or Code safely | S33/S34 | lineage, eval, review, canary, last-known-good and rollback | Evolution/Security |
| DJ-24 | Send an attributed message or proposed Task across sessions | S30/S32 | receiving Policy applies and no message inherits authority | Orchestration/Security |
| DJ-25 | Switch model, Agent or harness during a live Goal | S27/S29/S30 | stable Goal identity, explicit capability/config boundary and revalidated Plan/approval | Adapter/Runtime |
| DJ-26 | Restore checkpoint while preserving manual drift | S30/S31/S32 | repository/event/context/external-effect preview proves no unowned overwrite | Git/Recovery/SDET |
| DJ-27 | Reconstruct model-visible context and UI from canonical events | S27/S29/S30/S33 | source→canonical→projection hashes and cursor replay reconcile | Runtime/Data |
| DJ-28 | Simulate, enable, block, circuit-break and unload a Reflex Hook | S30/S34/S37 | deterministic budget, no authority widening and zero residual effect | Automation/Security |
| DJ-29 | Reproduce and attest one execution Realm | S27/S30/S35/S37 | filesystem, shell, PTY, LSP, preview and tests prove one image/revision identity | Runtime/Security |
| DJ-30 | Move Specification from requirements through verified implementation | S28/S30/S31/S38 | bidirectional requirement/design/task/change/test/evidence trace remains current | Product/SDET |
| DJ-31 | Compact long context and continue within a visible budget | S29/S33 | source range, omissions, summary lineage and actual consumption reconcile | Context/Privacy |
| DJ-32 | Corrupt and rebuild repository/context indexes | S29/S33/S34 | canonical records survive and rebuilt projection passes equivalence/staleness tests | Knowledge/Reliability |

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
| Handoff preserves truth across Realms | S27/S32/S33 | cursor/capsule/drift matrix | Local↔Worktree↔Remote walkthrough | yes |
| Imported agent state cannot import authority | S29/S33 | hostile transcript/plugin/hook fixtures | consent and mapping review | yes |
| Side Inquiry cannot mutate main context | S29 | read-only fork and explicit promotion tests | context provenance inspection | yes |
| Auto-Verify is evidence, not self-assertion | S31/S37 | DOM/a11y/action/test reconciliation | preview review | yes |
| Goal loop uses independent verification | S30 | forged completion and budget exhaustion tests | iteration inspector review | yes |
| Team formation is explainable and bounded | S32 | solo/team classifier and budget tests | Team Value Decision review | yes |
| Cross-Task messages retain provenance | S30/S32 | inbound deny/taint/replay suite | message origin inspection | yes |
| Harness adapters expose capability gaps | S27/S33 | contract and degraded-mode fixtures | adapter capability review | yes |
| Automation distinguishes Run and Heartbeat | S30/S34 | schedule/restart/missed-run tests | inbox review | yes |
| Memory-to-capability promotion is reversible | S33/S34 | lineage/eval/canary/rollback suite | evolution review | yes |
| Remote/computer effects are device-bound | S34/S35/S37 | forged-device/injection/global-stop suite | remote session review | yes |
| Adapter switch preserves body identity | S27/S29/S30 | capability-drift and continuity fixtures | adapter transition review | yes |
| Checkpoint preserves manual drift | S30/S31/S32 | mixed-ownership rollback matrix | restore preview review | yes |
| Model-visible context is reconstructable | S27/S29/S30/S33 | source/event/projection replay and hash suite | causal Timeline inspection | yes |
| Hooks are bounded reflexes | S30/S34/S37 | recursion/block/unload/residue suite | Hook simulation review | yes |
| Runtime observations share one Realm | S27/S30/S35/S37 | forged-world and image-drift suite | Runtime identity inspection | yes |
| Specification trace is bidirectional | S28/S30/S31/S38 | stale-requirement/evidence negative tests | spec-to-evidence walkthrough | yes |
| Context compaction exposes omissions | S29/S33 | deterministic compaction and budget suite | receipt comprehension review | yes |
| Derived indexes are rebuildable | S29/S33/S34 | corrupt/drop/rebuild equivalence tests | outage and recovery walkthrough | yes |
| Immune Core outranks Agent and Hook | S27/S34/S37 | bypass, suppression and Safe Mode-exit attacks | security game day | yes |

## Release claim gates

| Claim | Required Segments | Required proof | Explicitly forbidden substitute |
|---|---|---|---|
| RT-0 engineering preview | S26-S29 | packaged three-platform workbench, real Core projection, explainable context | mock, Storybook or Web Supervisor |
| RT-1 first CodingAgent MVP | S26-S31 | DJ-01 through DJ-04, DJ-18 and DJ-25 on a real repository with restart, adapter continuity and rollback | shell launch, transcript or model-declared completion |
| RT-2 local-first Beta | S26-S34 | Agent-team isolation, import lineage, safe checkpoint/replay/compaction/index rebuild, bounded Hooks and Memory/Armor/evolution rollback pass together | several parallel chats or generated Skills alone |
| RT-3 production candidate | S26-S38 | DJ-29/DJ-30 and PJ-01 through PJ-12 join signed platform, enterprise, SLO, security, accessibility and design-partner Gates on one reviewed SHA | combining evidence from different candidate SHAs |

Release names are evidence-bearing claims. A train may be delayed or narrowed,
but cannot be renamed upward while its required proof is missing.

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
