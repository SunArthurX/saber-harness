# Platform and Release Matrix

## Support policy

Exact minimum OS versions are frozen in S36 after Code-OSS/Electron upstream
selection and vendor support review. Until then, values below are planning
floors, not customer promises.

| OS | Architecture | Planning floor | Package | Release tier |
|---|---|---|---|---|
| macOS | arm64 | 13+ | signed/notarized app + dmg/zip | production |
| macOS | x64 | 13+ | signed/notarized app + dmg/zip | production while upstream supports |
| Windows | x64 | Windows 10/11 supported editions | signed per-user installer; optional managed machine package | production |
| Linux | x64 | Ubuntu 22.04/24.04 baseline | deb + archive | beta then production decision |
| Linux | arm64 | runner/support dependent | archive/deb candidate | optional |

## Platform behavior matrix

| Boundary | macOS | Windows | Linux |
|---|---|---|---|
| Local Core channel | Unix socket, user runtime dir, 0600 | named pipe, current-user ACL | Unix socket, XDG runtime dir, 0600 |
| Local sandbox | Seatbelt profile | restricted token/ACL/job primitives | bubblewrap/Landlock where supported |
| Credential store | Keychain | Credential Manager/DPAPI-backed store | Secret Service/keyring; fail closed when unavailable |
| Default shell | user-approved shell profile rules | PowerShell/cmd policy mapping | user-approved POSIX shell profile rules |
| PTY | upstream Code-OSS implementation | ConPTY/upstream implementation | upstream Code-OSS implementation |
| Update | signed app/update metadata + notarization | Authenticode + signed update metadata | signed repository/bundle metadata |
| Deep links | registered Saber scheme with validation | registered Saber scheme with validation | desktop scheme/handler with validation |

## Required test workspaces

Every supported OS tests:

- ASCII and non-ASCII user/profile/workspace paths;
- path containing spaces;
- deep path and maximum practical path;
- case-only rename and Unicode normalization fixtures;
- symlink/junction inside and outside Workspace;
- read-only file, locked file and executable bit;
- large file, binary file and Git LFS pointer;
- line-ending conversion and executable permission Diff;
- repository in removable/network-synced location as an explicitly unsupported
  or degraded case until proven safe.

## Process and terminal cases

- shell not found, shell startup error and profile writes output;
- process tree cancellation and orphan child;
- output flood, invalid UTF-8 and ANSI/control sequence injection;
- terminal resize, detached process and app restart;
- command path with spaces/non-ASCII;
- environment redaction and secret-reference resolution;
- platform-specific executable shim behavior.

## Package lifecycle cases

| Case | Required result |
|---|---|
| Fresh install | opens first-run Workbench, no inherited secrets |
| Upgrade N-1→N | settings/data migrate and Run recovery is documented |
| Interrupted download | old version untouched |
| Interrupted swap/install | one verified version remains launchable |
| Interrupted DB migration | old/new/recovery state is deterministic |
| Tampered package/metadata | rejected before execution |
| Downgrade attempt | refused if target/data policy disallows |
| Rollback | verified last-known-good and compatible data |
| Uninstall keep data | binary removed, encrypted profile retained |
| Uninstall remove data | exact scoped removal with recovery warning |
| Offline install | signatures/notices verified without network |

## Release artifacts

Each artifact record contains:

- product/version/channel/platform/architecture;
- Code-OSS and Saber commit;
- Electron/Chromium/Node versions;
- source/archive/patch/lock digests;
- binary/package SHA-256 and size;
- signature identity/timestamp/notarization status;
- SBOM and third-party notices digest;
- update target metadata and rollout ring;
- database/profile compatibility range;
- smoke/acceptance CI URLs.

## Electron hardening checklist

- current supported Electron from the selected Code-OSS baseline;
- `nodeIntegration` disabled for remote/untrusted content;
- context isolation and process sandbox enabled;
- restrictive CSP and no insecure/experimental Blink features;
- permission request handler for every session;
- navigation/new-window/external URL validation;
- IPC sender validation and typed allowlist;
- custom protocol instead of broad `file://` exposure where feasible;
- reviewed Electron fuses;
- no remote code loading in privileged context.

Source: <https://www.electronjs.org/docs/latest/tutorial/security>
