# S36 Handoff — Packaging and Update

Status: in progress — the complete packaging/update contract is
implemented and tested (22 pure tests + the real digest-producing
package driver and offline verifier); the protected PR, hosted
checks, completion record and s36-complete tag remain
Date: 2026-08-29
Branch: `segment/S36-packaging-update`
Base main: `066c7324fd64c25ad0af9c76403f494f906cd3d5` (`s35-complete`)
Runbook: `docs/execution/desktop/S36-PACKAGING-UPDATE.md`

## What landed

- **packageDefinition** — three platform definitions (macOS hardened
  runtime + notarization, Windows Authenticode per-user, Linux
  deb/archive) with app id, locations, URL scheme, associations and
  uninstall retention; explicit parity states; CI/KMS/HSM-only
  signing; dev/prod identity separation; complete provenance with
  offline verification.
- **updateChannels** — four monotonic rings; client chain rejects
  freeze/rollback/wrong channel/platform/expired; rollback without
  silent data downgrade; active-run reconciliation; E7-governed
  updater trust.
- **storeMigration** — five recorded phases with atomic commits;
  crash recovery at every phase never guesses; incompatible
  downgrades refused; one migration truth across surfaces.
- **updateRecovery** — six kill phases x six fault conditions with no
  silent corruption or unsigned execution; complete offline bundles;
  non-secret silent install; signed distribution policy; protective
  uninstall.
- **Scripts** — `package-desktop.mjs` emits real SHA-256 digests,
  deterministic SBOM and provenance; `verify-offline-bundle.mjs`
  re-verifies on clean-machine terms.
- **Evidence**: 22 tests across three suites; verify-s36 (77 checks)
  in local and hosted gates.

## Honest limits

Real OS installers (dmg/notarization, Authenticode, deb) are built by
the hosted release pipeline with CI/KMS-held keys; this repo carries
the verifiable metadata layer and fixture signatures.

## Next actions

1. Push, open the protected PR, wait for the five checks.
2. Squash-merge; completion record; annotated `s36-complete`.
3. S37 starts only from
   `docs/execution/desktop/S37-QUALITY-SECURITY-GATE.md`.
