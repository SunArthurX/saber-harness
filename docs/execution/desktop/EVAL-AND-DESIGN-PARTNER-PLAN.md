# Evaluation and Design Partner Plan

## Evaluation principles

- Measure the product system, not only the model.
- Freeze repository commit, task, acceptance, environment and policy before a
  run.
- Separate task failure, tool/interface failure, policy denial, infrastructure
  failure and model failure.
- Preserve observable trajectory and evidence, not hidden reasoning.
- Never train/promote from partner data outside explicit consent and governance.
- Evaluate imported competitor workflows by outcome and trust, not UI
  resemblance; competitor product versions and source dates are recorded.

## Repository portfolio

| Class | Examples of traits | Minimum count by Beta |
|---|---|---:|
| TypeScript/Web | package manager, tests, lint, browser preview | 5 |
| Rust/System | Cargo workspace, strict Clippy, platform behavior | 4 |
| Python/Data | virtual env, tests, notebooks/data boundary | 4 |
| JVM/Enterprise | multi-module, build tool, generated code | 3 |
| Go/Service | modules, concurrency, integration test | 3 |
| Polyglot/Monorepo | multiple toolchains and package graph | 3 |
| Desktop/UI | snapshot/visual/accessibility testing | 2 |

Use owned/openly licensed fixtures for CI. Design-partner repositories run in
their authorized tenant/Realm and contribute only consented metadata/derived
results.

## Task taxonomy

- comprehension and architecture question;
- localized defect;
- multi-file behavioral defect;
- test generation and flaky test diagnosis;
- safe refactor with no behavior change;
- dependency/API migration;
- performance investigation;
- security remediation;
- documentation/build/release task;
- long-running Goal with resume;
- parallel multi-Agent task;
- incident/recovery task;
- impossible or unsafe task that must be refused.
- Side Inquiry followed by explicit promotion or discard;
- Local/Worktree/Remote Handoff with environment drift;
- Preview Auto-Verify with a planted visual/DOM contradiction;
- persistent Goal with verifier rejection and budget exhaustion;
- solo-versus-Team decision with a task that should not be parallelized;
- cross-Agent import, adapter degradation and continued conversation;
- Remote Dispatch, scheduled continuation and global containment;
- Memory-to-Skill/Code proposal that must fail promotion.

## Metrics

| Metric | Definition |
|---|---|
| Task completion | fixed acceptance passes with correct final tree |
| Human correction | user interventions changing plan/code, excluding approval |
| Regression | previously passing acceptance becomes failing |
| Tool failure | invocation fails for interface/infrastructure reason |
| Permission interruption | approvals per task, time waiting, unnecessary asks |
| Cost/task | provider plus remote execution cost for successful task |
| Time/task | start to accepted evidence, excluding declared user wait |
| Memory precision | accepted relevant recalls / recalls shown |
| Rollback frequency | rollback by cause and success |
| Security block | unsafe effects correctly denied; false blocks separately |
| Recovery | successful resume after injected fault and time to recover |
| Continuity fidelity | Goal/Task/decision/artifact facts preserved across import, compaction, Handoff and provider change |
| Team value | quality gain minus latency/token/coordination cost versus best solo route |
| Verifier independence | planted producer errors rejected without sharing producer conclusion as ground truth |
| Context contamination | Side Inquiry/cross-task/browser/import data entering an unauthorized context |
| Auto-Verify truth | interaction assertions correctly distinguish pass, fail and inconclusive |
| Adapter fidelity | supported source events/artifacts preserved; unsupported capability gaps disclosed |
| Evolution yield | promoted candidates that improve holdout tasks without safety/cost regression |

## Experiment design

- Compare fixed product version with model/provider routes.
- Ablate Memory, retrieval, tool feedback and planning independently.
- Use repeated seeds only where the model supports it; report variance.
- Blind human reviewers to route where practical.
- Do not tune on the final holdout task set.
- Every improvement candidate must show no unacceptable safety/cost regression.
- Compare at least one current Codex, Claude Code, ZCode or MiniMax workflow for
  users who already use that product, while keeping private transcripts out of
  the shared evaluation corpus.
- Run a competitor-derived feature in three conditions: familiar source
  workflow, Saber without the feature and Saber with the feature. Measure
  completion, correction, trust calibration, cost and recovery.

## Stage thresholds

S23/S37 SLOs and S38 review freeze exact numeric thresholds. Planning targets:

| Stage | Reliability focus | Required evidence |
|---|---|---|
| Vertical alpha | completes DJ-03 repeatedly | owned fixture, one OS then three OS |
| Internal alpha | representative task taxonomy | internal repos with consent |
| Private beta | task success, correction, trust, recovery | multiple partner teams and OSes |
| RC | signed artifact and operational readiness | fixed holdout, update/rollback game day |
| Production ring | bounded real usage | stop thresholds and accountable owner |

## Partner operating process

1. Security/privacy intake and data-flow disclosure.
2. Device/tenant enrollment and provider policy.
3. Baseline developer workflow observation.
4. Task selection and frozen acceptance.
5. Assisted onboarding and first task.
6. Weekly metric/review interview; incidents handled outside research cadence.
7. Candidate findings enter governed feedback/evolution intake.
8. Data export/deletion and partner exit verification.

## Stop thresholds

Immediate cohort pause for data loss, secret exposure, policy/Core bypass,
cross-tenant access, unsigned update or unrecoverable migration. Per-feature
pause for repeated misleading completion, approval dark pattern, severe
accessibility blocker or rollback failure.
