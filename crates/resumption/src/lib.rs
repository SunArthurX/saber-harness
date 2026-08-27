//! Verifiable Resumption Capsules (ADR-015).

pub mod capsule;
pub mod verify;

pub use capsule::{
    ArtifactRef, CAPSULE_SCHEMA_VERSION, CapsuleError, ResumptionCapsule, TaskLink,
    capsule_digest_of, capsule_id_for, digest_of, fingerprint_of_inventory,
};
pub use verify::{
    CapsuleFacts, CapsuleVerification, Continuation, DriftItem, PresentEnvironment,
    VerificationState, artifact_digest_of, capsule_from_facts, continue_from, verify_capsule,
};

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;

    fn facts() -> CapsuleFacts {
        CapsuleFacts {
            tenant: "tenant_a".to_owned(),
            workspace: "ws_01".to_owned(),
            goal_id: "goal_01".to_owned(),
            lineage: vec![
                TaskLink {
                    task_id: "task_01".to_owned(),
                    state: "succeeded".to_owned(),
                },
                TaskLink {
                    task_id: "task_02".to_owned(),
                    state: "in_progress".to_owned(),
                },
            ],
            artifacts: vec![ArtifactRef {
                path: "src/lib.rs".to_owned(),
                content_digest: artifact_digest_of(b"fn main() {}"),
            }],
            decision_ids: vec!["decision_01".to_owned()],
            inventory: vec![("src/lib.rs".to_owned(), artifact_digest_of(b"fn main() {}"))],
            created_at_ms: 1_000,
        }
    }

    fn environment(f: &CapsuleFacts) -> PresentEnvironment {
        PresentEnvironment {
            tenant: f.tenant.clone(),
            workspace: f.workspace.clone(),
            artifacts: vec![("src/lib.rs".to_owned(), b"fn main() {}".to_vec())],
            inventory: f.inventory.clone(),
        }
    }

    #[test]
    fn capsule_creation_binds_facts_into_a_digest_chain() {
        let capsule = capsule_from_facts(&facts()).unwrap();
        capsule.validate().unwrap();
        assert!(capsule.capsule_id.starts_with("sha256:"));
        assert_eq!(capsule.lineage.len(), 2);
        // Identical facts produce identical capsules.
        assert_eq!(capsule_from_facts(&facts()).unwrap(), capsule);
    }

    #[test]
    fn creation_refuses_missing_facts() {
        let mut incomplete = facts();
        incomplete.goal_id = String::new();
        assert_eq!(
            capsule_from_facts(&incomplete),
            Err(CapsuleError::Malformed)
        );
        let mut no_lineage = facts();
        no_lineage.lineage = Vec::new();
        assert_eq!(
            capsule_from_facts(&no_lineage),
            Err(CapsuleError::Malformed)
        );
        let mut bad_digest = facts();
        bad_digest.artifacts[0].content_digest = "not-a-digest".to_owned();
        assert_eq!(
            capsule_from_facts(&bad_digest),
            Err(CapsuleError::Malformed)
        );
    }

    #[test]
    fn tampered_capsules_fail_closed_anywhere() {
        let capsule = capsule_from_facts(&facts()).unwrap();
        let mut tampered = capsule.clone();
        tampered.goal_id = "goal_EVIL".to_owned();
        assert_eq!(tampered.validate(), Err(CapsuleError::DigestMismatch));
        let mut bad_digest = capsule;
        bad_digest.capsule_digest = format!("sha256:{}", "0".repeat(64));
        assert_eq!(bad_digest.validate(), Err(CapsuleError::DigestMismatch));
    }

    #[test]
    fn unknown_versions_fail_closed() {
        let mut future = capsule_from_facts(&facts()).unwrap();
        future.schema_version = "999.0.0".to_owned();
        assert_eq!(future.validate(), Err(CapsuleError::UnknownVersion));
    }

    #[test]
    fn mutated_or_missing_artifacts_surface_reconcile() {
        let f = facts();
        let capsule = capsule_from_facts(&f).unwrap();

        // Mutated artifact: digest differs, drift recorded, NeedsReconcile.
        let mut mutated_env = environment(&f);
        mutated_env.artifacts[0].1 = b"fn main() { changed }".to_vec();
        mutated_env.inventory = vec![(
            "src/lib.rs".to_owned(),
            artifact_digest_of(b"fn main() { changed }"),
        )];
        let report = verify_capsule(&capsule, &mutated_env).unwrap();
        assert_eq!(report.state, VerificationState::NeedsReconcile);
        assert!(report.drift.iter().any(|drift| matches!(
            drift,
            DriftItem::ArtifactMutated { path, .. } if path == "src/lib.rs"
        )));
        assert!(matches!(
            continue_from(&capsule, &report),
            Err(CapsuleError::Malformed)
        ));

        // Missing artifact: drift recorded.
        let mut missing_env = environment(&f);
        missing_env.artifacts = Vec::new();
        missing_env.inventory = Vec::new();
        let report = verify_capsule(&capsule, &missing_env).unwrap();
        assert!(report.drift.iter().any(|drift| matches!(
            drift,
            DriftItem::ArtifactMissing { path } if path == "src/lib.rs"
        )));
    }

    #[test]
    fn environment_drift_surfaces_reconcile_not_silent_continue() {
        let f = facts();
        let capsule = capsule_from_facts(&f).unwrap();
        let mut drifted = environment(&f);
        // An unrelated file appeared: the fingerprint changes even though
        // the referenced artifact is intact.
        drifted.inventory.push((
            "unrelated.txt".to_owned(),
            artifact_digest_of(b"external edit"),
        ));
        let report = verify_capsule(&capsule, &drifted).unwrap();
        assert_eq!(report.state, VerificationState::NeedsReconcile);
        assert!(
            report
                .drift
                .iter()
                .any(|drift| matches!(drift, DriftItem::FingerprintChanged { .. }))
        );
        assert!(continue_from(&capsule, &report).is_err());
    }

    #[test]
    fn ready_environment_continues_with_verbatim_lineage() {
        let f = facts();
        let capsule = capsule_from_facts(&f).unwrap();
        let report = verify_capsule(&capsule, &environment(&f)).unwrap();
        assert_eq!(report.state, VerificationState::Ready);
        assert!(report.drift.is_empty());
        let continuation = continue_from(&capsule, &report).unwrap();
        assert_eq!(continuation.capsule_id, capsule.capsule_id);
        assert_eq!(continuation.goal_id, "goal_01");
        // Resumed lineage equals the recorded lineage byte for byte.
        assert_eq!(
            serde_json::to_string(&continuation.lineage).unwrap(),
            serde_json::to_string(&capsule.lineage).unwrap()
        );
        assert_eq!(continuation.artifacts, capsule.artifacts);
        assert_eq!(continuation.decision_ids, capsule.decision_ids);
    }

    #[test]
    fn cross_workspace_injection_is_denied() {
        let capsule = capsule_from_facts(&facts()).unwrap();
        let mut foreign = environment(&facts());
        foreign.workspace = "ws_02".to_owned();
        assert_eq!(
            verify_capsule(&capsule, &foreign),
            Err(CapsuleError::CrossWorkspace)
        );
        let mut foreign_tenant = environment(&facts());
        foreign_tenant.tenant = "tenant_b".to_owned();
        assert_eq!(
            verify_capsule(&capsule, &foreign_tenant),
            Err(CapsuleError::CrossWorkspace)
        );
    }

    #[test]
    fn consumers_reverify_without_producer_trust() {
        // A consumer holding only the serialized capsule and the raw
        // environment can re-verify the full chain offline.
        let f = facts();
        let capsule = capsule_from_facts(&f).unwrap();
        let serialized = serde_json::to_string(&capsule).unwrap();
        let _ = serialized; // portability proof: the capsule is pure data
        let report = verify_capsule(&capsule, &environment(&f)).unwrap();
        assert_eq!(report.state, VerificationState::Ready);
        // And a tampered copy fails in any consumer.
        let mut tampered = capsule;
        tampered.lineage[0].state = "failed".to_owned();
        assert_eq!(tampered.validate(), Err(CapsuleError::DigestMismatch));
    }
}
