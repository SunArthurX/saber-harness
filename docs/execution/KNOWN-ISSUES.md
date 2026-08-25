# Known Issues

## KI-0001 — Git remote is missing

- Severity: S00 blocker
- Evidence: git remote produces no entries
- Impact: no push, no remote SHA verification, no branch protection, no CI provider
- Owner: repository owner
- Resolution: provide an existing remote URL or specify platform, owner, repository name and visibility

## KI-0002 — License is undecided

- Severity: release blocker, not local bootstrap blocker
- Impact: repository must not be made public or distributed with an assumed license
- Owner: repository owner
- Resolution: choose proprietary/internal, source-available or an approved open-source license

## KI-0003 — CI provider is undecided

- Severity: S00 completion blocker
- Impact: Required checks and protected main cannot be configured
- Owner: repository owner
- Resolution: select hosting/CI platform after remote is known
