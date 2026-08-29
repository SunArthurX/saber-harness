# S29 Handoff — Conversation and Context

Status: completed — PR #77 merged (dd1b43f) with all five required checks green and all six main contexts green on the merge commit; this record closes S29. The annotated s29-complete tag follows this record's merge; S30 (governed agent run) starts from its runbook in a new execution round
Date: 2026-08-29
Branch: `segment/S29-conversation-context`
Base main: `e33f70bd699313c8c9b9b6980af0a7ef74f9a8ee` (`s28-complete`)
Runbook: `docs/execution/desktop/S29-CONVERSATION-CONTEXT.md`

## Objective

Users can hold a streaming, resumable desktop Agent conversation and
know exactly which files, symbols, artifacts, prior conversations,
skills and attachments will be sent to which model and why. Exclude and
revoke are effective operations with evidence, not visual decorations.

## What landed

- **WP01 message model** (`conversationModel.js`): ten distinctly
  rendered message kinds; append-only stream with reconnect
  deduplication by event ID; hidden chain-of-thought counted but never
  exposed; retry appends a new causal event (`retryOf`) — history is
  never rewritten; copy output carries redaction markers; tool detail
  collapses by default while Evidence navigation survives.
- **WP02 composer** (`composerState.js`): ten-state machine with a
  closed transition table; `@` `#` `/` `$` resolve their documented
  domains; `+` attachments gated on media/size/malware/sensitivity;
  queue and steer are separate explicit operations with visible
  insertion boundaries (steer requires an event cursor); every failure
  retains the draft and explains recovery.
- **WP03 context preview and receipt** (`contextReceipt.js`): ten-field
  fragment provenance contract; secret-sensitivity fragments refused;
  preview totals reconcile with sent receipts (divergences listed);
  exclusion removes before dispatch and records evidence; keyboard
  chips.
- **WP04 selectors** (`selectorPolicy.js`): provider/model/deployment/
  context-limit/price/eligibility display; realm boundaries with data
  egress; closed capability set where `governed-full` is clamped by
  Core policy (dropped capabilities surfaced); token/money/wall-time/
  tool-call budgets clamped to hard and policy ceilings.
- **WP05 privacy** (`privacyControls.js`): canary scans prove secret
  and sensitive-data canaries never reach provider fixtures; revoke
  blocks future retrieval and names already-contacted providers
  honestly; drafts only in approved encrypted crash-excluded storage.
- **WP06 a11y** (`s29-a11y-conversation.test.mjs` + journey runner
  `scripts/run-a11y.mjs`): rate-limited summarized announcements,
  keyboard-operable chips, failures retain drafts and explain recovery.
- **Wiring**: native conversation commands (focus — keybound —, retry,
  previewContext, excludeFragment) with en/zh strings; four suites
  (conversation 12, context-receipts 9, redaction-canary 6,
  conversation a11y 4); `verify-s29` (119 checks) chained into
  `verify:repo` and hosted verification.

## Evidence

`docs/execution/EVIDENCE.json` (S29 in_progress) — every work package
has a focused check with real local results; full `pnpm verify` green.

## Next actions

1. Create annotated `s29-complete` on this record's merge commit;
   verify the peeled SHA equals that main commit locally and remotely.
2. S30 (governed agent run, RT-1 MVP) starts only from
   `docs/execution/desktop/S30-GOVERNED-AGENT-RUN.md` in a new
   execution round.
