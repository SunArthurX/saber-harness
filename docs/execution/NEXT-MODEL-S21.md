# S21 Cross-model Execution Handoff

This is the pause point after the S20 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s20-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S21-enterprise-iam-policy-audit`
- S21 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S21：企业 IAM/Policy/Audit"

## Mandatory startup

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s20-complete
git rev-parse 's20-complete^{}'
git rev-parse origin/main
```

The worktree must be clean; the tag must be annotated and an ancestor of `origin/main`. Read AGENTS.md, STATE.yaml, HANDOFF.md, EVIDENCE.json, ROADMAP.md, ADR-022 and the OPS-ENT entries in `docs/traceability.yaml`. Verify the inherited boundary:

```sh
node scripts/verify-remote-s20.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those pass: `git switch -c segment/S21-enterprise-iam-policy-audit origin/main`, then immediately update STATE.yaml, HANDOFF.md and EVIDENCE.json to truthful S21 `in_progress` state.

## S21 objective

Multi-tenant enterprise control: six-plane isolation (TB-09), external IAM mapping onto the S05 policy tiers, organization policy bundles with monotonic semantics, break-glass with full evidence, per-tenant audit separation and compliance evidence packs (Gate: 多租户隔离).

Required deliverables:

1. Tenant/workspace plane model: tenant-qualified keys, policies, events, budgets, sandboxes and diagnostics everywhere (TM-13).
2. IAM binding: external identities/roles map onto the closed principal kinds and policy tiers — never onto raw privileges; group/role expansion is deterministic and depth-bounded.
3. Organization policy bundles ride the existing S05 monotonic tier engine (no second policy semantics).
4. Break-glass: time-boxed, dual-controlled elevation that is fully evidenced, auto-expiring and never silent.
5. Per-tenant audit separation with exportable compliance evidence packs (metadata-only).
6. A S21 verifier and strict remote verifier preserving every S00-S20 gate.

## Adversarial acceptance (minimum)

- cross-tenant access attempts fail closed on every plane;
- IAM mappings cannot grant privileges outside the closed vocabulary;
- policy bundle rollback refusal still holds for organization bundles;
- break-glass expires and cannot self-renew;
- audit of one tenant cannot be read via another tenant's context;
- evidence packs contain no plaintext, credentials or transcripts.

## Segment publication protocol

Unchanged from S20: one Segment branch, explicit staging, full local gate, truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S21 verification, atomic completion record through a second protected PR, then annotated `s21-complete`.

Never mark S21 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
