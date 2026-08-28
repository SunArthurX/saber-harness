# S26 Upstream and Supply-Chain Record

Status: S26 in progress — WP01/WP02/WP03/WP04 partially proven locally; the
full Electron compile, three-platform packages and runtime launch smoke have
not run yet and are not claimed.

This file is the reviewable record required before touching the product
shell (S26 runbook §七 / GLM-5.3 prompt §七). Facts come from the pinned
commit itself, not from memory.

## 1. Upstream selection

| Field | Value |
|---|---|
| Repository | https://github.com/microsoft/vscode |
| Ref | `1.135.0` (latest monthly stable at S26 start) |
| Resolved commit | `08d4889f9ec4a1685d257b9b95de036c8e1ce1e5` |
| Commit date | 2026-08-25T14:26:52Z (release published 2026-08-26T16:52:46Z) |
| Archive | codeload tarball at the immutable commit, 52,159,992 bytes |
| SHA-256 | `f5a0bd67cf04080b59e316cc4e39e0fa2aedf16da15be955c85141fe9febe525` |

Rationale: newest monthly stable, two days old at lock time; monthly stable
releases accumulate security fixes and match the documented Electron/Node
toolchain, while `main`/insider move and cannot be pinned reproducibly. The
tag resolves directly to a commit object, so the archive address is the
immutable full SHA — symbolic refs are refused by `fetch-upstream.mjs`.

## 2. License and redistribution checklist

- Upstream license: MIT (`LICENSE.txt` at the pinned commit; verified
  first line "MIT License … Microsoft Corporation"). Saber redistributes
  under MIT obligations: preserve copyright notice and license text in
  derivative packages (S26-WP05 emits third-party notices; pending).
- Code-OSS source ≠ Microsoft's Visual Studio Code product: the OSS
  `product.json` at this commit ships **without** `extensionsGallery`,
  `configurationStorageSyncUrl` and `quality` — verified by reading the
  pinned file, not by assumption.
- Microsoft service/marketplace exclusion: nothing in the Saber patch adds
  a Microsoft endpoint. A future extension gallery (Open VSX or governed
  private registry) is a later-segment decision requiring legal review.
- Trademark: patch 0001 removes Microsoft marks from shipped identity
  fields (`win32DirName`, `win32NameVersion`, `win32AppUserModelId`,
  `darwinBundleIdentifier`, shell names). Saber does not redistribute
  "Visual Studio", "VS Code" or the Microsoft logo as product branding.
- Saber-side code stays `UNLICENSED`/proprietary per repository posture;
  the MIT terms apply to the upstream-derived shell only.
- Icons: an original Saber shield SVG (stroke geometry authored for this
  repository) is used; no upstream or Microsoft brand assets are reused.

## 3. `upstream.lock.json` schema

Committed at `apps/desktop-codeoss/upstream.lock.json`, schema_version 1:
`source` (repository, ref, commit, commit_date, archive_url, archive_sha256,
archive_bytes, license, selection_rationale), `toolchain` (node pinned from
upstream `.nvmrc` = 24.18.0, npm bundled, python via system for node-gyp),
`patches[]` (id, file, owner, rationale, upstream_files, security_impact,
expected_base_commit), `exclusions` (gallery/telemetry/update/trademark
positions), `cache` (paths + atomic-promotion policy). Digest
recomputation: `pnpm desktop:upstream:verify [--offline]`.

## 4. Cache, offline and upstream-unavailable policy

Cache root `apps/desktop-codeoss/.cache/` (gitignored). Downloads land at
`upstream/<commit>.tar.gz.tmp-<pid>`; only after the SHA-256 matches the
lock does an atomic rename promote them. Interrupted fetches and digest
mismatches delete the temporary file and exit non-zero — a partial or
wrong archive can never become a build input. `--offline` verifies the
existing cache and performs no network access. When the upstream or the
network is unavailable: reuse a previously verified cache; if absent, the
build stops (no mirror fallback is implemented; a reviewed mirror list
would be a lock schema change). Saber tooling never executes anything from
the archive; upstream install scripts run only later inside the reviewed
upstream build step itself.

## 5. Patch series strategy

