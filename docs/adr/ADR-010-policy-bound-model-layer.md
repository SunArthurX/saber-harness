# ADR-010 — Policy-Bound Replaceable Model Layer

Status: accepted
Date: 2026-08-27
Deciders: repository owner and S08 architecture review

## Context

The roadmap requires swappable model execution: one versioned SPI over
OpenAI-compatible, Anthropic-compatible and Ollama providers, a signed Model
Registry with capability probes, and a router that filters by policy before
ranking by quality and cost. S06 already froze the egress and secret
boundaries; S05 froze policy. The model layer must consume them rather than
reimplement them, and a provider must never be able to forge success, bypass
the Egress PEP or hold raw credentials.

## Decision

### Translation-only adapters behind a versioned SPI

`ModelProvider` implementors are pure translators: typed `ModelRequest` in,
wire JSON out; wire JSON in, typed `ModelResponse`/`StreamEvent` out. The SPI
covers messages, tool declarations and calls, structured output, streaming
deltas, usage accounting, cancellation, typed errors with retryability and a
per-request data-policy declaration (data classification + purpose). Adapters
perform no I/O.

### PEP-authorized transport as a typestate

All network I/O lives behind `ModelTransport`, whose only method requires an
`EgressAuthorization` issued by the S06 PEP. An adapter or invoker that never
obtained an authorization cannot produce a transport call — the bypass does
not exist as a code path. Credentials reach the transport exclusively as
secret-broker lease material bound to the request digest; wire headers carry
redacted values whose debug rendering never prints material.

### Usage evidence or no success

A response without a usable usage record, or a stream that ends without a
terminal event and usage, is rejected as a provider error (non-retryable).
This is the model-layer instance of the no-forged-success invariant: exit
codes and HTTP statuses alone never constitute success.

### Digest-verified monotonic Model Registry

Registry entries are canonical-JSON digested; the registry validates every
digest on load, rejects duplicates and enforces monotonic sequence updates
like the S05 policy snapshot. Release-signing keys and TUF distribution
arrive with S22; until then the digest chain is the integrity boundary and
this limitation is explicit.

### Capability probes as routing evidence

A probe issues tiny PEP-authorized requests through the transport and
records which capabilities (streaming, tools, structured output) actually
worked. Unhealthy or probe-failing providers are excluded from routing
regardless of their declared capabilities.

### Deterministic classification-first router

Routing filters by data classification, residency and required capabilities
first — a restricted request can never route to a provider whose ceiling is
lower — then ranks survivors by quality tier (descending) and cost
(ascending) with a stable provider-id tie-break. Identical inputs produce a
byte-identical decision including the registry snapshot id.

### Fail-closed budgets

Every task holds a bounded token budget. Usage events consume it as a stream
progresses; exhaustion mid-stream cancels cleanly and returns the partial
usage as durable evidence. When no provider is affordable, routing fails
closed instead of degrading the data policy. Retries are bounded, idempotent
by request id, and only issued for retryable error classes.

## Consequences

- Adding a provider means writing one translator plus a registry entry; no
  boundary code changes.
- Providers that omit usage (some Ollama models) must run behind a wrapper
  that synthesizes usage or be marked unusable for success verification.
- Probe results are cached evidence, not guarantees; routing re-probes on
  health decay.
- The registry's "signed" status is honest about arriving fully at S22.

## Rejected alternatives

- Letting adapters own HTTP clients: every provider would re-implement the
  egress and credential boundaries — the exact ambient-authority hole S06
  closed.
- Trusting provider success payloads without usage: forged-success hole.
- Cost-first ranking before classification filtering: policy would depend on
  economics.
- Auto-retrying every failure: provider/auth errors are terminal; retry
  storms amplify cost and damage (TM-09).

## Verification

- SPI contract tests: request/response/stream translation for all three
  families; usage-required success; typed-error retryability.
- Adversarial: forged success (missing usage), egress denial yields zero
  transport calls, credentials absent from serialized requests/logs/errors,
  classification-incompatible routing denied, mid-stream budget exhaustion
  cancels with partial usage, router determinism (snapshot hash), registry
  digest mismatch and rollback rejected, probe-failing providers excluded.
- S08 verifier and strict remote verifier preserve every S00-S07 gate.
