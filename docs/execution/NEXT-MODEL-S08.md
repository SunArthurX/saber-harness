# S08 Cross-model Execution Handoff

This is the pause point after the S07 completion record is published. The next model should treat this file as navigation only; Git, hosted checks, schemas, ADRs and executable evidence remain authoritative.

## Expected checkpoint

- Repository: `https://github.com/SunArthurX/saber-harness`
- Completed tag: `s07-complete` (annotated, on the final completion-record main commit)
- Next branch: `segment/S08-model-providers`
- S08 source of truth: `docs/企业级开发执行与跨模型接力计划.md`, section "S08：ModelProvider、Router 与换模型执行"

Do not trust a copied SHA in chat. Resolve the annotated tag and protected remote directly.

## Mandatory startup

Run from the repository root:

```sh
git status --short --branch
git fetch origin main --tags
git cat-file -t s07-complete
git rev-parse 's07-complete^{}'
git rev-parse origin/main
```

The worktree must be clean, the tag must be annotated, and `s07-complete^{}` must be an ancestor of `origin/main`. Then read, in order:

1. `AGENTS.md`
2. `docs/execution/STATE.yaml`
3. `docs/execution/HANDOFF.md`
4. `docs/execution/EVIDENCE.json`
5. `docs/execution/ROADMAP.md`
6. `docs/adr/ADR-007-deterministic-monotonic-policy-enforcement.md`
7. `docs/adr/ADR-008-sandbox-secret-egress-fail-closed-boundaries.md`
8. `docs/adr/ADR-009-tool-lifecycle-verification.md`
9. FR-RUN-006 and SEC entries in `docs/traceability.yaml`

Verify the inherited boundary before editing:

```sh
node scripts/verify-remote-s07.mjs --repository SunArthurX/saber-harness --branch main
pnpm acceptance:new-machine
```

Only after those commands pass:

```sh
git switch -c segment/S08-model-providers origin/main
```

Immediately update `STATE.yaml`, `HANDOFF.md` and `EVIDENCE.json` to truthful S08 `in_progress` state before the first implementation checkpoint.

## S08 objective

Make the model layer replaceable and policy-bound: every model invocation routes through a versioned provider SPI, egress to any provider is authorized by the S06 Egress PEP with data-classification binding, and a deterministic router selects providers by policy, capability, privacy, budget and health without touching product authority state.

Required deliverables (per the roadmap):

1. A versioned ModelProvider SPI: streaming, tool-calls, structured output, usage accounting, cancellation, typed errors and data-policy declarations.
2. OpenAI-compatible, Anthropic-compatible and Ollama adapters behind the SPI; no adapter may bypass the egress PEP or hold raw credentials (secret leases only).
3. A signed Model Registry with capability probes so routing decisions are evidence-based.
4. A deterministic router that filters by sensitivity/residency/capability first, then ranks by quality/cost within the survivors; budget exhaustion fails closed.
5. Every invocation consumes a budget from a bounded per-task allocation; retries are bounded and idempotent.
6. A S08 verifier and strict remote verifier preserving every S00-S07 gate.

## Adversarial acceptance (minimum)

- provider responses claiming success without matching usage/stream evidence are rejected;
- an adapter attempting direct network access outside the Egress PEP fails closed;
- credentials never appear in requests, logs, events or errors (secret-lease injection only);
- classification-incompatible routing (restricted data to a non-approved provider) is denied;
- budget exhaustion mid-stream cancels cleanly and records durable partial-usage evidence;
- router decisions are deterministic for identical inputs (snapshot-hash test).

## Segment publication protocol

Unchanged from S07: one Segment branch, explicit staging, full local gate (`cargo fmt --check`, strict clippy, `cargo test --workspace --locked`, `pnpm verify`, `pnpm acceptance:new-machine`), truthful state updates, push with SHA equality, every required CI context green, protected-PR merge, clean clone, strict remote S08 verification, atomic completion record through a second protected PR, then annotated `s08-complete`.

Never mark S08 complete while any test, review, CI, clean-clone, remote verification or SHA equality is unresolved. Never commit secrets, private transcripts or hidden reasoning.
