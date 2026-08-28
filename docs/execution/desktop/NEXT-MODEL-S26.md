# Next Model Instructions — Start S26 Only After S25 Merge

Use this file as the first prompt/checklist for the model implementing S26.

## Authority and stop rule

Repository state outranks this file. Read `AGENTS.md`, `STATE.yaml`, `HANDOFF.md`
and `EVIDENCE.json` first. If S25 is not merged, tagged and green on main, stop:
you may review this plan but must not bootstrap Code-OSS.

## Objective

Implement only S26 from `S26-CODEOSS-BOOTSTRAP.md`: a reproducible, branded,
development Code-OSS shell that opens the Desktop Agent Workbench by default on
macOS, Windows and Linux. Do not implement real Core IPC, Agent execution,
conversation features or production signing.

## First commands

```sh
git status --short --branch
git fetch --tags origin
git rev-parse origin/main
git rev-parse 's25-complete^{}'
node scripts/verify-s25.mjs
pnpm verify
git switch -c segment/S26-codeoss-bootstrap origin/main
```

If the requested branch already exists, inspect it and continue rather than
creating a conflicting branch.

## First-day outputs

Before modifying the product shell, produce and review:

1. Code-OSS candidate ref and resolved full commit.
2. Source/license/redistribution and Microsoft-service exclusion checklist.
3. Proposed `upstream.lock.json` schema with archive digest.
4. Patch/storage strategy and ignored cache/output paths.
5. Code-OSS-required Node/npm/toolchain versions.
6. Platform build matrix and estimated cache/time budget.
7. Exact S26 smoke journey and negative tests.

Do not invent a production signing identity, update URL, telemetry endpoint,
extension marketplace entitlement or Saber legal entity.

## Implementation order

1. Lock and verify upstream source.
2. Implement atomic cache and offline verification.
3. Add minimal patch series and product identity.
4. Add built-in extension skeleton using native contribution points first.
5. Build one local development target.
6. Add deterministic smoke.
7. Expand hosted matrix to required OSes.
8. Add `verify-s26.mjs`, full gates and evidence.

## Review questions

- Can a clean clone reproduce the source and package without trusting a moving
  branch?
- Is every Saber patch separately attributable and reversible?
- Are Microsoft-specific product services/marks excluded or explicitly
  licensed?
- Does startup open the Desktop Agent Workbench rather than Command Center?
- Is the Web supervisor unnecessary for primary use?
- Is there any privileged Renderer/Webview/extension path?
- Do logs/packages contain secret, user path or private source data?
- Do `git diff --check origin/main...HEAD`, focused and full gates pass?

## Mandatory handoff

Before stopping: record selected upstream commit/digests, all build commands,
artifact hashes, platform results, rejected approaches, open legal/security
questions and exact next command in STATE/HANDOFF/EVIDENCE. Push the Segment
branch, verify remote SHA and wait for required hosted checks. Do not start S27.
