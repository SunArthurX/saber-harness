//! Governed self-evolution workshop (ADR-017).

pub mod candidate;
pub mod workshop;

pub use candidate::{
    CandidateProvenance, CandidateState, EvaluationRecord, EvolutionCandidate, EvolutionKind,
    PromotionRecord, WorkshopError, candidate_id_of, kind_label, payload_digest_of,
    promotion_digest_of,
};
pub use workshop::EvolutionWorkshop;

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use saber_memory_authority::{ReviewAuthority, TrustLevel};

    use super::*;

    fn provenance(trust: TrustLevel) -> CandidateProvenance {
        CandidateProvenance {
            source_event_id: "event://run_1/obs_1".to_owned(),
            origin: "run://r_1".to_owned(),
            trust,
        }
    }

    fn review() -> ReviewAuthority {
        ReviewAuthority::HumanReview {
            reviewer_id: "human_01".to_owned(),
        }
    }

    fn evaluation(candidate_id: &str, passed: bool) -> EvaluationRecord {
        EvaluationRecord {
            candidate_id: candidate_id.to_owned(),
            inputs_digest: format!("sha256:{}", "a".repeat(64)),
            outputs_digest: format!("sha256:{}", "b".repeat(64)),
            passed,
            evaluated_at_ms: 2_000,
        }
    }

    /// Drive a candidate through quarantine and evaluation.
    fn evaluate(workshop: &mut EvolutionWorkshop, candidate_id: &str, passed: bool) {
        workshop.quarantine(candidate_id).unwrap();
        workshop.evaluate(evaluation(candidate_id, passed)).unwrap();
    }

    #[test]
    fn lifecycle_states_never_skip() {
        let mut workshop = EvolutionWorkshop::default();
        let id = workshop
            .propose(
                EvolutionKind::Skill,
                "skill: deploy helper",
                provenance(TrustLevel::Trusted),
            )
            .unwrap();
        assert!(matches!(
            workshop.candidate(&id).unwrap().state,
            CandidateState::Proposed
        ));
        // Proposed -> Promoted is structurally rejected.
        assert_eq!(
            workshop.promote(&id, &review(), 3_000),
            Err(WorkshopError::IllegalTransition)
        );
        // Quarantine -> Promoted (skipping evaluation) is rejected too.
        workshop.quarantine(&id).unwrap();
        assert_eq!(
            workshop.promote(&id, &review(), 3_000),
            Err(WorkshopError::IllegalTransition)
        );
        // The legal path works.
        workshop.evaluate(evaluation(&id, true)).unwrap();
        let record = workshop.promote(&id, &review(), 3_000).unwrap();
        assert!(record.promotion_digest.starts_with("sha256:"));
        assert_eq!(workshop.active().count(), 1);
    }

    #[test]
    fn evaluation_failure_blocks_promotion() {
        let mut workshop = EvolutionWorkshop::default();
        let id = workshop
            .propose(
                EvolutionKind::Rule,
                "rule: prefer staging",
                provenance(TrustLevel::Imported),
            )
            .unwrap();
        evaluate(&mut workshop, &id, false);
        assert_eq!(
            workshop.promote(&id, &review(), 3_000),
            Err(WorkshopError::EvaluationFailed)
        );
        assert_eq!(workshop.active().count(), 0);
    }

    #[test]
    fn no_runtime_auto_promotion_path_exists() {
        // The only promotion authority variants are explicit; a runtime
        // cannot construct authority over its own evolution. Promoting
        // without completing evaluation is refused in every state.
        let mut workshop = EvolutionWorkshop::default();
        let id = workshop
            .propose(
                EvolutionKind::Workflow,
                "workflow: release",
                provenance(TrustLevel::Trusted),
            )
            .unwrap();
        // Proposed state: promotion refused.
        assert_eq!(
            workshop.promote(&id, &review(), 3_000),
            Err(WorkshopError::IllegalTransition)
        );
        // Quarantined (not yet evaluated): still refused.
        workshop.quarantine(&id).unwrap();
        assert_eq!(
            workshop.promote(&id, &review(), 3_000),
            Err(WorkshopError::IllegalTransition)
        );
        // A policy authority is equally explicit and equally required.
        workshop.evaluate(evaluation(&id, true)).unwrap();
        let policy = ReviewAuthority::ExplicitPolicy {
            rule_id: "org.evolution-review".to_owned(),
        };
        let record = workshop.promote(&id, &policy, 3_000).unwrap();
        assert!(matches!(
            record.authority,
            ReviewAuthority::ExplicitPolicy { .. }
        ));
    }

    #[test]
    fn poisoned_evidence_promotes_only_through_explicit_review() {
        let mut workshop = EvolutionWorkshop::default();
        let id = workshop
            .propose(
                EvolutionKind::Memory,
                "memory: the build is always green",
                provenance(TrustLevel::Untrusted),
            )
            .unwrap();
        evaluate(&mut workshop, &id, true);
        // Untrusted provenance follows the SAME explicit review; the
        // promotion record retains the provenance for audit traceability.
        let record = workshop.promote(&id, &review(), 3_000).unwrap();
        assert_eq!(record.provenance.trust, TrustLevel::Untrusted);
        assert_eq!(record.provenance.source_event_id, "event://run_1/obs_1");
    }

    #[test]
    fn tampered_payload_fails_the_digest_chain() {
        let mut workshop = EvolutionWorkshop::default();
        let id = workshop
            .propose(
                EvolutionKind::Skill,
                "skill: benign",
                provenance(TrustLevel::Trusted),
            )
            .unwrap();
        workshop.quarantine(&id).unwrap();
        // Simulate on-disk tampering between states.
        let candidate = workshop.candidate_mut_for_tests(&id).unwrap();
        candidate.payload = "skill: EVIL".to_owned();
        let tampered_eval = evaluation(&id, true);
        assert_eq!(
            workshop.evaluate(tampered_eval),
            Err(WorkshopError::TamperedPayload)
        );
    }

    #[test]
    fn revoked_promotions_disappear_immediately() {
        let mut workshop = EvolutionWorkshop::default();
        let id = workshop
            .propose(
                EvolutionKind::Skill,
                "skill: short-lived",
                provenance(TrustLevel::Trusted),
            )
            .unwrap();
        evaluate(&mut workshop, &id, true);
        workshop.promote(&id, &review(), 3_000).unwrap();
        assert_eq!(workshop.active().count(), 1);
        workshop.revoke(&id).unwrap();
        assert_eq!(
            workshop.active().count(),
            0,
            "capability removed immediately"
        );
        assert!(matches!(
            workshop.candidate(&id).unwrap().state,
            CandidateState::Revoked
        ));
        assert_eq!(
            workshop.revoked_ids(),
            std::slice::from_ref(&id),
            "audit trail retained"
        );
        // Revocation is terminal.
        assert_eq!(
            workshop.promote(&id, &review(), 4_000),
            Err(WorkshopError::IllegalTransition)
        );
    }

    #[test]
    fn provenance_survives_and_deterministic_records() {
        let run = |workshop: &mut EvolutionWorkshop| {
            let id = workshop
                .propose(
                    EvolutionKind::Rule,
                    "rule: format on save",
                    provenance(TrustLevel::Trusted),
                )
                .unwrap();
            evaluate(workshop, &id, true);
            workshop.promote(&id, &review(), 3_000).unwrap()
        };
        let mut first = EvolutionWorkshop::default();
        let mut second = EvolutionWorkshop::default();
        assert_eq!(
            serde_json::to_string(&run(&mut first)).unwrap(),
            serde_json::to_string(&run(&mut second)).unwrap(),
            "identical inputs produce identical promotion records"
        );
    }

    #[test]
    fn malformed_proposals_are_refused() {
        let mut workshop = EvolutionWorkshop::default();
        assert_eq!(
            workshop.propose(EvolutionKind::Skill, "", provenance(TrustLevel::Trusted)),
            Err(WorkshopError::Malformed)
        );
        let mut no_source = provenance(TrustLevel::Trusted);
        no_source.source_event_id = String::new();
        assert_eq!(
            workshop.propose(EvolutionKind::Skill, "payload", no_source),
            Err(WorkshopError::Malformed)
        );
        assert_eq!(
            workshop.quarantine("missing"),
            Err(WorkshopError::UnknownOrTerminal)
        );
    }
}