`patches/series.json` orders single-purpose patches; `upstream.lock.json`
carries the same ids with owner, rationale, touched files, security impact
and expected base commit (verified equal to the locked commit).
`apply-patches.mjs` applies with `git apply` (fuzz fails), proves each
patch reverses, is idempotent on an already-patched worktree, and on any
failure deletes the worktree — the cache is never hand-edited to make a
patch fit. Current series: `0001-product-identity` (product.json identity
fields only). Designed but deliberately unwritten: `0002` making the
Desktop Agent Workbench the default startup view — lands after the
three-platform build baseline exists, per the runbook's incremental gate.

## 6. Toolchain matrix

| Layer | Version | Source |
|---|---|---|
| Upstream Node | 24.18.0 | `.nvmrc` at the pinned commit |
| Saber monorepo Node | 24.15.0 | repository engines (kept separate on purpose) |
| npm | bundled with Node 24.18.0 | upstream build expects its own npm |
| Python | 3.9+ system | node-gyp native modules |
| Rust | workspace toolchain | Saber Core builds independently |
| macOS | 13+ arm64/x64, Xcode CLT | PLATFORM-AND-RELEASE-MATRIX |
| Windows | 10/11 x64, VS Build Tools | same matrix |
| Linux | Ubuntu 22.04/24.04 x64 | same matrix |

`build.mjs` reads the lock (never the monorepo default), verifies the
exact Node via `SABER_DESKTOP_NODE` or PATH, and fails closed with exit 64
on mismatch — verified both ways locally (mismatch message observed; pinned
24.18.0 toolchain in the cache passed preflight).

## 7. Platform packaging and clean-machine smoke plan

Development artifacts planned for macOS arm64/x64, Windows x64, Linux x64
(Linux arm64 optional until a runner exists). Smoke journey (static half
implemented in `smoke.mjs`, 14 checks, all passing on the real patched
tree): branding, `.saber-studio` data-directory isolation, `saber://`
protocol, no Microsoft marks in identity fields, no gallery endpoint,
built-in extension present with `saber.*` commands, no webview, zh-CN
strings, honest unconnected copy. Runtime half (pending WP05/WP06): launch
each packaged app headlessly, assert process start/exit, empty window and
real repository open, Explorer/Editor/SCM/Terminal commands registered,
Saber view present, Web Supervisor not launched, no production endpoint
contacted, no secret/user source in logs.

## 8. Workbench route, Pane contributions and recovery

The built-in `saber-agent` extension contributes an activity-bar container
(`saber-workbench`), a native tree view with a welcome message, and a
read-only placeholder document for the workbench surface via
TextDocumentContentProvider — native contribution points first, no
webview, no second front-end framework. Recovery model: the extension is
stateless; killing the renderer or reloading the window loses nothing
because Goal/Task/Run state lives only in the Core (S27 transport). The
default-startup-view patch (0002) is designed, not yet written (see §5).

## 9. Projection, not authority

Workspace/Goal/Task/Run/Realm objects shown by the shell are projections
owned by the trusted Rust Core (ADR-013/ADR-028). The extension holds no
identity of its own: no ids are minted locally, the tree view renders an
honest "not connected" placeholder, commands only open local read-only
surfaces. No file, shell, secret, network or policy authority exists in
the skeleton; `verify-s26.mjs` asserts the manifest contributes no webview
and the source requires nothing beyond `vscode`.

## 10. Risk register

| Risk | Position |
|---|---|
| Upstream drift (monthly releases) | lock pins one immutable commit; upgrades are a reviewed lock change plus patch rebase |
| Archive host unavailable | verified cache reuse; no silent mirror fallback (documented, unimplemented) |
| Digest mismatch / tampered mirror | fail closed, temporary deleted, never promoted |
| Patch conflicts on upgrade | `git apply` refuses fuzz; worktree discarded; rebase is manual review |
| License/notice gaps | third-party notice emission is WP05 evidence; not yet produced |
| Disk/time budget | cache ≈ 52 MB archive, ≈ 1 GB extracted worktree, node toolchain ≈ 100 MB unpacked; full Electron builds are 30-60+ min per platform (CI cache strategy TBD by WP05) |
| Wrong local toolchain | build.mjs fails closed (exit 64) until Node 24.18.0 is provided |
| Renderer/extension over-reach | no webview, no node builtins in extension code; verifier enforces |
| Legal identity unknowns | production signing/notarization/update URLs/Saber legal entity are TBD-BY-SEGMENT (S36); nothing invented here |

Blockers/TBD-BY-SEGMENT: production signing identity, notarization
account, update feed, telemetry endpoint, marketplace entitlement, Saber
legal entity — all explicitly out of S26 scope; none are fabricated.
