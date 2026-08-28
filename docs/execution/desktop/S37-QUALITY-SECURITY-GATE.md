# S37 Runbook — Quality and Security Gate

Status: planned

Duration: 12-15 working days

Owners: Quality/Security Review Lead (A), Performance/Accessibility/Security/
Reliability Engineers (R), independent reviewers (R)

Risk: critical

## Outcome

The complete packaged desktop is measured and attacked as a product. Fixed SLO,
accessibility, privacy, recovery, supply-chain and threat-model gates produce a
deterministic readiness report. Feature work stops unless required to close a
Gate finding.

## Work packages

### S37-WP01 — Performance and resource SLO

Measure cold/warm start, first repository open, first Agent response, event
latency, 10k-file indexing, large Diff, memory idle/active, CPU idle, disk growth
and shutdown on reference low/mid/high machines. Record median/P95 and raw
metadata without user content.

### S37-WP02 — Accessibility audit

- Keyboard-only completion of first run, Agent task, approval and Diff review.
- VoiceOver, NVDA and Orca/AT-SPI coverage on supported OSes.
- 200%/400% zoom, high contrast, color independence, focus order, live regions,
  reduced motion and cognitive load.
- No P0/P1 defect; lower defects have owner and release decision.

### S37-WP03 — Localization and content

- Chinese and English completeness, pseudo-localization expansion, plural/date/
  number formatting, IME composition and shortcut labels.
- No untranslated security decision, clipped approval scope or locale-dependent
  parser behavior.
- Terminology glossary fixes Goal/Task/Run/Realm/Worktree/Evidence meanings.

### S37-WP04 — Security red team

Cover prompt injection, malicious repository, terminal escape, Webview XSS,
Renderer/extension compromise, IPC spoof, secret theft, egress bypass, MCP/
plugin supply chain, update tamper, cross-tenant access, resource exhaustion and
audit tamper. Map every finding to threat ID, exploit evidence and control.

### S37-WP05 — Reliability and recovery

Run 24-hour workload, crash loops, process kill, OS restart, network partition,
disk full, corrupt cache/index, provider outage, sync conflict and failed
migration. Prove bounded retries, containment, Safe Mode and evidence retention.

### S37-WP06 — Deterministic desktop readiness gate

Input only immutable descriptors and test metadata; output per-family results,
finding IDs and digest. Required families: DesktopTruth, CoreBoundary,
FunctionalJourney, CrossPlatform, Accessibility, Performance, Privacy,
Recovery, SupplyChain, ThreatCoverage and ReportHygiene.

## Verification

```sh
node scripts/verify-s37.mjs
pnpm desktop:bench
pnpm desktop:test:a11y:all
pnpm desktop:test:redteam
pnpm desktop:test:chaos
pnpm desktop:readiness
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- Deterministic readiness verdict is ready with zero P0/P1 finding.
- Every threshold has raw evidence and a fixed reference environment.
- Red-team findings are fixed and regression-tested or explicitly block release.
- The report contains metadata only and no source, prompt, secret or private
  transcript.
