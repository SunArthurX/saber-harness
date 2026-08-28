# Desktop Segment Runbook Template

Copy this structure when a future Segment is added. Remove instructional text
only after every field has a concrete value.

## Header

- Segment: `Sxx`
- Name: short slug
- Status: planned | in progress | ready for review | completed
- Target duration: working days
- Owner roles: accountable and responsible roles
- Predecessor: tag and expected commit
- Branch: `segment/Sxx-slug`
- Risk class: low | medium | high | critical

## Outcome

One falsifiable paragraph describing what becomes true for a real user.

## Preconditions

- Required prior contracts, binaries, fixtures and hosted checks.
- Required external decisions, credentials or hardware.
- Exact read-only commands that prove readiness.

## Scope

### In scope

List product and engineering outcomes.

### Out of scope

List tempting adjacent work that must wait.

## Work packages

Each package uses this schema:

| Field | Required content |
|---|---|
| ID | `Sxx-WPnn` stable identifier |
| Owner | one accountable role |
| Dependencies | work-package IDs or predecessor evidence |
| Inputs | contracts, source files, designs and fixtures |
| Planned files | exact file or directory targets where knowable |
| Procedure | ordered implementation steps |
| Tests | positive, negative, recovery and platform cases |
| Evidence | machine output, artifact, screenshot or review record |
| Rollback | how to return to the last known good state |

## UX states

For each surface list: loading, empty, ready, running, waiting, denied, partial,
failed, offline, reconnecting, safe mode and recovered. Include keyboard, screen
reader, zoom, high-contrast and reduced-motion behavior.

## Security review

- Trust boundaries touched.
- New IPC methods and capability vocabulary.
- Secret, network, filesystem, process and update effects.
- Threat-model cases and canaries.
- Reviewer independent from the implementation owner.

## Platform matrix

State exact macOS, Windows and Linux expectations, architecture, package type,
filesystem semantics, PTY/shell behavior, sandbox and known exclusions.

## Verification commands

Commands must be non-interactive, reproducible and runnable from a clean clone.
Separate local focused checks, full checks, package smoke, hosted checks and
strict remote checks.

## Exit Gate

Every item must be binary and point to evidence. Avoid “looks good”, “works in
demo” and unmeasured percentages.

## Evidence record

Record:

- command and exit code;
- operating system and architecture;
- local and remote commit SHA;
- input fixture or repository ID without private content;
- artifact digest and signer where applicable;
- CI run URL and exact job names;
- reviewer and approval scope;
- known failures and whether they are fixed, accepted or still pending.

## Handoff

State current truth, completed packages, partial packages, rejected approaches,
known issues, exact next command and explicit prohibition against starting the
next Segment before protected merge.
