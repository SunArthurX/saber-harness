//! The Evolution Workshop: the governed candidate lifecycle (ADR-017).

use std::collections::BTreeMap;

use saber_memory_authority::ReviewAuthority;

use crate::candidate::{
    CandidateProvenance, CandidateState, EvaluationRecord, EvolutionCandidate, EvolutionKind,
    PromotionRecord, WorkshopError, candidate_id_of, payload_digest_of, promotion_digest_of,
};

/// The workshop: one pure state machine over evolution candidates.
#[derive(Default)]
pub struct EvolutionWorkshop {
    candidates: BTreeMap<String, EvolutionCandidate>,
    evaluations: BTreeMap<String, EvaluationRecord>,
    promotions: BTreeMap<String, PromotionRecord>,
    revoked: Vec<String>,
}

impl EvolutionWorkshop {
    /// Propose a candidate from runtime evidence. The candidate enters
    /// `Proposed` with digest-bound content and full provenance; nothing
    /// about proposing confers capability.
    ///
    /// # Errors
    ///
    /// [`WorkshopError::Malformed`] for empty payloads or provenance.
    pub fn propose(
        &mut self,
        kind: EvolutionKind,
        payload: &str,
        provenance: CandidateProvenance,
    ) -> Result<String, WorkshopError> {
        if payload.is_empty()
            || provenance.source_event_id.is_empty()
            || provenance.origin.is_empty()
        {
            return Err(WorkshopError::Malformed);
        }
        let payload_digest = payload_digest_of(payload);
        let candidate_id = candidate_id_of(kind, &payload_digest);
        self.candidates.insert(
            candidate_id.clone(),
            EvolutionCandidate {
                candidate_id: candidate_id.clone(),
                kind,
                payload: payload.to_owned(),
                payload_digest,
                provenance,
                state: CandidateState::Proposed,
            },
        );
        Ok(candidate_id)
    }

    /// Quarantine a proposed candidate for evaluation.
    ///
    /// # Errors
    ///
    /// [`WorkshopError::IllegalTransition`] unless currently `Proposed`.
    pub fn quarantine(&mut self, candidate_id: &str) -> Result<(), WorkshopError> {
        self.guard(candidate_id)?;
        if !self.is_state(candidate_id, |state| {
            matches!(state, CandidateState::Proposed)
        }) {
            return Err(WorkshopError::IllegalTransition);
        }
        self.set_state(candidate_id, CandidateState::Quarantined);
        Ok(())
    }

    /// Record a deterministic evaluation. The verdict is evidence — a
    /// passing evaluation never promotes by itself (ADR-017).
    ///
    /// # Errors
    ///
    /// [`WorkshopError::IllegalTransition`] unless currently
    /// `Quarantined`.
    pub fn evaluate(&mut self, record: EvaluationRecord) -> Result<(), WorkshopError> {
        self.guard(&record.candidate_id)?;
        if !self.is_state(&record.candidate_id, |state| {
            matches!(state, CandidateState::Quarantined)
        }) {
            return Err(WorkshopError::IllegalTransition);
        }
        let passed = record.passed;
        let candidate_id = record.candidate_id.clone();
        self.evaluations.insert(candidate_id.clone(), record);
        self.set_state(&candidate_id, CandidateState::Evaluated { passed });
        Ok(())
    }

    /// Promote an evaluated-and-passed candidate under an explicit review
    /// authority. The authority type has no runtime-evidence variant: a
    /// run cannot construct authority over its own evolution.
    ///
    /// # Errors
    ///
    /// [`WorkshopError::IllegalTransition`] unless evaluated;
    /// [`WorkshopError::EvaluationFailed`] when the evaluation did not
    /// pass.
    pub fn promote(
        &mut self,
        candidate_id: &str,
        authority: &ReviewAuthority,
        now_ms: u64,
    ) -> Result<PromotionRecord, WorkshopError> {
        self.guard(candidate_id)?;
        let record = {
            let candidate = self
                .candidate_snapshot(candidate_id)
                .unwrap_or_else(|| unreachable!("guard passed"));
            let CandidateState::Evaluated { passed } = &candidate.state else {
                return Err(WorkshopError::IllegalTransition);
            };
            if !*passed {
                return Err(WorkshopError::EvaluationFailed);
            }
            let record = PromotionRecord {
                candidate_id: candidate.candidate_id.clone(),
                payload_digest: candidate.payload_digest.clone(),
                authority: authority.clone(),
                provenance: candidate.provenance.clone(),
                promoted_at_ms: now_ms,
                promotion_digest: String::new(),
            };
            PromotionRecord {
                promotion_digest: promotion_digest_of(&record),
                ..record
            }
        };
        self.set_state(candidate_id, CandidateState::Promoted);
        self.promotions
            .insert(record.candidate_id.clone(), record.clone());
        Ok(record)
    }

