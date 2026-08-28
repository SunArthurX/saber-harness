# S38 Runbook — Design Partner and Production

Status: planned

Release train: RT-3 Enterprise Production Candidate

Duration: 20-30 working days

Owners: Product/Release Lead (A), Eval/SDET/Support/Privacy/Security owners (R),
Design Partner representatives and executive release reviewers (C/A)

Risk: critical

## Outcome

The signed release candidate succeeds on representative real projects for an
authorized design-partner cohort, meets fixed reliability/trust/recovery/privacy
thresholds and has operational support, incident and rollback readiness. A
signed production decision either approves a bounded rollout or blocks it with
specific findings.

## Competitive-derived requirements

- Final validation traces `CDX-03`, `CDX-04`, `CLD-02`, `CLD-04`, `CLD-06`,
  `ZCD-02`, `ZCD-04`, `ZCD-07`, `ZCD-09`, `MMX-01`, `MMX-02`, `MMX-04` and
  `MMX-08` to observed user outcomes and retained Evidence.
- Design-partner scripts cover DJ-14 through DJ-24: import/resume, Handoff,
  Side Inquiry, Preview, Goal rounds, dynamic team, harness adapters, remote,
  automation, evolution and Cross-Task messages.
- Evaluate discoverability and trust against users' current Codex, Claude Code,
  ZCode or MiniMax workflow without asking them to reproduce private data.
- Record capability parity, deliberate deviation and unresolved gap separately;
  a familiar-looking UI is not evidence of task success.
- Production review confirms that competitor-inspired convenience did not
  weaken Core authority, provenance, human sign-off, isolation or rollback.

## Work packages

### S38-WP01 — Cohort and consent

- Select project languages, repository sizes, OSes, privacy profiles and team
  types without cherry-picking only easy tasks.
- Written consent defines code access, model providers, telemetry, support
  bundle, retention, deletion, incident notification and exit.
- Use isolated tenant/workspace keys and named partner owner.

### S38-WP02 — Fixed task benchmark

- Categories: understand, fix, refactor, test, dependency, documentation,
  multi-file, long-running, multi-Agent, resume, recovery and denial.
- Freeze acceptance and starting commit before execution.
- Record task completion, human correction, regression, latency, cost, approval
  interruption, Memory precision and rollback.
- Compare models/providers as replaceable routes, not product identities.

### S38-WP03 — Alpha, beta and RC rings

- Internal alpha validates instrumentation and support flow.
- Private beta expands representative repositories after thresholds pass.
- RC uses production-signed artifacts and update channel.
- Each ring has start/stop threshold, cohort, duration, owner and rollback.

### S38-WP04 — Support and incident readiness

- User-facing diagnostics, safe support bundle and self-service recovery.
- Severity/on-call/communication/RCA and security disclosure playbooks.
- Rehearse bad update, provider outage, sync loss, secret incident and corrupted
  local profile.
- Support cannot request raw secrets or unrestricted private repositories.

### S38-WP05 — Privacy and governance closeout

- Verify opt-in telemetry, data map, subprocessors, retention/deletion, export,
  DSR workflow and regional deployment claims.
- Review enterprise policy, model destination, plugin registry and Break Glass
  audit with independent owners.
- Confirm public documentation matches actual offline/local/cloud behavior.

### S38-WP06 — Production decision

Release packet contains signed artifact/provenance, S37 readiness digest,
design-partner KPI, open findings, rollback, support coverage and accountable
approvals. No one-person approval for a critical security exception.

## Verification

```sh
node scripts/verify-s38.mjs
pnpm desktop:acceptance:design-partner
pnpm desktop:acceptance:new-machine
pnpm desktop:verify:release-candidate
pnpm desktop:readiness
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- Fixed benchmark meets published production thresholds across representative
  projects and platforms.
- No unresolved P0/P1 security, privacy, recovery or data-loss finding.
- Support, incident, rollback and update ring game days pass.
- Release decision, artifact digests and responsible reviewers are immutable and
  independently verifiable.
- Rollout begins with a bounded ring; production approval is not permission to
  remove monitoring or rollback.
