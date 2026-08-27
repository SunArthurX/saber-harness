# S19 Cross-model Execution Handoff

This is the pause point after the S18 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s18-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S19-plugin-sdk-registry`
- S19 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S19：Plugin SDK/Registry"

## Mandatory startup

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s18-complete
git rev-parse 's18-complete^{}'
git rev-parse origin/main
```

The worktree must be clean; the tag must be annotated and an ancestor of `origin/main`. Read AGENTS.md, STATE.yaml, HANDOFF.md, EVIDENCE.json, ROADMAP.md, ADR-020, the SEC-ISO-005 entry and TB-07 in `docs/security/TRUST-BOUNDARIES.md`. Verify the inherited boundary:

```sh
node scripts/verify-remote-s18.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those pass: `git switch -c segment/S19-plugin-sdk-registry origin/main`, then immediately update STATE.yaml, HANDOFF.md and EVIDENCE.json to truthful S19 `in_progress` state.

## S19 objective

The external-armor marketplace: a plugin SDK and registry where third-party extensions run isolated, capability-declared and revocable — governance equal to first-party code (TB-07, SEC-ISO-005).

Required deliverables:

1. A plugin manifest schema (stable id, version, content digest, closed-vocabulary declared capabilities, sandbox realm, budgets) — building on the S06 host admission already in `crates/effect-broker/src/plugin_host.rs`.
2. Registry semantics: signed-style digest-pinned entries (full signing keys arrive with S22 TUF, stated honestly), monotonic updates, revocation removing plugins from the executable set immediately.
3. The SDK surface: typed capability requests, event contracts and lifecycle hooks — all routed through the S05/S06 boundaries; no direct host access anywhere in the SDK.
4. Compatibility testing: declared capability probe results ride the manifest; incompatible/undeclared behavior fails closed at admission.
5. A S19 verifier and strict remote verifier preserving every S00-S18 gate.

## Adversarial acceptance (minimum)

- tampered manifests (digest mismatch) fail admission;
- plugins requesting undeclared capabilities fail closed;
- revoked plugins never execute again;
- registry rollback refused;
- SDK surface exposes no host-access path;
- fault containment from the S06 host still holds with registry-sourced plugins.

## Segment publication protocol

Unchanged from S18: one Segment branch, explicit staging, full local gate, truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S19 verification, atomic completion record through a second protected PR, then annotated `s19-complete`.

Never mark S19 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
