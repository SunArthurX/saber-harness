# S36 Runbook — Packaging and Update

Status: planned

Release train: RT-3 Enterprise Production Candidate

Duration: 10-15 working days

Owners: Release Engineering Lead (A), Desktop/Build/Data Engineers (R),
Supply-chain Security and SDET (R)

Risk: critical

## Outcome

Reproducible, signed Saber Studio packages install, upgrade, migrate, recover,
roll back and uninstall across supported platforms. Update trust cannot be
disabled by Renderer, extension, Agent or remote content.

## Competitive-derived requirements

- `CDX-02`, `CLD-05`, `ZCD-07`: packages preserve Local/Worktree/Remote
  capability semantics across supported platforms and upgrades.
- Update migration covers pane layouts, adapter registrations, schedules,
  Memory/evolution lineage and Remote device grants without silently expanding
  permissions.
- Platform parity gaps are explicit product states; no unsupported architecture
  is advertised because another product happens to support it.

## Advanced harness and philosophy requirements

- `CUR-04`: a desktop update cannot orphan or silently terminate an active
  background Run; status, takeover and compatibility are reconciled explicitly.
- `KIR-03`: Desktop, CLI and optional Web Supervisor use compatible Core and
  repository configuration migrations without creating three policy truths.
- Packaging and updater changes remain E7-governed: the active Agent cannot
  rewrite signing, rollback, migration or Recovery trust roots.

## Work packages

### S36-WP01 — Package definitions

| Platform | Production candidates |
|---|---|
| macOS | universal or arm64/x64 `.dmg`/`.zip`, hardened runtime, notarization |
| Windows | x64 installer, Authenticode, per-user default, enterprise machine option |
| Linux | x64 `.deb` and archive; optional rpm/AppImage only after support decision |

Record application ID, install/data/cache/log locations, URL scheme,
file associations, uninstall retention and system requirements.

### S36-WP02 — Signing and provenance

- Signing keys live in approved CI secret/KMS/HSM, never repository or developer
  scripts.
- Every artifact has SHA-256, SBOM, source/lock commit, patch manifest, build
  environment, signer and provenance statement.
- Verify signatures on a clean offline machine before publication.
- Development and production channels use distinct identities and endpoints.

### S36-WP03 — Update channels and rings

- Channels: internal, canary, beta and stable with monotonic target metadata.
- Client verifies full target chain before install and rejects freeze, rollback,
  wrong channel, wrong platform and expired metadata.
- Rollout supports pause/demote and last-known-good without silently downgrading
  data compatibility.
- Update UI displays version, security urgency, size, restart and rollback risk.

### S36-WP04 — Database/profile migration

- Version every authoritative store and non-authoritative desktop profile.
- Preflight free space, backup/checkpoint, migration, integrity verify and
  atomic version commit.
- Crash at every migration phase must reopen old, complete new or enter explicit
  recovery; never guess.
- Downgrade with incompatible data is refused or uses an approved export path.

### S36-WP05 — Install/update recovery matrix

Inject power/process kill during download, verify, unpack, swap, migration and
first launch. Test disk full, antivirus lock, proxy interruption, expired cert,
clock skew and previous version currently running.

### S36-WP06 — Offline and enterprise distribution

- Offline bundle contains package, signature, trust metadata, SBOM, notices and
  verification tool/instructions.
- Enterprise deployment supports silent install settings only for documented
  non-secret options.
- Proxy, custom update mirror and air-gap are signed-policy controlled.
- Uninstall asks whether encrypted user data remains; default protects against
  accidental deletion and documents secure erase limitations.

## Verification

```sh
node scripts/verify-s36.mjs
pnpm desktop:package
pnpm desktop:test:install-matrix
pnpm desktop:test:update-rollback
pnpm desktop:test:migrations
pnpm desktop:verify:offline-bundle
pnpm verify
git diff --check origin/main...HEAD
```

## Exit Gate

- All required architecture/OS packages verify and launch.
- Install, update and migration failure injection never produces silent
  corruption or unsigned execution.
- Rollback/demotion returns to a compatible last-known-good version.
- SBOM, notices, signature and provenance reconcile with every artifact digest.
