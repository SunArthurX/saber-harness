# S08 Handoff

Status: completed atomically when this completion record merges through protected main
Date: 2026-08-27
Branch: `segment/S08-completion`
Implementation branch: `segment/S08-model-providers` @ `b8f7901c6d09c7a0341cfd7dde68f856a8b84a42`
Merged main: PR #26 squash-merged as `b884fa842e057f5ac2e68a7a398b3f4b908ad694`

## Objective

Make the model layer replaceable and policy-bound: every invocation routes through a versioned provider SPI, egress to any provider is authorized by the S06 Egress PEP with data-classification binding, and a deterministic router selects providers by policy, capability, privacy, budget and health without touching product authority state.

## What shipped (PR #26)

- ADR-010 froze the policy-bound model layer.
- `crates/model-providers` (`saber-model-providers`): versioned `ModelProvider` SPI (messages, tool declarations/calls, structured output, streaming events, usage accounting, cancellation, typed retryability-aware errors, per-request data-policy declarations).
- Translation-only adapters for OpenAI-compatible, Anthropic-compatible and Ollama wire families; adapters perform no I/O.
- PEP-authorized `ModelTransport` as the only network boundary: every `execute` requires an `EgressAuthorization`; credentials arrive exclusively as secret-broker lease material (`credential://broker/provider-<id>` grammar); wire envelopes are debug-redacted.
- Usage evidence or no success: responses without meaningful usage and streams without terminal events are provider errors (the no-forged-success invariant at the model layer).
- Digest-verified monotonic `ModelRegistry` (digest mismatch and sequence rollback rejected); release signing documented to arrive with the S22 TUF segment.
- Capability `probe_model` through PEP-authorized transports with `exclusions_from_reports` feeding the router.
- Deterministic classification-first `ModelRouter`: data-class/residency/capability filters before quality/cost ranking, stable tie-break, byte-identical decisions, fail-closed budgets, no silent model substitution.
- Fail-closed `TaskBudget` with accumulating usage, clean mid-stream cancellation preserving partial-usage evidence, and bounded idempotent retryable-only retries.
- `verify-s08.mjs` (144 checks) and `verify-remote-s08.mjs` wired into `pnpm verify` and the repository-verification workflow; FR-RUN-006 verified with evidence.

## Verified evidence

- Full local gate: fmt, strict clippy, 21 Rust test suites (15 model-layer adversarial tests), `pnpm verify`, `pnpm acceptance:new-machine`.
- Branch CI: push run `33028141710` green on all five required contexts at `b8f7901` on the first push.
- Protected integration: PR #26 merged after every required check; merge SHA `b884fa8`.
- Main workflows at `b884fa8`: provenance `33028566313`, repository verification `33028566330`, Monorepo CI `33028566325` all passed.
- Clean clone: anonymous HTTPS clone at `b884fa8` passed `pnpm acceptance:new-machine` in 81 seconds.
- Strict remote S08 verification passed at `b884fa8`.

## Remaining steps after this record merges

1. Verify final main workflows on the record merge commit.
2. Run `node scripts/verify-remote-s08.mjs --repository SunArthurX/saber-harness --branch main` (already green at the implementation SHA).
3. Create annotated `s08-complete` on the final commit.
4. Hand the next model `docs/execution/NEXT-MODEL-S09.md`.

## Non-negotiable review points

- Adapters stay translation-only; the PEP-authorized transport is the only network path.
- Credentials never appear in requests, logs, events or errors; lease injection only.
- Classification-incompatible routing is denied; the router never silently substitutes a model.
- Success requires usage evidence; budget exhaustion fails closed with partial-usage evidence.

## Next action

Finish the publication protocol above; do not begin S09 in this session.
