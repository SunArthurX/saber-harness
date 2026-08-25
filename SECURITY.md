# Security Policy

## Reporting

Do not place credentials, private transcripts, exploit details, or other sensitive data in a public issue or pull request.

For this private repository, report a vulnerability through a private GitHub Security Advisory when available. Otherwise contact the repository owner through an authenticated private channel and include only the minimum evidence needed to reproduce the issue.

## Response baseline

1. Classify severity and affected trust boundary.
2. Preserve redacted evidence and event chronology.
3. Contain active exposure without destroying forensic evidence.
4. Fix through a reviewed Segment branch with regression coverage.
5. Rotate exposed credentials outside Git history.
6. Record the incident and update preventive controls.

Never commit live secrets or hidden chain-of-thought as incident evidence.