    /// Reject a candidate with a stable reason.
    ///
    /// # Errors
    ///
    /// [`WorkshopError::IllegalTransition`] for terminal states.
    pub fn reject(
        &mut self,
        candidate_id: &str,
        reason: &'static str,
    ) -> Result<(), WorkshopError> {
        self.guard(candidate_id)?;
        if self.is_state(candidate_id, |state| {
            matches!(
                state,
                CandidateState::Rejected { .. } | CandidateState::Revoked
            )
        }) {
            return Err(WorkshopError::IllegalTransition);
        }
        self.set_state(candidate_id, CandidateState::Rejected { reason });
        Ok(())
    }

    /// Revoke a promoted candidate: removed from active queries
    /// immediately, lifecycle history retained.
    ///
    /// # Errors
    ///
    /// [`WorkshopError::IllegalTransition`] unless currently `Promoted`.
    pub fn revoke(&mut self, candidate_id: &str) -> Result<(), WorkshopError> {
        self.guard(candidate_id)?;
        if !self.is_state(candidate_id, |state| {
            matches!(state, CandidateState::Promoted)
        }) {
            return Err(WorkshopError::IllegalTransition);
        }
        self.set_state(candidate_id, CandidateState::Revoked);
        self.promotions.remove(candidate_id);
        self.revoked.push(candidate_id.to_owned());
        Ok(())
    }

    /// Active (promoted, non-revoked) candidates — the capability surface.
    pub fn active(&self) -> impl Iterator<Item = &PromotionRecord> {
        self.promotions.values()
    }

    /// One candidate's full lifecycle state.
    #[must_use]
    pub fn candidate(&self, candidate_id: &str) -> Option<&EvolutionCandidate> {
        self.candidates.get(candidate_id)
    }

    /// One evaluation record.
    #[must_use]
    pub fn evaluation(&self, candidate_id: &str) -> Option<&EvaluationRecord> {
        self.evaluations.get(candidate_id)
    }

    /// Revoked candidate ids (audit trail).
    #[must_use]
    pub fn revoked_ids(&self) -> &[String] {
        &self.revoked
    }

    /// Shared pre-transition guard: presence plus digest re-verification.
    fn guard(&self, candidate_id: &str) -> Result<(), WorkshopError> {
        let Some(candidate) = self.candidates.get(candidate_id) else {
            return Err(WorkshopError::UnknownOrTerminal);
        };
        // Digest re-verification before every transition: tampering
        // between states is detected, not just at promotion.
        if !matches!(candidate.state, CandidateState::Proposed)
            && payload_digest_of(&candidate.payload) != candidate.payload_digest
        {
            return Err(WorkshopError::TamperedPayload);
        }
        Ok(())
    }

    fn is_state(&self, candidate_id: &str, predicate: impl Fn(&CandidateState) -> bool) -> bool {
        self.candidates
            .get(candidate_id)
            .is_some_and(|candidate| predicate(&candidate.state))
    }

    fn set_state(&mut self, candidate_id: &str, state: CandidateState) {
        if let Some(candidate) = self.candidates.get_mut(candidate_id) {
            candidate.state = state;
        }
    }

    fn candidate_snapshot(&self, candidate_id: &str) -> Option<EvolutionCandidate> {
        self.candidates.get(candidate_id).cloned()
    }
}

impl EvolutionWorkshop {
    /// Test-only: mutate stored payload to simulate on-disk tampering
    /// between lifecycle states.
    #[cfg(test)]
    pub fn candidate_mut_for_tests(
        &mut self,
        candidate_id: &str,
    ) -> Option<&mut EvolutionCandidate> {
        self.candidates.get_mut(candidate_id)
    }
}
