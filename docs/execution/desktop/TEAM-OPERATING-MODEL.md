# Team Operating Model

## Role ownership

| Role | Accountable for | Cannot approve alone |
|---|---|---|
| Product Manager | user outcome, scope, design-partner acceptance | security exception, release signature |
| Desktop Tech Lead | Code-OSS fork, Workbench, native integration | Renderer/Core boundary change |
| Trusted Runtime Lead | Core protocol, lifecycle, recovery | UX acceptance or own security exception |
| Agent Architect | Goal/Plan/Run, providers, context | permission expansion or Memory promotion policy |
| Security Lead | threat model, sandbox, secrets, egress, update | own implementation without independent reviewer |
| Data/Privacy Lead | import, lineage, Memory, E2EE, deletion | legal basis or customer consent alone |
| Release Manager | packages, signing, rings, rollback | critical exception without dual approval |
| SDET Lead | fixture repositories, E2E, chaos, Gate evidence | lowering acceptance to match current behavior |
| UX/Accessibility Lead | workflow, content, WCAG, research | authorization semantics |
| Enterprise Lead | identity, policy, KMS, audit, retention | cross-tenant exception |

## RACI by stream

Legend: A accountable, R responsible, C consulted, I informed.

| Deliverable | Product | Desktop | Runtime | Agent/Data | Security | QA | UX | Release |
|---|---|---|---|---|---|---|---|---|
| Default Workbench | A | R | C | C | C | R | R | I |
| Local protocol | I | R | A/R | C | R | R | C | I |
| Approval UX/semantics | A | C | R | C | A/R | R | R | I |
| Diff/apply/rollback | C | A/R | R | I | C | R | R | I |
| Continuity/Memory | A | C | C | A/R | R | R | R | I |
| Evolution/Health | A | C | R | R | A/R | R | R | I |
| Enterprise control | C | C | R | C | R | R | C | A/R |
| Package/update | I | R | C | I | R | R | C | A/R |
| Production decision | A | C | C | C | A | R | C | A/R |

## Cadence

### Daily

- 15-minute risk/blocked sync by workstream; no status theater.
- Owners update task ID, evidence link and next safe action.
- Security/recovery regression pages the accountable lead immediately.

### Weekly

- Monday: Segment scope and Gate review.
- Midweek: packaged vertical demo from a clean profile, never only Storybook.
- Friday: real-repository eval, defect/risk burn-down and evidence audit.
- Code-OSS upstream intake review during S26-S38 at a fixed weekly slot.

### Segment close

1. Scope/ADR freeze.
2. Implementation and pair review.
3. Focused, full, platform and adversarial tests.
4. Independent UX/accessibility/security review as required.
5. STATE/HANDOFF/EVIDENCE update.
6. Explicit-path commit and remote SHA verification.
7. Hosted checks and protected PR.
8. Clean main verification and annotated tag.

## Change control

| Change | Required approval |
|---|---|
| Product scope or default surface | Product + Desktop + owner |
| Renderer/Core authority boundary | Runtime + independent Security + owner |
| New capability vocabulary | Runtime + Policy/Security + traceability review |
| New model/data destination | Privacy + Security + Product |
| Memory promotion rule | Data/Privacy + Security + Product |
| Signing/update trust | Release + Security dual control |
| Production critical exception | Security + Release + executive owner; expiry required |

## Defect severity

| Severity | Examples | Response |
|---|---|---|
| P0 | data loss, secret escape, unsigned execution, cross-tenant access | stop release/run, contain, preserve evidence |
| P1 | Core bypass, unrecoverable crash, inaccessible core journey | Segment/release blocker |
| P2 | major workflow failure with safe workaround | owner and target before release decision |
| P3 | polish/localized edge case | prioritized backlog with evidence |

Flaky tests are defects. Quarantine requires owner, cause hypothesis, expiry and
non-reduction of the affected Gate; repeated reruns are not evidence.

## Documentation and evidence ownership

- Implementer writes procedure and raw evidence.
- Reviewer reproduces the critical command or inspects immutable CI evidence.
- SDET owns fixture stability and Gate interpretation.
- Security owns threat mapping but not product completion.
- Release owns artifact identity and remote SHA/signature reconciliation.
- Handoff states failures and rejected options, not only successes.
