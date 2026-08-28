# S26 Runbook — Code-OSS Bootstrap

Status: planned; do not start before S25 protected merge

Release train: RT-0 Foundation Preview — engineering preview, not MVP

Duration: 10-15 working days

Owners: Desktop Tech Lead (A), Build/Release Engineer (R), Extension Engineer
(R), Security and Legal reviewers (C), SDET (R)

Risk: high

## Outcome

A clean machine can fetch a cryptographically pinned Code-OSS source baseline,
apply Saber-owned patches, build and launch branded development packages on
macOS, Windows and Linux. The application opens the Desktop Agent Workbench by
default with native Explorer, Editor, SCM and Terminal present. It does not yet
connect to the real Core and makes no claim of Agent execution.

## Competitive-derived requirements

- `CDX-01`, `CLD-01`, `ZCD-01`: bootstrap must preserve a full desktop
  workbench and extension/pane contribution path, not a single chat Webview.
- Branding and startup tests must leave room for the future Project/Task tree,
  Pane Layout Manager and native Editor/SCM/Terminal surfaces.
- These references guide shell capability only; no competitor UI, assets or
  proprietary behavior is copied.

## Preconditions

- S25 is merged and tagged; `origin/main` contains ADR-028 and this runbook.
- License owner approves Code-OSS MIT redistribution approach, third-party
  notice generation and Saber trademark assets.
- No production signing identity is needed; development ad-hoc packages only.
- Network access is available for the first upstream fetch.

Preflight:

```sh
git status --short --branch
git fetch --tags origin
git rev-parse 's25-complete^{}'
node scripts/verify-s25.mjs
pnpm verify
```

## Scope

In scope: upstream lock, fetch/verify cache, minimal patch stack, product
configuration, built-in extension skeleton, development packaging, license
inventory, three-platform smoke and focused verification.

Out of scope: real Core IPC, Agent conversation, execution, model providers,
production signing, automatic update, Marketplace access and user migration.

## Planned layout

```text
apps/desktop-codeoss/
├── README.md
├── upstream.lock.json
├── product/
│   ├── product.json
│   ├── icons/
│   └── quality.json
├── patches/
│   ├── series.json
│   └── *.patch
├── extensions/saber-agent/
│   ├── package.json
│   ├── src/extension.ts
│   └── test/
└── scripts/
    ├── fetch-upstream.mjs
    ├── apply-patches.mjs
    ├── build.mjs
    └── smoke.mjs
scripts/verify-s26.mjs
```

Upstream source and build output stay under ignored cache/output directories;
do not commit an extracted Code-OSS tree or unreviewed binaries.

## Advanced harness and philosophy requirements

- No advanced harness capability is implemented in S26. The shell must preserve
  `PHL-02` replaceable-brain and `PHL-04` immune-Core boundaries so later
  adapters, Runtime Realms and causal replay do not require Renderer authority.
- Built-in extension and product branding are projections. They cannot own Goal
  identity, secrets, provider credentials, Policy verdicts or execution state.

## Work packages

### S26-WP01 — Upstream decision and legal inventory

1. Review the official distinction between Code-OSS source and Microsoft's
   Visual Studio Code distribution.
2. Select a released upstream ref, resolve it to a full Git commit and record
   selection rationale, release date and supported Electron/Node versions.
3. Record source URL, commit, archive SHA-256, MIT license path and third-party
   notice inputs in `upstream.lock.json`.
4. Record why Visual Studio Marketplace branding/services are excluded unless a
   separate written agreement exists.
5. Add an ADR only if the fork/storage strategy changes ADR-028.

Evidence: approved lock review, legal checklist and digest recomputation.

### S26-WP02 — Reproducible source cache

1. Implement fetch into an ignored, commit-addressed cache.
2. Download to a temporary path, verify the archive digest, then atomically
   promote it; interrupted fetches cannot become accepted sources.
3. Refuse symbolic refs, missing digest, digest mismatch, dirty source and
   unexpected origin.
4. Support an offline cache verification mode that performs no network access.
5. Never run upstream post-install scripts before source verification.

Planned commands:

```sh
pnpm desktop:upstream:fetch
pnpm desktop:upstream:verify
pnpm desktop:upstream:verify --offline
```

### S26-WP03 — Minimal product patch stack

1. Keep each patch single-purpose and list it in `patches/series.json` with
   owner, rationale, upstream files, security impact and expected base SHA.
2. Add product name, application IDs, data directories, URL scheme, development
   quality channel and icons without using Microsoft marks.
3. Disable or redirect Microsoft-specific services not licensed for the Saber
   distribution.
4. Set the default welcome target to the Desktop Agent Workbench container.
5. Add patch apply and reverse checks; patch fuzz is a failure.

Rollback: discard the generated worktree and rebuild from the locked upstream;
never hand-edit the cache to make a patch apply.

### S26-WP04 — Built-in extension skeleton

1. Add a built-in `saber-agent` extension with no Node host effects beyond the
   normal Code-OSS extension contract.
2. Contribute one Activity Bar container, a native Tree View placeholder, a
   Workbench editor placeholder and commands with stable `saber.*` IDs.
3. Use native Tree/Welcome/Command contributions before Webviews. A Webview may
   render the future conversation surface but has strict CSP, no remote script,
   no Node integration and an explicit message allowlist.
4. Provide Chinese and English display strings and accessible names.
5. Verify extension activation does not open marketing content or steal focus.

### S26-WP05 — Build and development package

1. Read Node/npm versions from the locked upstream rather than using the Saber
   monorepo Node version blindly.
2. Use upstream-supported build tasks through reviewed wrappers.
3. Produce development artifacts for macOS arm64/x64, Windows x64 and Linux x64;
   record arm64 Linux as optional until a runner exists.
4. Generate dependency license and notice output for each artifact.
5. Record artifact digest, size, embedded Electron/Chromium/Node versions and
   source commit.

### S26-WP06 — Smoke, Gate and evidence

Automated smoke must prove:

- process starts and exits cleanly;
- product name and application data directory are Saber-owned;
- an empty window and a real repository both open;
- Explorer, Editor, SCM and Terminal commands are registered;
- Desktop Agent Workbench is the default Saber view;
- the Web supervisor is not required or launched;
- no production service, update or telemetry endpoint is contacted;
- no secret or user source file enters build logs.

## Platform cases

| Platform | Required S26 evidence |
|---|---|
| macOS 13+ arm64 | app launches without quarantine bypass; ad-hoc dev signature recorded |
| macOS x64 | build or documented cross-architecture artifact smoke |
| Windows 10/11 x64 | unpacked/installer-dev launch, long path and non-ASCII workspace |
| Ubuntu 22.04/24.04 x64 | X11 or Wayland smoke, terminal allocation and desktop entry |

## Verification

```sh
node scripts/verify-s26.mjs
pnpm desktop:upstream:verify --offline
pnpm desktop:build
pnpm desktop:smoke
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- Exact upstream commit and archive digest are independently recomputed.
- Patch application is deterministic and reversible.
- Three required OS jobs build and launch the branded development package.
- Workbench default and native IDE surfaces are asserted by smoke tests.
- License/notice output exists and contains no Microsoft distribution claim.
- No Core, Agent or production-package claim appears in UI or documentation.

## Handoff to S27

Provide artifact digests, upstream lock, patch manifest, build commands, known
upstream conflicts and exact executable discovery rules. S27 may connect a real
Core only after S26 protected merge.

Official implementation references:

- <https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code>
- <https://github.com/microsoft/vscode/wiki/How-to-Contribute>
- <https://www.electronjs.org/docs/latest/tutorial/security>
