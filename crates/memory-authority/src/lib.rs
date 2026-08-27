//! Single-writer governed memory authority (ADR-012).

pub mod authority;
pub mod entry;

pub use authority::{
    AdmissionError, EventRecord, MemoryAuthority, MemoryProposal, MemoryQuery, MemoryView,
    PromoteError,
};
pub use entry::{
    MemoryEntry, MemoryFreshness, MemoryKind, MemoryProvenance, MemoryState, ReviewAuthority,
    RevisionEntry, TrustLevel, entry_id_for,
};

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use saber_policy::DataClass;

    use super::*;

    fn review() -> ReviewAuthority {
        ReviewAuthority::HumanReview {
            reviewer_id: "human_01".to_owned(),
        }
    }

    fn proposal(value: &str) -> MemoryProposal {
        MemoryProposal {
            key: "fact:deploy-env".to_owned(),
            kind: MemoryKind::Fact,
            value: value.to_owned(),
            tenant: "tenant_a".to_owned(),
            workspace: "ws_01".to_owned(),
            sensitivity: DataClass::Internal,
            provenance: MemoryProvenance {
                origin: "run://r_1".to_owned(),
                trust: TrustLevel::Untrusted,
                proposed_at_ms: 1_000,
            },
            expires_at_ms: None,
        }
    }

    fn query() -> MemoryQuery {
        MemoryQuery {
            sensitivity_ceiling: DataClass::Internal,
            now_ms: 2_000,
            key: None,
        }
    }

    #[test]
    fn candidates_never_auto_promote() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        let id = authority.propose(proposal("production"), 1_000).unwrap();
        assert_eq!(
            authority.history("fact:deploy-env")[0].entry.state,
            MemoryState::Candidate
        );
        assert!(
            authority.query(&query()).is_empty(),
            "candidates never surface as truth"
        );
        authority.promote(&id, &review(), 1_100).unwrap();
        let views = authority.query(&query());
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].entry.value, "production");
    }

    #[test]
    fn poisoned_candidate_requires_explicit_review() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        let id = authority
            .propose(proposal("poisoned truth"), 1_000)
            .unwrap();
        // Untrusted provenance: promoting is possible ONLY through an
        // explicit authority; the type offers no runtime-evidence variant.
        authority
            .promote(
                &id,
                &ReviewAuthority::ExplicitPolicy {
                    rule_id: "org.memory-review".to_owned(),
                },
                1_100,
            )
            .unwrap();
        assert_eq!(
            authority.history("fact:deploy-env")[0]
                .entry
                .provenance
                .trust,
            TrustLevel::Untrusted
        );
        // Without review the poisoned candidate stays invisible.
        let mut second = MemoryAuthority::new("tenant_a", "ws_01");
        second.propose(proposal("another poison"), 1_000).unwrap();
        assert!(second.query(&query()).is_empty());
    }

    #[test]
    fn contradicting_promotions_create_linked_revisions() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        let first = authority.propose(proposal("staging"), 1_000).unwrap();
        authority.promote(&first, &review(), 1_100).unwrap();
        // A contradicting value from a different origin: a new revision,
        // never an overwrite of the promoted one.
        let second = authority
            .propose(
                MemoryProposal {
                    value: "canary".to_owned(),
                    provenance: MemoryProvenance {
                        origin: "run://r_3".to_owned(),
                        trust: TrustLevel::Imported,
                        proposed_at_ms: 1_300,
                    },
                    ..proposal("canary")
                },
                1_300,
            )
            .unwrap();
        assert_ne!(second, first);
        authority.promote(&second, &review(), 1_400).unwrap();

        let history = authority.history("fact:deploy-env");
        assert_eq!(
            history.len(),
            2,
            "revisions accumulate, nothing overwritten"
        );
        assert_eq!(history[0].entry.state, MemoryState::Stale);
        assert_eq!(history[0].superseded_at_ms, Some(1_400));
        assert!(history[0].conflicted_with.is_empty());
        assert_eq!(history[1].entry.state, MemoryState::Promoted);
        assert_eq!(history[1].entry.revision, 2);
        assert_eq!(history[1].conflicted_with, vec![first.clone()]);
        let views = authority.query(&query());
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].entry.value, "canary");
    }

    #[test]
    fn ttl_expiry_surfaces_stale_not_truth() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        let id = authority
            .propose(
                MemoryProposal {
                    expires_at_ms: Some(1_500),
                    ..proposal("ephemeral")
                },
                1_000,
            )
            .unwrap();
        authority.promote(&id, &review(), 1_100).unwrap();
        let views = authority.query(&query());
        assert!(views.is_empty(), "expired memory never surfaces as truth");
        assert_eq!(
            authority.history("fact:deploy-env")[0].entry.state,
            MemoryState::Stale
        );
        let names: Vec<&str> = authority.take_events().iter().map(|e| e.name).collect();
        assert!(names.contains(&"memory.stale"));
    }

    #[test]
    fn revocation_is_immediate_and_auditable() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        let id = authority.propose(proposal("revoked truth"), 1_000).unwrap();
        authority.promote(&id, &review(), 1_100).unwrap();
        authority.revoke(&id);
        assert!(authority.query(&query()).is_empty());
        assert_eq!(
            authority.history("fact:deploy-env")[0].entry.state,
            MemoryState::Revoked
        );
        // Promotion of a revoked entry is refused.
        assert_eq!(
            authority.promote(&id, &review(), 1_200),
            Err(PromoteError::NotCandidate)
        );
        let names: Vec<&str> = authority.take_events().iter().map(|e| e.name).collect();
        assert!(names.contains(&"memory.revoked"));
    }

    #[test]
    fn cross_workspace_injection_fails_closed() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        let foreign = MemoryProposal {
            workspace: "ws_02".to_owned(),
            ..proposal("injection")
        };
        assert_eq!(
            authority.propose(foreign, 1_000),
            Err(AdmissionError::CrossWorkspace)
        );
        let foreign_tenant = MemoryProposal {
            tenant: "tenant_b".to_owned(),
            ..proposal("tenant injection")
        };
        assert_eq!(
            authority.propose(foreign_tenant, 1_000),
            Err(AdmissionError::CrossWorkspace)
        );
    }

    #[test]
    fn unclassified_and_malformed_proposals_fail() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        let mut no_origin = proposal("x");
        no_origin.provenance.origin = String::new();
        assert_eq!(
            authority.propose(no_origin, 1_000),
            Err(AdmissionError::Unclassified)
        );
        let mut bad_key = proposal("x");
        bad_key.key = "../escape".to_owned();
        assert_eq!(
            authority.propose(bad_key, 1_000),
            Err(AdmissionError::Unclassified)
        );
    }

    #[test]
    fn sensitivity_ceiling_governs_queries() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        let id = authority
            .propose(
                MemoryProposal {
                    sensitivity: DataClass::Restricted,
                    key: "fact:secret".to_owned(),
                    ..proposal("classified")
                },
                1_000,
            )
            .unwrap();
        authority.promote(&id, &review(), 1_100).unwrap();
        assert!(authority.query(&query()).is_empty());
        let mut elevated = query();
        elevated.sensitivity_ceiling = DataClass::Restricted;
        assert_eq!(authority.query(&elevated).len(), 1);
    }

    #[test]
    fn concurrent_writers_serialize_without_lost_updates() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        // Two writers race by interleaving proposals on the same key; the
        // single authority serializes them into distinct revisions.
        let first = authority
            .propose(
                MemoryProposal {
                    provenance: MemoryProvenance {
                        origin: "run://writer-1".to_owned(),
                        trust: TrustLevel::Trusted,
                        proposed_at_ms: 1_000,
                    },
                    ..proposal("from writer 1")
                },
                1_000,
            )
            .unwrap();
        let second = authority
            .propose(
                MemoryProposal {
                    provenance: MemoryProvenance {
                        origin: "run://writer-2".to_owned(),
                        trust: TrustLevel::Trusted,
                        proposed_at_ms: 1_001,
                    },
                    ..proposal("from writer 2")
                },
                1_001,
            )
            .unwrap();
        assert_ne!(first, second, "both proposals survive: no lost update");
        assert_eq!(authority.write_sequence(), 2);
        assert_eq!(authority.history("fact:deploy-env").len(), 2);
        // Promoting both serializes: the later promotion supersedes.
        authority.promote(&first, &review(), 1_100).unwrap();
        authority.promote(&second, &review(), 1_101).unwrap();
        let views = authority.query(&query());
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].entry.value, "from writer 2");
        assert_eq!(authority.write_sequence(), 4);
    }

    #[test]
    fn identical_inputs_produce_identical_outcomes() {
        let run = |authority: &mut MemoryAuthority| {
            let a = authority
                .propose(
                    MemoryProposal {
                        provenance: MemoryProvenance {
                            origin: "run://same".to_owned(),
                            trust: TrustLevel::Trusted,
                            proposed_at_ms: 1_000,
                        },
                        ..proposal("same value")
                    },
                    1_000,
                )
                .unwrap();
            authority.promote(&a, &review(), 1_100).unwrap();
            authority.query(&query())
        };
        let mut first = MemoryAuthority::new("tenant_a", "ws_01");
        let mut second = MemoryAuthority::new("tenant_a", "ws_01");
        assert_eq!(run(&mut first), run(&mut second));
        assert_eq!(
            serde_json::to_string(&first.history("fact:deploy-env")).unwrap(),
            serde_json::to_string(&second.history("fact:deploy-env")).unwrap()
        );
    }

    #[test]
    fn duplicate_pending_candidates_are_rejected() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        authority.propose(proposal("dup"), 1_000).unwrap();
        assert_eq!(
            authority.propose(proposal("dup"), 1_001),
            Err(AdmissionError::DuplicateCandidate)
        );
    }

    #[test]
    fn event_trail_uses_stable_names() {
        let mut authority = MemoryAuthority::new("tenant_a", "ws_01");
        let id = authority.propose(proposal("tracked"), 1_000).unwrap();
        authority.promote(&id, &review(), 1_100).unwrap();
        let _ = authority.query(&query());
        let names: Vec<&str> = authority.take_events().iter().map(|e| e.name).collect();
        assert!(names.contains(&"memory.proposed"));
        assert!(names.contains(&"memory.promoted"));
        assert!(names.contains(&"memory.queried"));
    }
}
