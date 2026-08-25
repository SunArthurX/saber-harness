# Known Issues

## KI-0001 — Git remote was missing

- Status: resolved 2026-08-25
- Evidence: private `SunArthurX/saber-harness` repository and matching Segment branch SHA
- Resolution: authenticated GitHub identity and private visibility were selected in DEC-0003

## KI-0002 — Distribution license requires a future product decision

- Severity: release blocker, not S00 blocker
- Current control: private proprietary posture recorded in `LICENSE`
- Impact: repository must not be made public or distributed under a different license without an explicit decision
- Owner: repository owner
- Resolution: before public or third-party distribution, choose proprietary, source-available, or an approved open-source license

## KI-0003 — CI provider was undecided

- Status: resolved 2026-08-25
- Resolution: GitHub Actions selected for the S00 baseline in DEC-0003
