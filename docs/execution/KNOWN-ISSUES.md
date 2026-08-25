# Known Issues

## KI-0001 — Git remote was missing

- Status: resolved 2026-08-25
- Evidence: private `SunArthurX/saber-harness` repository and matching Segment branch SHA
- Resolution: authenticated GitHub identity and private visibility were selected in DEC-0003

## KI-0002 — Distribution license requires a future product decision

- Severity: release blocker, not S00 blocker
- Current control: publicly readable but proprietary posture recorded in `LICENSE`
- Impact: repository must not be made public or distributed under a different license without an explicit decision
- Owner: repository owner
- Resolution: before public or third-party distribution, choose proprietary, source-available, or an approved open-source license

## KI-0003 — CI provider was undecided

- Status: resolved 2026-08-25
- Resolution: GitHub Actions selected for the S00 baseline in DEC-0003

## KI-0004 — Private main protection is unavailable on the current GitHub plan

- Status: resolved 2026-08-25 by explicit owner-approved public visibility
- Evidence: GitHub REST API returned HTTP 403 for both branch protection and repository Rulesets
- Provider response: upgrade to GitHub Pro or make the repository public
- Safety decision: do not expose private research to bypass a platform entitlement
- Compensating controls: private visibility, CODEOWNERS, squash-only merge setting, passing PR CI, main-provenance detection workflow, explicit no-force-push repository instructions
- Resolution: pre-publication history scan passed, repository visibility changed to public, and `node scripts/configure-main-protection.mjs --apply` succeeded
- Completion evidence: `node scripts/verify-remote-s00.mjs` exited 0 and proved required PR, `repository-verification`, admin enforcement, linear history, conversation resolution, no force push, and no deletion on `main`
