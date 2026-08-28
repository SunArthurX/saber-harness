# S37 Runbook — Quality and Security Gate

Status: planned

Release train: RT-3 Enterprise Production Candidate

Duration: 12-15 working days

Owners: Quality/Security Review Lead (A), Performance/Accessibility/Security/
Reliability Engineers (R), independent reviewers (R)

Risk: critical

## Outcome

The complete packaged desktop is measured and attacked as a product. Fixed SLO,
accessibility, privacy, recovery, supply-chain and threat-model gates produce a
deterministic readiness report. Feature work stops unless required to close a
Gate finding.

## Competitive-derived requirements

- `CLD-02`, `ZCD-04`: red-team Preview/Browser against prompt injection,
  hostile DOM, origin changes, cookie leakage, false screenshot success and
  action/evidence mismatch.
- `CLD-07`, `ZCD-07`, `MMX-08`: forge remote device intent, replay approvals,
  disconnect the UI and prove global Stop/containment reach.
- `MMX-01`, `MMX-02`: measure solo-versus-team quality, latency, token cost,
  retry amplification and verifier independence on fixed repositories.
- Test every `CDX`/`CLD`/`ZCD`/`MMX` adoption as a Saber contract rather than a
  claim of competitor parity.

## Advanced harness and philosophy requirements

- `CUR-05`, `DSH-07`, `OHD-03`: attack browser input, replaceable subsystems and
  Renderer projection without permitting a Policy, credential or Runtime bypass.
- `DSH-06`, `KIR-02`: fuzz typed event/ID boundaries and Hook blocking,
  recursion, circuit breaker, unload and residue behavior.
- `OHD-05`: rebuild Runtime images from locked provenance and reject drifted or
  unverifiable execution evidence.
- `AID-02`, `AID-04`: measure verifier independence and bounded repair-loop
  quality, cost, retry amplification and regression.
- Execute PJ-01 through PJ-12, including the negative rule that a brain or
  reflex cannot suppress, replace or exit immune containment.

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
