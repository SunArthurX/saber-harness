# Data Classification and Handling v1

Status: accepted baseline for S01

Classification follows the data through events, blobs, indexes, model context, logs, exports and backups. Derived data such as embeddings and summaries inherit at least the source classification unless a reviewed transformation explicitly lowers it.

| Class | Examples | Local storage | Model/egress | Logging and sync |
|---|---|---|---|---|
| `public` | published documentation, public source | integrity protected | allowed by policy | content may be logged only when necessary; E2EE optional |
| `internal` | ordinary project plans, non-public metadata | encrypted at rest | approved providers and purposes | redact excess content; E2EE sync by default |
| `confidential` | proprietary source, private conversations, customer data | SQLCipher/encrypted blob with workspace key | explicit scoped approval and allowlisted processor | metadata-minimized logs; E2EE required |
| `restricted` | credentials, regulated identifiers, security incidents, signing material references | dedicated secret/key store or encrypted quarantine | deny by default; use references/out-of-band injection | never log plaintext; tightly scoped backup/export |

## Mandatory labels

Every persisted or transmitted content object records:

- `classification` and classifier actor/version;
- tenant, workspace and owner scope;
- provenance and source trust;
- retention/deletion/legal-hold state;
- permitted processing purpose and egress constraints;
- derived-from references when content is transformed.

## Special data types

- Secrets: never become ordinary facts or model context. Store only `credential_ref`, scope and audit metadata outside the Secret Broker.
- Embeddings: sensitive derived data; default local and inherit source access control.
- Imported conversations: start as `confidential` and `untrusted` unless source and owner policy establish otherwise.
- Audit: store hashes and minimal metadata by default; content access requires a separate authorization path.
- Telemetry: off or minimal by default, content-free, documented and provably disableable.
- Public repository content: public classification does not imply an open-source license or unrestricted reuse rights.

## Declassification

Declassification requires an explicit transformation record, DLP result, owner/policy approval, new object/hash and retained provenance. Redaction never mutates the original audit fact silently.
