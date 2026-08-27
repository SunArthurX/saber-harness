//! Permission-aware context engine and knowledge mesh (ADR-011).

pub mod fabric;
pub mod label;

pub use fabric::{
    ContextBundle, EventRecord, ExcludedCandidate, ExclusionReason, Explanation, ExplanationItem,
    KnowledgeFabric, QueryRequest, QueryResult, REDACTED_MARKER, SelectedChunk,
};
pub use label::{
    AdmissionError, ChunkContent, FieldSensitivity, FreshnessPolicy, KnowledgeChunk,
    NutritionLabel, Provenance, ScopeKey, ScopeKind, SelectionReason, TrustLevel,
    content_digest_of,
};

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use saber_policy::DataClass;

    use super::*;

    fn scope(workspace: &str) -> ScopeKey {
        ScopeKey {
            tenant: "tenant_a".to_owned(),
            workspace: workspace.to_owned(),
            kind: ScopeKind::Document,
        }
    }

    fn label_for(
        chunk_id: &str,
        workspace: &str,
        sensitivity: DataClass,
        trust: TrustLevel,
    ) -> NutritionLabel {
        NutritionLabel {
            chunk_id: chunk_id.to_owned(),
            scope: scope(workspace),
            sensitivity,
            provenance: Provenance {
                origin: format!("doc://{chunk_id}"),
                trust,
                imported_at_ms: 1_000,
            },
            freshness: FreshnessPolicy {
                created_at_ms: 1_000,
                expires_at_ms: None,
            },
            content_digest: String::new(),
        }
    }

    fn admit_text(
        fabric: &mut KnowledgeFabric,
        chunk_id: &str,
        workspace: &str,
        text: &str,
        sensitivity: DataClass,
        trust: TrustLevel,
    ) -> String {
        let content = ChunkContent::Text {
            text: text.to_owned(),
        };
        let mut label = label_for(chunk_id, workspace, sensitivity, trust);
        label.content_digest = content_digest_of(&content);
        fabric.admit(label, content).unwrap()
    }

    fn query(workspace: &str, terms: &[&str]) -> QueryRequest {
        QueryRequest {
            scope: scope(workspace),
            sensitivity_ceiling: DataClass::Internal,
            terms: terms.iter().map(ToString::to_string).collect(),
            symbols: Vec::new(),
            key_paths: Vec::new(),
            include_untrusted: false,
            now_ms: 2_000,
            limit: 10,
        }
    }

    #[test]
    fn nutrition_labels_are_structural_on_every_chunk() {
        let mut fabric = KnowledgeFabric::default();
        let id = admit_text(
            &mut fabric,
            "chunk_1",
            "ws_01",
            "deploy notes",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        assert_eq!(id, "chunk_1");
        let label = fabric.inspect("chunk_1").unwrap();
        assert_eq!(label.provenance.origin, "doc://chunk_1");
        assert_eq!(label.scope.workspace, "ws_01");
        assert_eq!(label.sensitivity, DataClass::Internal);
    }

    #[test]
    fn unclassified_admission_fails_closed() {
        let mut fabric = KnowledgeFabric::default();
        let content = ChunkContent::Text {
            text: "x".to_owned(),
        };
        // Missing origin.
        let mut label = label_for("chunk_x", "ws_01", DataClass::Internal, TrustLevel::Trusted);
        label.provenance.origin = String::new();
        label.content_digest = content_digest_of(&content);
        assert_eq!(
            fabric.admit(label, content.clone()),
            Err(AdmissionError::Unclassified)
        );
        // Digest manufactured for different content.
        let mut forged = label_for("chunk_y", "ws_01", DataClass::Internal, TrustLevel::Trusted);
        forged.content_digest = format!("sha256:{}", "a".repeat(64));
        assert_eq!(
            fabric.admit(forged, content),
            Err(AdmissionError::DigestMismatch)
        );
    }

    #[test]
    fn forged_labels_are_detected_at_query_time() {
        let mut fabric = KnowledgeFabric::default();
        admit_text(
            &mut fabric,
            "chunk_real",
            "ws_01",
            "real content",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        // Admission rejects a manufactured digest up front...
        let content = ChunkContent::Text {
            text: "swapped".to_owned(),
        };
        let mut forged = label_for(
            "chunk_real",
            "ws_01",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        forged.content_digest = content_digest_of(&ChunkContent::Text {
            text: "real content".to_owned(),
        });
        assert_eq!(
            KnowledgeChunk::admit(forged, content.clone()),
            Err(AdmissionError::DigestMismatch)
        );
        // ...and a content swap under a stale label is caught at query time.
        fabric.tamper_content_for_tests(
            "chunk_real",
            ChunkContent::Text {
                text: "swapped".to_owned(),
            },
        );
        let result = fabric.query(&query("ws_01", &["real"]), "q_forged");
        assert!(result.selections.is_empty());
        assert!(result.exclusions.iter().any(|excluded| {
            excluded.chunk_id == "chunk_real" && excluded.reason == ExclusionReason::LabelForgery
        }));
    }

    #[test]
    fn cross_scope_leakage_is_structurally_zero() {
        let mut fabric = KnowledgeFabric::default();
        admit_text(
            &mut fabric,
            "a_1",
            "ws_01",
            "alpha secret project",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        admit_text(
            &mut fabric,
            "b_1",
            "ws_02",
            "alpha other workspace",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        let result = fabric.query(&query("ws_01", &["alpha"]), "q_3");
        let ids: Vec<&str> = result
            .selections
            .iter()
            .map(|selected| selected.chunk.label.chunk_id.as_str())
            .collect();
        assert_eq!(ids, vec!["a_1"], "foreign chunks are invisible");
        assert!(result.exclusions.iter().any(
            |excluded| excluded.chunk_id == "b_1" && excluded.reason == ExclusionReason::Scope
        ));
    }

    #[test]
    fn sensitivity_ceiling_and_query_time_redaction() {
        let mut fabric = KnowledgeFabric::default();
        admit_text(
            &mut fabric,
            "restricted",
            "ws_01",
            "restricted notes",
            DataClass::Restricted,
            TrustLevel::Trusted,
        );
        let structured = ChunkContent::Structured {
            value: serde_json::json!({
                "issue": "deploy failure",
                "secret_detail": "customer acme lost data",
            }),
            fields: FieldSensitivity {
                restricted_fields: [("secret_detail".to_owned(), DataClass::Confidential)]
                    .into_iter()
                    .collect(),
            },
        };
        let mut label = label_for(
            "structured",
            "ws_01",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        label.content_digest = content_digest_of(&structured);
        fabric.admit(label, structured).unwrap();

        let mut request = query("ws_01", &["deploy", "restricted"]);
        request.sensitivity_ceiling = DataClass::Internal;
        let result = fabric.query(&request, "q_4");
        assert!(
            result
                .exclusions
                .iter()
                .any(|excluded| excluded.chunk_id == "restricted"
                    && excluded.reason == ExclusionReason::Sensitivity)
        );
        let structured_selection = result
            .selections
            .iter()
            .find(|selected| selected.chunk.label.chunk_id == "structured")
            .unwrap();
        assert_eq!(
            structured_selection.redacted_fields,
            vec!["secret_detail".to_owned()]
        );
        assert!(
            structured_selection
                .chunk
                .content
                .text_for_index()
                .contains(REDACTED_MARKER)
        );
        assert!(
            !structured_selection
                .chunk
                .content
                .text_for_index()
                .contains("acme lost data")
        );
    }

    #[test]
    fn hybrid_channels_report_their_reasons() {
        let mut fabric = KnowledgeFabric::default();
        let code = ChunkContent::Code {
            path: "src/deploy.rs".to_owned(),
            language: "rust".to_owned(),
            text: "fn deploy_release() { ship() }".to_owned(),
        };
        let mut label = label_for("code_1", "ws_01", DataClass::Internal, TrustLevel::Trusted);
        label.content_digest = content_digest_of(&code);
        fabric.admit(label, code).unwrap();

        let mut request = query("ws_01", &["deploy"]);
        request.symbols = vec!["deploy_release".to_owned()];
        let result = fabric.query(&request, "q_5");
        let selection = result.selections.first().unwrap();
        assert!(
            matches!(
                selection.reason,
                SelectionReason::KeywordMatch { ref term } if term == "deploy"
            ) || matches!(
                selection.reason,
                SelectionReason::SymbolMatch { ref symbol } if symbol == "deploy_release"
            )
        );

        let mut structured_request = query("ws_01", &[]);
        structured_request.key_paths = vec!["deploy.status".to_owned()];
        let _ = structured_request;
    }

    #[test]
    fn deterministic_selection_and_explanation() {
        let mut fabric = KnowledgeFabric::default();
        admit_text(
            &mut fabric,
            "c_1",
            "ws_01",
            "deploy pipeline",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        admit_text(
            &mut fabric,
            "c_2",
            "ws_01",
            "deploy pipeline rollback",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        let first = fabric.query(&query("ws_01", &["deploy", "pipeline"]), "q_6");
        let second = fabric.query(&query("ws_01", &["deploy", "pipeline"]), "q_6");
        assert_eq!(first, second, "identical queries select identically");
        let first_explain = fabric.explain(&first);
        let second_explain = fabric.explain(&second);
        assert_eq!(
            serde_json::to_string(&first_explain).unwrap(),
            serde_json::to_string(&second_explain).unwrap(),
            "byte-identical explanations"
        );
        // Both chunks match the same two keyword channels; the stable
        // chunk-id tie-break decides deterministically.
        assert_eq!(
            first.selections.first().unwrap().chunk.label.chunk_id,
            "c_1"
        );
    }

    #[test]
    fn corrupted_indexes_rebuild_from_authoritative_chunks() {
        let mut fabric = KnowledgeFabric::default();
        admit_text(
            &mut fabric,
            "i_1",
            "ws_01",
            "rebuild me",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        let healthy_digest = fabric.index_digest();
        // Corrupt: clear the keyword channel only.
        fabric.corrupt_keyword_index_for_tests("bogus", "i_1");
        assert_ne!(
            fabric.index_digest(),
            healthy_digest,
            "corruption is observable"
        );
        fabric.rebuild_indexes();
        assert_eq!(
            fabric.index_digest(),
            healthy_digest,
            "rebuild restores derivation"
        );
        assert_eq!(
            fabric
                .query(&query("ws_01", &["rebuild"]), "q_7")
                .selections
                .len(),
            1
        );
    }

    #[test]
    fn revocation_and_user_exclusion_apply_immediately() {
        let mut fabric = KnowledgeFabric::default();
        admit_text(
            &mut fabric,
            "r_1",
            "ws_01",
            "revoke this",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        admit_text(
            &mut fabric,
            "e_1",
            "ws_01",
            "exclude this",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        fabric.revoke("r_1");
        // Revocation removes the chunk and every index entry at once: the
        // channel query can no longer see it and the fabric is authoritative.
        let result = fabric.query(&query("ws_01", &["revoke"]), "q_8");
        assert!(result.selections.is_empty());
        assert!(fabric.inspect("r_1").is_none());

        fabric.exclude("e_1");
        // A channel-less (pinned) query still reaches the excluded chunk as
        // a candidate and records the user-exclusion reason.
        let mut pinned = query("ws_01", &[]);
        pinned.limit = 10;
        let result = fabric.query(&pinned, "q_9");
        assert!(
            result
                .exclusions
                .iter()
                .any(|excluded| excluded.chunk_id == "e_1"
                    && excluded.reason == ExclusionReason::UserExclusion)
        );
        assert!(
            result
                .selections
                .iter()
                .all(|selected| selected.chunk.label.chunk_id != "e_1")
        );
    }

    #[test]
    fn freshness_expiry_excludes_with_reason() {
        let mut fabric = KnowledgeFabric::default();
        let content = ChunkContent::Text {
            text: "fresh news".to_owned(),
        };
        let mut label = label_for("f_1", "ws_01", DataClass::Internal, TrustLevel::Trusted);
        label.content_digest = content_digest_of(&content);
        label.freshness.expires_at_ms = Some(1_500);
        fabric.admit(label, content).unwrap();
        let mut request = query("ws_01", &["fresh"]);
        request.now_ms = 2_000;
        let result = fabric.query(&request, "q_10");
        assert!(
            result
                .exclusions
                .iter()
                .any(|excluded| excluded.chunk_id == "f_1"
                    && excluded.reason == ExclusionReason::Freshness)
        );
    }

    #[test]
    fn untrusted_content_requires_explicit_admission() {
        let mut fabric = KnowledgeFabric::default();
        admit_text(
            &mut fabric,
            "u_1",
            "ws_01",
            "imported webpage claims",
            DataClass::Internal,
            TrustLevel::Untrusted,
        );
        let denied = fabric.query(&query("ws_01", &["imported"]), "q_11");
        assert!(
            denied
                .exclusions
                .iter()
                .any(|excluded| excluded.chunk_id == "u_1"
                    && excluded.reason == ExclusionReason::UntrustedNotAdmitted)
        );
        let mut admitted_request = query("ws_01", &["imported"]);
        admitted_request.include_untrusted = true;
        let admitted = fabric.query(&admitted_request, "q_12");
        assert_eq!(admitted.selections.len(), 1);
        let bundle = fabric.export_bundle(&admitted);
        assert!(
            bundle
                .taints
                .contains(&saber_egress::TaintKind::UntrustedSource)
        );
    }

    #[test]
    fn exported_bundles_carry_taint_and_classification() {
        let mut fabric = KnowledgeFabric::default();
        admit_text(
            &mut fabric,
            "t_1",
            "ws_01",
            "trusted deploy doc",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        admit_text(
            &mut fabric,
            "t_2",
            "ws_01",
            "confidential deploy doc",
            DataClass::Confidential,
            TrustLevel::Trusted,
        );
        let mut request = query("ws_01", &["deploy"]);
        request.sensitivity_ceiling = DataClass::Confidential;
        let result = fabric.query(&request, "q_13");
        let bundle = fabric.export_bundle(&result);
        assert_eq!(bundle.max_sensitivity, DataClass::Confidential);
        let egress = bundle.egress_request("example.invalid", 443);
        assert_eq!(egress.data_class, DataClass::Confidential);
        assert!(egress.taints.is_empty());
    }

    #[test]
    fn event_trail_uses_stable_names() {
        let mut fabric = KnowledgeFabric::default();
        admit_text(
            &mut fabric,
            "ev_1",
            "ws_01",
            "tracked",
            DataClass::Internal,
            TrustLevel::Trusted,
        );
        let result = fabric.query(&query("ws_01", &["tracked"]), "q_14");
        fabric.explain(&result);
        let names: Vec<&str> = fabric
            .take_events()
            .iter()
            .map(|event| event.name)
            .collect();
        assert!(names.contains(&"context.chunk_selected"));
        assert!(names.contains(&"retrieval.completed"));
        assert!(names.contains(&"knowledge.queried"));
        assert!(names.contains(&"context.explained"));
    }
}
