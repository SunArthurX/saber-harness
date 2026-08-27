# ADR-013 — Untrusted Renderer and Crash-Safe Run View

Status: accepted
Date: 2026-08-27
Deciders: repository owner and S11 architecture review

## Context

The IDE closes the loop between humans and the trusted Core. The renderer
process (Code-OSS workbench, extensions, webviews) is commodity UI code
with a large attack surface: it must never hold authority, and its crash
must never lose a Run (TB-01, roadmap gate "UI crash 不杀 Run"). S05
approvals, S06 boundaries and S09 explanations already exist as trusted
contracts; the IDE must consume them, not reimplement them.

## Decision

### The renderer is an untrusted protocol client

The IDE client package owns no authority: every mutation is a versioned
protocol request (JSON frame with actor identity, request id, deadline and
idempotency key) validated exactly like the S03 control contract — unknown
methods, oversized frames, expired deadlines, invalid identities and
version mismatches fail closed before anything is sent. There is no
renderer API that touches the host, the event store or a broker directly;
the exported surface consists only of protocol, replay and view-model
functions.

### The Run view is a pure replayable projection

`RunView` holds no run state: it is a cursor over the Core's durable event
stream. Crashing the client (dropping it) destroys only a local buffer; a
new client replays from any cursor and reconstructs the identical view
because the Core's event store is the single source of truth. Reconnect
and replay are the same operation.

### Approval cards cannot outscope their request

An approval card is a view-model over the S05 `ApprovalRequest`: it may
only display a scope equal to or narrower than the request's exact
resource selector, must die at the grant TTL, and must always present at
least the two minimum alternatives including deny. A card whose scope is
broader than the request — or that hides the deny choice — is a
construction error, not a rendering choice.

### Explanations render markers, never redacted content

The context panel is a view-model over the S09 `Explanation`: selection
reasons, provenance, trust, sensitivity and redacted field paths render as
labels; redacted fields render only their stable marker. Exclude and
revoke actions are protocol intents routed through the Core, never direct
fabric mutations.

## Consequences

- The renderer can be restarted, reloaded or replaced without run impact;
  operators lose at most un-acked local UI state.
- UI features that need authority (diff application, terminal input) are
  Core methods behind the S05/S06 boundary, added as protocol methods —
  never as renderer-local capabilities.
- The simulated harness in tests stands in for the real Code-OSS shell
  until the desktop app lands; the contract is identical.

## Rejected alternatives

- Renderer-side run state with sync: the crash-loss hole this ADR closes.
- Best-effort version negotiation: a mismatched client must stop, not
  partially work.
- Approval UI freedom in scope display: dark-pattern and scope-creep
  surface (TM-10).

## Verification

- Renderer crash/restart mid-run: run state untouched, replay identical.
- Version/size/deadline/method/identity violations fail closed pre-send.
- Exported client surface contains no effect path outside the protocol.
- Broader-scope approval cards, TTL-dead interactions and missing deny
  alternatives are rejected at construction.
- Redacted fields render only markers; exclude/revoke are protocol intents.
