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

## What is NOT done (honest pending)

- `pnpm desktop:build --full`: **attempted and blocked locally**. The pinned
  toolchain (Node 24.18.0 / npm 11.16.0) ran `npm install` inside the
  patched worktree; native module `native-keymap` 3.3.9 fails with
  `fatal error: 'source_location' file not found` — this machine's Xcode
  14.3.1 / Apple clang 14 predates the libc++ that Node 24's V8 headers
  require. Upgrading local Xcode needs explicit user authorization
  (large system change); per the engineering discipline the build evidence
  moves to the hosted matrix (GitHub macOS runners ship Xcode 15+).
- The upstream `npm install` did not complete; no partial install is
  counted as success and the disposable worktree can be re-extracted.
- Three-platform development artifacts (macOS arm64/x64, Windows x64,
  Linux x64) and their digests/license notice output do not exist yet.
- Runtime launch smoke on packaged builds has not run.
- Patch 0002 (Desktop Agent Workbench as the default startup view) is
  designed, deliberately unwritten until the build baseline exists.
- Hosted build matrix wiring, protected merge and the `s26-complete` tag
  are pending. PR #71 stays open as the living S26 review (S25 pattern).

## Next exact commands

```sh
# 0. PR #71 remains the open S26 review branch — continue pushing to it
# 1. preferred: wire the hosted three-platform build matrix (GitHub macOS
#    runners carry Xcode 15+; verify Windows VS Build Tools and Ubuntu
#    toolchains there), producing dev artifacts + digests + license output
# 2. alternative with explicit user authorization: upgrade local Xcode to
#    15+ and retry the local build:
SABER_DESKTOP_NODE=$PWD/apps/desktop-codeoss/.cache/node/node-v24.18.0-darwin-arm64/bin/node \
  pnpm desktop:build --full
# 3. then runtime launch smoke and patch 0002 (default workbench view)
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
