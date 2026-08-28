# S26 Handoff — Code-OSS Bootstrap (RT-0 Engineering Preview)

Status: in progress — reproducible bootstrap proven locally; Electron
compile, three-platform packages and runtime smoke not run; nothing
packaged is claimed
Date: 2026-08-28
Branch: `segment/S26-codeoss-bootstrap`
Base main: `cedaee7fca4b987777218556dcffca8a63a77fa1` (`s25-complete`)
Runbook: `docs/execution/desktop/S26-CODEOSS-BOOTSTRAP.md`

## Objective

A reproducible, minimally branded Code-OSS/Electron development shell that
opens toward the Desktop Agent Workbench with a built-in `saber-agent`
extension skeleton — an RT-0 engineering preview with no Core IPC, no Agent
execution, no production signing and no packaged-release claim.

## What shipped on this branch

- **Upstream lock (WP01)**: `apps/desktop-codeoss/upstream.lock.json` pins
  microsoft/vscode release `1.135.0` → commit
  `08d4889f9ec4a1685d257b9b95de036c8e1ce1e5` (2026-08-25), codeload archive
  52,159,992 bytes, sha-256
  `f5a0bd67cf04080b59e316cc4e39e0fa2aedf16da15be955c85141fe9febe525`,
  MIT, upstream Node 24.18.0 from `.nvmrc`, patch provenance, service
  exclusions and the atomic cache policy.
- **Supply-chain record**: `apps/desktop-codeoss/UPSTREAM-AND-SUPPLY-CHAIN.md`
  carries the ten required reviewable outputs (selection rationale, license
  and Microsoft-service exclusion checklist, lock schema, cache/offline
  policy, patch strategy, toolchain matrix, packaging/smoke plan, workbench
  projection note, risk register, explicit TBD-BY-SEGMENT blockers).
- **Atomic source cache (WP02)**: `scripts/fetch-upstream.mjs` refuses
  symbolic refs, short shas, non-https and non-commit-addressed URLs;
  downloads to a pid-suffixed temporary, verifies sha-256 and promotes by
  atomic rename; `--offline` re-verifies the cache with zero network;
  nothing from the archive is ever executed by Saber tooling.
- **Patch series (WP03)**: `patches/series.json` + patch
  `0001-product-identity` — 13 identity fields in upstream `product.json`
  (Saber Studio names, `.saber-studio` data directory, `saber://` protocol,
  Microsoft marks removed from win32/darwin identity). Generated from the
  real pinned tree; `apply-patches.mjs` applies with `git apply` (fuzz
  fails), proves reversibility, is idempotent, copies built-in extensions
  and discards the worktree on any failure.
- **Built-in extension skeleton (WP04)**:
  `extensions/saber-agent` — native contributions only: activity-bar
  container `saber-workbench`, native tree view with welcome, `saber.*`
  commands, read-only placeholder document provider; no webview, no node
  builtins beyond the `vscode` API, honest not-connected copy, en/zh
  `package.nls` parity.
- **Deterministic static smoke (WP06, static half)**:
  `scripts/smoke.mjs` — 14 checks over the real patched tree (branding,
  data isolation, no Microsoft marks, no gallery endpoint, extension
  contracts, honest copy).
- **Fail-closed build entry (WP05, preflight)**: `scripts/build.mjs`
  verifies the exact locked Node (exit 64 on mismatch), prepares the
  worktree, and gates the full Electron compile behind `--full` on a
  verified toolchain.
- **Focused verifier + negative tests**: `scripts/verify-s26.mjs` (55
  checks) chained into `pnpm verify:repo` and the hosted
  repository-verification workflow; `scripts/tests/s26-desktop-bootstrap.test.mjs`
  (6 tests) covers symbolic-ref/short-sha/http/URL-ref rejection, offline
  fail-closed, corrupt-cache rejection, never-promote-on-mismatch, patch
  conflict failure, idempotency and manifest requirements.

## Verified evidence (all commands actually run)

- `pnpm desktop:upstream:fetch` (first download) and
  `pnpm desktop:upstream:verify --offline` — digest matches the lock.
- `node apps/desktop-codeoss/scripts/apply-patches.mjs` — extract, apply,
  reverse-verify, extension copy; repeated run is idempotent.
- `node apps/desktop-codeoss/scripts/smoke.mjs` — 14/14 PASS on the real
  patched worktree.
- `node apps/desktop-codeoss/scripts/build.mjs` — exit 64 with the
  monorepo Node 24.15.0 (fail closed); preflight PASS with the pinned
  Node 24.18.0 cached under `.cache/node/` (sha-256 of the toolchain
  tarball recorded in the session log:
  `e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1`).
- `node --test scripts/tests/s26-desktop-bootstrap.test.mjs` — 6/6 PASS.
- `node scripts/verify-s26.mjs` — 55 checks PASS; `node scripts/verify-s25.mjs`
  — 3066 checks PASS; full `pnpm verify` — exit 0;
  `git diff --check origin/main...HEAD` clean.

