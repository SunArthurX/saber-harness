//! Canonical Agent Exchange with recomputable evidence (ADR-014).

pub mod importer;
pub mod library;
pub mod record;

pub use importer::{ImportScope, import_jsonl_transcript, import_markdown_transcript};
pub use library::{
    CaxLibrary, ImportOutcome, ImportTombstone, LibraryError, admit_into_fabric,
    contents_appear_in_raw, fabric_admissions_for, source_format,
};
pub use record::{
    CAX_SCHEMA_VERSION, CaxEntry, CaxError, CaxRecord, CaxSession, CaxSource, EntryRole,
    SourceFormat, entry_digest_of, raw_digest_of, record_digest_of, record_id_for,
};

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use saber_context_engine::{KnowledgeFabric, QueryRequest, ScopeKey, ScopeKind};

    use super::*;

    const RAW_JSONL: &str = concat!(
        "{\"role\":\"user\",\"content\":\"deploy the service\",\"timestamp_ms\":1000,\"agent\":\"codex\",\"session\":\"s1\"}\n",
        "{\"role\":\"assistant\",\"content\":\"deployed to staging\"}\n",
        "{\"role\":\"tool\",\"content\":\"exit code 0\"}\n"
    );

    const RAW_MD: &str =
        "**User:** please run the tests\nhere they are\n**Assistant:** all green\n";

    fn scope() -> ImportScope {
        ImportScope {
            tenant: "tenant_a".to_owned(),
            workspace: "ws_01".to_owned(),
        }
    }

    #[test]
    fn jsonl_import_builds_a_valid_hash_chain() {
        let record = import_jsonl_transcript(
            &scope(),
            "file:///transcripts/t.jsonl",
            RAW_JSONL.as_bytes(),
        )
        .unwrap();
        assert_eq!(record.schema_version, CAX_SCHEMA_VERSION);
        assert_eq!(record.entries.len(), 3);
        assert_eq!(record.session.agent.as_deref(), Some("codex"));
        assert_eq!(record.source.format, SourceFormat::JsonlTranscript);
        assert_eq!(
            record.source.raw_digest,
            raw_digest_of(RAW_JSONL.as_bytes())
        );
        record.validate().unwrap();
    }

    #[test]
    fn markdown_import_parses_turns_verbatim() {
        let record =
            import_markdown_transcript(&scope(), "file:///transcripts/t.md", RAW_MD.as_bytes())
                .unwrap();
        assert_eq!(record.entries.len(), 2);
        assert_eq!(record.entries[0].role, EntryRole::User);
        assert_eq!(
            record.entries[0].content,
            "please run the tests\nhere they are"
        );
        assert_eq!(record.entries[1].role, EntryRole::Assistant);
        assert_eq!(record.entries[1].content, "all green");
        record.validate().unwrap();
    }

    #[test]
    fn tampered_record_or_source_fails_closed() {
        let record =
            import_jsonl_transcript(&scope(), "file:///t.jsonl", RAW_JSONL.as_bytes()).unwrap();
        // Tamper with an entry content under the stored digest.
        let mut tampered = record.clone();
        tampered.entries[0].content = "deploy the PRODUCTION service".to_owned();
        assert_eq!(tampered.validate(), Err(CaxError::DigestMismatch));
        // Tamper with the record digest itself.
        let mut bad_digest = record.clone();
        bad_digest.record_digest = format!("sha256:{}", "0".repeat(64));
        assert_eq!(bad_digest.validate(), Err(CaxError::DigestMismatch));
        // Unknown schema version.
        let mut future = record;
        future.schema_version = "999.0.0".to_owned();
        assert_eq!(future.validate(), Err(CaxError::UnknownVersion));
    }

    #[test]
    fn importer_cannot_invent_content_absent_from_raw() {
        let record =
            import_jsonl_transcript(&scope(), "file:///t.jsonl", RAW_JSONL.as_bytes()).unwrap();
        assert!(contents_appear_in_raw(&record, RAW_JSONL.as_bytes()));
        // Same record against a different raw source: verbatim check fails.
        assert!(!contents_appear_in_raw(
            &record,
            "totally different transcript".as_bytes()
        ));
        // A fabricated entry cannot carry a matching digest.
        let mut invented = record.clone();
        invented.entries[0].content = "content that never existed".to_owned();
        invented.entries[0].content_digest = entry_digest_of(&invented.entries[0].content);
        // Even with a consistent per-entry digest, the record digest breaks.
        assert_eq!(invented.validate(), Err(CaxError::DigestMismatch));
    }

    #[test]
    fn reimport_is_idempotent_and_evolution_creates_new_records() {
        let mut library = CaxLibrary::default();
        let first =
            import_jsonl_transcript(&scope(), "file:///t.jsonl", RAW_JSONL.as_bytes()).unwrap();
        let first_id = first.record_id.clone();
        match library.import("tenant_a", "ws_01", first).unwrap() {
            ImportOutcome::Created(record) => assert_eq!(record.record_id, first_id),
            ImportOutcome::Existing(record) => panic!("expected creation, got {record:?}"),
        }
        // Exact re-import: existing record, no duplicate.
        let replay =
            import_jsonl_transcript(&scope(), "file:///t.jsonl", RAW_JSONL.as_bytes()).unwrap();
        match library.import("tenant_a", "ws_01", replay).unwrap() {
            ImportOutcome::Existing(record) => assert_eq!(record.record_id, first_id),
            ImportOutcome::Created(record) => panic!("expected idempotency, got {record:?}"),
        }
        assert_eq!(library.records().count(), 1);

        // Evolved source: distinct digest, distinct record.
        let evolved_raw =
            format!("{RAW_JSONL}{{\"role\":\"user\",\"content\":\"and verify it\"}}\n");
        let evolved =
            import_jsonl_transcript(&scope(), "file:///t.jsonl", evolved_raw.as_bytes()).unwrap();
        match library.import("tenant_a", "ws_01", evolved).unwrap() {
            ImportOutcome::Created(record) => assert_ne!(record.record_id, first_id),
            ImportOutcome::Existing(record) => panic!("expected a new record, got {record:?}"),
        }
        assert_eq!(library.records().count(), 2);
    }

    #[test]
    fn revocation_removes_records_and_preserves_provenance() {
        let mut library = CaxLibrary::default();
        let record =
            import_markdown_transcript(&scope(), "file:///t.md", RAW_MD.as_bytes()).unwrap();
        let record_id = record.record_id.clone();
        library.import("tenant_a", "ws_01", record).unwrap();
        let tombstone = library.revoke(&record_id).unwrap();
        assert_eq!(tombstone.record_id, record_id);
        assert_eq!(tombstone.origin_uri, "file:///t.md");
        assert!(library.get(&record_id).is_none());
        assert_eq!(library.records().count(), 0);
        assert_eq!(library.tombstones().count(), 1, "audit provenance survives");
        // Re-importing the revoked source stays revoked.
        let replay =
            import_markdown_transcript(&scope(), "file:///t.md", RAW_MD.as_bytes()).unwrap();
        assert!(library.import("tenant_a", "ws_01", replay).is_err());
    }

    #[test]
    fn cross_workspace_injection_is_denied() {
        let mut library = CaxLibrary::default();
        let foreign =
            import_jsonl_transcript(&scope(), "file:///t.jsonl", RAW_JSONL.as_bytes()).unwrap();
        // Library owns ws_02; the record claims ws_01.
        assert_eq!(
            library.import("tenant_a", "ws_02", foreign),
            Err(LibraryError::Invalid(CaxError::CrossWorkspace))
        );
    }

    #[test]
    fn imported_records_admit_into_the_fabric_as_untrusted() {
        let record =
            import_jsonl_transcript(&scope(), "file:///t.jsonl", RAW_JSONL.as_bytes()).unwrap();
        let mut fabric = KnowledgeFabric::default();
        let ids = admit_into_fabric(&mut fabric, &record).unwrap();
        assert_eq!(ids.len(), 3);

        // Untrusted content requires explicit admission in queries.
        let mut request = QueryRequest {
            scope: ScopeKey {
                tenant: "tenant_a".to_owned(),
                workspace: "ws_01".to_owned(),
                kind: ScopeKind::Conversation,
            },
            sensitivity_ceiling: saber_policy::DataClass::Internal,
            terms: vec!["deploy".to_owned()],
            symbols: Vec::new(),
            key_paths: Vec::new(),
            include_untrusted: false,
            now_ms: 2_000,
            limit: 10,
        };
        let denied = fabric.query(&request, "q_cax_1");
        assert!(denied.selections.is_empty());
        request.include_untrusted = true;
        let admitted = fabric.query(&request, "q_cax_2");
        assert!(!admitted.selections.is_empty());

        // The fabric admission carries untrusted provenance and the CAX
        // entry digest as its content digest.
        for admission in fabric_admissions_for(&record) {
            assert_eq!(
                admission.0.provenance.trust,
                saber_context_engine::TrustLevel::Untrusted
            );
            assert!(admission.0.content_digest.starts_with("sha256:"));
        }
    }

    #[test]
    fn identical_sources_produce_identical_records() {
        let first =
            import_jsonl_transcript(&scope(), "file:///t.jsonl", RAW_JSONL.as_bytes()).unwrap();
        let second =
            import_jsonl_transcript(&scope(), "file:///t.jsonl", RAW_JSONL.as_bytes()).unwrap();
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
    }
}
