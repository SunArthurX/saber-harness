# Trust Boundaries and Control Ownership v1

Status: accepted baseline for S01

## Boundary map

| Boundary | Trusted side | Untrusted or lower-trust side | Mandatory enforcement |
|---|---|---|---|
| TB-01 Experience → Trusted Runtime | Rust Core API/PEP | Desktop renderer, CLI input, IDE extensions | versioned schema, actor identity, size/deadline, policy |
| TB-02 Intelligence → Host | Tool Broker/Sandbox supervisor | Agent Host, models, generated commands | capability decision, isolation, resource budget, typed result |
| TB-03 Secret use | Secret Broker and OS/KMS store | model, prompt, plugin, stdout/stderr | reference-only API, short-lived injection, redaction/revocation |
| TB-04 Network egress | Egress PEP/Gateway | cloud models, MCP, web, SaaS | default deny, destination/purpose allowlist, taint/DLP, redirect/DNS controls |
| TB-05 Knowledge scope | Memory Authority/query planner | importers, indexes, other workspaces/tenants | owner/scope ACL, provenance, single writer, tenant-qualified keys |
| TB-06 Sync | client key manager | ordinary object/manifest service | client-held keys, AEAD, signed manifest, anti-rollback epoch |
| TB-07 Plugin/capability supply chain | signed registry and isolated host | third-party or generated package | digest pin, manifest, SBOM, signature, quarantine, sandbox |
| TB-08 Evolution promotion | protected promotion/release services | candidate generators and self-change agents | ownership/hash binding, independent eval/review, signing separation |
| TB-09 Enterprise control | signed policy/IAM/KMS interfaces | tenant devices and administrators | monotonic policy, least privilege, break-glass record, no default content access |
| TB-10 Build/release | protected reproducible pipeline | runtime/user data and candidate source | isolated credentials, provenance, signed artifacts, staged rollout |

## Trust Cell isolation

Each workspace has an independent identity, key, policy projection, event cursor, capability set, sandbox namespace, budget and health state. Cache keys, queues, temporary directories, indexes and diagnostics are tenant/workspace qualified. A plugin crash, memory poisoning incident, budget breach or Safe Mode in one cell cannot automatically alter another cell.

## Sign-off contract

The S01 pull request is the sign-off object. Merge through protected `main` means the repository owner accepts the listed boundaries and V1 non-goals as the implementation baseline. Future boundary changes require an ADR, threat-model delta, affected requirement/test updates and security review.