## Known issue found and fixed during S26

Running `biome check --write` over `apps/desktop-codeoss` descended into
the ignored `.cache/worktrees` tree and reformatted the upstream
`product.json` (tabs → spaces), breaking patch reversibility. Fixed by
excluding `apps/desktop-codeoss/.cache` in `biome.json` `files.includes`;
verified by re-extracting the worktree, re-passing reverse-apply, and
re-running a full-repo `biome check --write` without damage. The cache is
disposable and was regenerated from the digest-verified archive.

## Hosted three-platform evidence (run 33201038521, head 6ad3acc)

All three jobs — `macos-14` (arm64), `ubuntu-24.04` (x64), `windows-latest`
(x64) — succeeded end to end: digest-verified fetch (`f5a0bd67…`), patch
apply/reverse, 14-check static smoke, pinned-toolchain (Node 24.18.0)
`npm install` and compile, runtime launch smoke (the branded app booted,
stayed healthy for 45 seconds and terminated on the smoke's signal — the
Linux orphan list literally showed the `saber-studio` process), platform
packaging of the branded application, digest and upload:

| Artifact | SHA-256 | Size |
|---|---|---|
| saber-studio-dev-vscode-darwin-arm64.tar.gz | `f454906bf43cd9ee40787d369f858f30e3a5214cedbb27491641ceec60976759` | 320,053,204 B |
| saber-studio-dev-vscode-linux-x64.tar.gz | `9e0ff2f83e2b0d7da069d5866b60c942aedb4b91560f831eeecc05c3d8796831` | 344,138,889 B |
| saber-studio-dev-vscode-win32-x64.tar.gz | `e74eb94e0882962af6eb9911e07c7a3114dac2782710baeadd86b17b5638707f` | 352,020,709 B |

Unsigned development builds only (RT-0 engineering preview); no production
signing, update feed or marketplace claim.

CI lessons fixed along the way (each verified by the following run):
missing cache dir before download; `npm.cmd` needs a shell on Windows;
upstream built-in-extension sync needs the job `GITHUB_TOKEN` (anonymous
runners are rate-limited); Linux needs `libkrb5-dev libx11-dev
libxkbfile-dev libsecret-1-dev` + xvfb + `ELECTRON_DISABLE_SANDBOX=1`
(Ubuntu 24.04 restricts unprivileged user namespaces — Chromium's own OS
sandbox, unrelated to the Rust Core authority); the single-instance socket
needs a short `--user-data-dir` (macOS 103-char limit); win32 packaging
spawns `signtool.exe` (locate the SDK binary and put it on PATH); the dev
main opens a window instead of serving `--version`, so the smoke asserts
boot + 45 s health + controlled termination with bounded timeouts; killed
children leave Electron grandchildren holding the stdout pipe, so teardown
kills the direct child and its process group and destroys the pipes; and
the digest step must not set its found-flag inside a pipeline subshell.

## What is NOT done (honest pending)

- Patch 0002 (Desktop Agent Workbench as the default startup view) is
  designed, deliberately unwritten. It is the last product Exit-Gate item;
  after it lands, the smoke must assert the default route.
- A formal Saber-side license/notice emission step for each artifact (the
  packaged app ships upstream `LICENSE.txt` and `ThirdPartyNotices.txt`;
  a Saber notice manifest is still to be generated and digested).
- The full hosted PR check set (repository-verification, monorepo
  three-platform, dependency-audit) on the final branch head, then
  protected merge and the `s26-complete` tag.
- Local full Electron build remains blocked by this machine's Xcode
  14.3.1 (native-keymap fails on `<source_location>`); hosted runners
  with Xcode 15+ carried the evidence instead. A local Xcode upgrade
  would need explicit user authorization.

## Next exact commands

```sh
# 0. PR #71 remains the open S26 review branch — continue pushing to it
# 1. write patches/0002-workbench-default-route.patch + its smoke assertion
# 2. rerun the hosted matrix (concurrency cancels the superseded run):
git push origin segment/S26-codeoss-bootstrap
# 3. after the matrix is green with the default route asserted: final-hosted
#    checks, completion record, protected merge, then s26-complete
```

## Stop rule

Do not start S27 (Core supervision transport). S26 stays `in_progress`
until the three-platform builds, runtime smoke, hosted checks and protected
merge are real; only then record completion and tag `s26-complete`.

## Non-negotiable review points

- Renderer/extension/webview paths hold no file, shell, secret, network or
  policy authority; the skeleton requires nothing beyond the `vscode` API.
- No screenshot, static HTML or Web Supervisor claims desktop completion.
- The upstream lock, digests and patch provenance are the reproducibility
  root; never hand-edit the cache to make a patch fit.
