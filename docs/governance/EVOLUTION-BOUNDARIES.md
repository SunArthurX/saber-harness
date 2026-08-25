# Governed Evolution Boundaries E0–E7

Status: frozen for S01

Saber chooses the least-powerful medium capable of solving an observed problem. A lower-risk memory or workflow is preferred over arbitrary code; an isolated tool is preferred over Core modification; a replaceable provider is preferred over model training.

| Level | Mutable subject | Automation ceiling | Mandatory gate | Promotion scope |
|---|---|---|---|---|
| E0 | current context and plan | automatic within one Run | budget, provenance and Run policy | current Run only |
| E1 | working/episodic memory candidate | automatic proposal; scoped auto-promotion may be policy-enabled | explainability, provenance, TTL/revocation | user/workspace |
| E2 | preference, rule, prompt or typed workflow | propose | conflict analysis and owner acceptance | user/workspace/repo |
| E3 | Skill | generate and evaluate | versioned eval, permission diff and rollback | workspace/repo; organization only by inheritance review |
| E4 | Script, Tool, Code Capsule or Plugin | isolated generation and testing | strong sandbox, locked dependencies, SBOM, security scan, human approval and signature | governed capability registry |
| E5 | Agent strategy or model router | offline optimization | paired evaluation, shadow, canary, budget and kill switch | staged runtime rings |
| E6 | product Core source | pull-request proposal only | independent review, full compatibility/security/fault suite, protected reproducible signed build | signed product release rings |
| E7 | Policy/Crypto/Updater/Audit trust roots | autonomous modification forbidden | security-team-only ceremony, separated credentials, recovery drill and root rotation process | platform trust root |

## Cross-level invariants

1. Evidence creates a candidate, not proof of improvement.
2. Promotion is the only operation that can change a live capability reference.
3. Every generation is immutable and content-addressed; apply rechecks the expected target hash.
4. Scanner, Evaluator, PDP and Reviewer have different responsibilities and cannot substitute for one another.
5. E4–E6 can never be downgraded to approval-free publication by workspace configuration.
6. E7 requests from an Agent are rejected and escalated; they are not converted to E6 automatically.
7. Every promotion retains a last-known-good target and rollback/quarantine path.
8. Cross-scope inheritance is a new promotion requiring evidence sanitization and organizational evaluation.

## Somatic and germline changes

- Somatic change affects one Run, user, workspace or repository. Its small fault domain permits faster experiments but never grants broader inheritance.
- Germline change propagates to new workspaces, users, organization baselines or product releases. It requires independent validation, signed artifacts and staged rollout.

## E4 Code Capsule contract

A Code Capsule declares typed inputs/outputs, immutable runtime/dependency digests, resource budget, capability scope, network policy, evidence, tests, owner scope and promotion target. It receives no ambient home directory, complete environment, Core IPC, signing material or arbitrary network.

## E6 self-change separation of duties

Problem statement, candidate authoring, independent review, protected CI, approval, signing and deployment are separate events and identities. A running product cannot declare its own candidate successful or published.
