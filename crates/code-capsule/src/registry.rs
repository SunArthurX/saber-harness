//! Capsule registry: admission through the S15 workshop, execution
//! eligibility and supersession history (ADR-018).

use std::collections::BTreeMap;

use saber_evolution::{
    CandidateProvenance, CandidateState, EvaluationRecord, EvolutionKind, EvolutionWorkshop,
};
use saber_memory_authority::{ReviewAuthority, TrustLevel};
use saber_orchestrator::Grant;
use saber_policy::Action;
use saber_sandbox::SandboxPlan;

use crate::capsule::{CapsuleError, CodeCapsule};

/// One admitted capsule with its workshop binding.
struct AdmittedCapsule {
    capsule: CodeCapsule,
    evolution_candidate_id: String,
    budget_remaining_ms: u64,
}

/// The registry: admission, promotion wiring, eligibility and versions.
pub struct CapsuleRegistry {
    workshop: EvolutionWorkshop,
    capsules: BTreeMap<String, AdmittedCapsule>,
    /// name -> ordered version history (capsule ids, oldest first).
    history: BTreeMap<String, Vec<String>>,
    /// name -> active capsule id.
    active: BTreeMap<String, String>,
}

impl Default for CapsuleRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl CapsuleRegistry {
    /// Construct an empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self {
            workshop: EvolutionWorkshop::default(),
            capsules: BTreeMap::new(),
            history: BTreeMap::new(),
            active: BTreeMap::new(),
        }
    }

    /// Admit a capsule: full digest validation, then an S15 workshop
    /// proposal (kind `Code`). The capsule is NOT executable until the
    /// workshop candidate is promoted through explicit review (ADR-018).
    ///
    /// # Errors
    ///
    /// [`CapsuleError::DigestMismatch`] for tampered envelopes;
    /// [`CapsuleError::Malformed`] for malformed locks.
    pub fn admit(
        &mut self,
        capsule: CodeCapsule,
        source_bytes: &[u8],
    ) -> Result<String, CapsuleError> {
        capsule.validate()?;
        if crate::capsule::source_digest_of(source_bytes) != capsule.source_digest {
            return Err(CapsuleError::DigestMismatch);
        }
        // Supersession guard: a new version's grants must sit within the
        // previous version's grants — versions never widen authority.
        if let Some(previous_id) = self
            .history
            .get(&capsule.name)
            .and_then(|versions| versions.last())
            && let Some(previous) = self.capsules.get(previous_id)
            && !capsule.grants_within(&previous.capsule)
        {
            return Err(CapsuleError::Escalation);
        }
        let candidate_id = self
            .workshop
            .propose(
                EvolutionKind::Code,
                &capsule.capsule_id,
                CandidateProvenance {
                    source_event_id: format!("capsule://{}", capsule.capsule_id),
                    origin: format!("capsule:{}#{}", capsule.name, capsule.version),
                    trust: TrustLevel::Imported,
                },
            )
            .map_err(|_| CapsuleError::Malformed)?;
        self.capsules.insert(
            capsule.capsule_id.clone(),
            AdmittedCapsule {
                budget_remaining_ms: u64::MAX,
                evolution_candidate_id: candidate_id.clone(),
                capsule,
            },
        );
        Ok(candidate_id)
    }

    /// Quarantine and evaluate a capsule's workshop candidate (the S15
    /// deterministic evidence step).
    ///
    /// # Errors
    ///
    /// Mirrors the workshop lifecycle.
    pub fn evaluate(&mut self, capsule_id: &str, passed: bool) -> Result<(), CapsuleError> {
        let candidate_id = self.candidate_of(capsule_id)?;
        self.workshop
            .quarantine(&candidate_id)
            .map_err(map_workshop)?;
        self.workshop
            .evaluate(EvaluationRecord {
                candidate_id: candidate_id.clone(),
                inputs_digest: format!("sha256:{}", "0".repeat(64)),
                outputs_digest: format!("sha256:{}", "1".repeat(64)),
                passed,
                evaluated_at_ms: 1,
            })
            .map_err(map_workshop)
    }

    /// Promote a capsule through explicit review and activate its version.
    ///
    /// # Errors
    ///
    /// [`CapsuleError::NotPromoted`] mirrors workshop rejections.
    pub fn promote(
        &mut self,
        capsule_id: &str,
        authority: &ReviewAuthority,
        now_ms: u64,
    ) -> Result<(), CapsuleError> {
        let candidate_id = self.candidate_of(capsule_id)?;
        self.workshop
            .promote(&candidate_id, authority, now_ms)
            .map_err(map_workshop)?;
        let name = self
            .capsules
            .get(capsule_id)
            .map(|entry| entry.capsule.name.clone());
        if let Some(name) = name {
            self.history
                .entry(name.clone())
                .or_default()
                .push(capsule_id.to_owned());
            self.active.insert(name, capsule_id.to_owned());
        }
        Ok(())
    }

    /// Check execution eligibility and return the validated sandbox plan
    /// inputs: requested grants must be declared, dependencies pinned,
    /// budget available and the capsule workshop-promoted (ADR-018).
    ///
    /// # Errors
    ///
    /// Deterministic codes per [`CapsuleError`]; nothing executes on any
    /// error.
    pub fn authorize_execution(
        &mut self,
        capsule_id: &str,
        requested: &[Grant],
        dependency_names: &[&str],
    ) -> Result<ExecutionAuthorization, CapsuleError> {
        let candidate_id = self.candidate_of(capsule_id)?;
        let promoted = matches!(
            self.workshop
                .candidate(&candidate_id)
                .map(|candidate| &candidate.state),
            Some(CandidateState::Promoted)
        );
        if !promoted {
            return Err(CapsuleError::NotPromoted);
        }
        let capsule = self
            .capsules
            .get(capsule_id)
            .ok_or(CapsuleError::Unknown)?
            .capsule
            .clone();
        for grant in requested {
            let declared = capsule.grants.iter().any(|declared| grant.within(declared));
            if !declared {
                return Err(CapsuleError::UndeclaredGrant);
            }
        }
        for dependency in dependency_names {
            let pinned = capsule
                .dependencies
                .iter()
                .any(|lock| &lock.name == dependency);
            if !pinned {
                return Err(CapsuleError::UndeclaredDependency);
            }
        }
        let entry = self
            .capsules
            .get_mut(capsule_id)
            .ok_or(CapsuleError::Unknown)?;
        if entry.budget_remaining_ms == 0 {
            return Err(CapsuleError::BudgetExhausted);
        }
        Ok(ExecutionAuthorization {
            capsule_id: capsule_id.to_owned(),
            realm: capsule.realm,
            grants: requested.to_vec(),
            budget_wall_clock_ms: entry.budget_remaining_ms.min(capsule.budget.wall_clock_ms),
        })
    }

    /// Consume budget for one execution (the realm enforces the wall
    /// clock; the registry tracks exhaustion for eligibility).
    pub fn consume_budget(&mut self, capsule_id: &str, consumed_ms: u64) {
        if let Some(entry) = self.capsules.get_mut(capsule_id) {
            entry.budget_remaining_ms = entry.budget_remaining_ms.saturating_sub(consumed_ms);
        }
    }

    /// Roll the active version back to a previous history entry.
    ///
    /// # Errors
    ///
    /// [`CapsuleError::Unknown`] for foreign ids.
    pub fn rollback(&mut self, name: &str, to_capsule_id: &str) -> Result<(), CapsuleError> {
        let versions = self.history.get(name).ok_or(CapsuleError::Unknown)?;
        if !versions.iter().any(|id| id == to_capsule_id) {
            return Err(CapsuleError::Unknown);
        }
        self.active
            .insert(name.to_owned(), to_capsule_id.to_owned());
        Ok(())
    }

    /// The active capsule id for one name.
    #[must_use]
    pub fn active_version(&self, name: &str) -> Option<&str> {
        self.active.get(name).map(String::as_str)
    }

    /// The full version history for one name.
    #[must_use]
    pub fn history(&self, name: &str) -> &[String] {
        self.history.get(name).map_or(&[], Vec::as_slice)
    }

    fn candidate_of(&self, capsule_id: &str) -> Result<String, CapsuleError> {
        self.capsules
            .get(capsule_id)
            .map(|entry| entry.evolution_candidate_id.clone())
            .ok_or(CapsuleError::Unknown)
    }
}

/// The validated execution authorization handed to the S06 SPI.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionAuthorization {
    /// Authorized capsule.
    pub capsule_id: String,
    /// Declared realm the plan must bind to.
    pub realm: saber_sandbox::Realm,
    /// The authorized (already-declared) grants.
    pub grants: Vec<Grant>,
    /// Remaining budget bound for this execution.
    pub budget_wall_clock_ms: u64,
}

fn map_workshop(error: saber_evolution::WorkshopError) -> CapsuleError {
    match error {
        saber_evolution::WorkshopError::IllegalTransition
        | saber_evolution::WorkshopError::EvaluationFailed => CapsuleError::NotPromoted,
        saber_evolution::WorkshopError::TamperedPayload => CapsuleError::DigestMismatch,
        saber_evolution::WorkshopError::UnknownOrTerminal => CapsuleError::Unknown,
        saber_evolution::WorkshopError::Malformed => CapsuleError::Malformed,
    }
}

/// Build a sandbox plan bound to a capsule's declared realm and overlay —
/// the S06 SPI enforces it; this helper only constructs the typed plan.
#[must_use]
pub fn plan_for_authorization(
    authorization: &ExecutionAuthorization,
    overlay_root: &std::path::Path,
) -> SandboxPlan {
    SandboxPlan {
        version: 1,
        workspace_id: format!("capsule:{}", authorization.capsule_id),
        realm: authorization.realm,
        mounts: vec![
            saber_sandbox::MountSpec {
                target: "workspace".to_owned(),
                source: saber_sandbox::MountSource::Overlay {
                    host_path: overlay_root.to_owned(),
                },
                writable: true,
                executable: false,
            },
            saber_sandbox::MountSpec {
                target: "tools".to_owned(),
                source: saber_sandbox::MountSource::SystemTools {
                    host_path: std::env::temp_dir(),
                },
                writable: false,
                executable: true,
            },
        ],
        env: saber_sandbox::EnvSpec::default(),
        budget: saber_sandbox::BudgetSpec {
            wall_clock_ms: authorization.budget_wall_clock_ms,
            ..saber_sandbox::BudgetSpec::default_budget()
        },
        network: saber_sandbox::NetworkSpec::Denied,
        command: None,
    }
}

/// Convenience: a declared grant constructor for capsule builders.
#[must_use]
pub fn grant(action: Action, selector: saber_orchestrator::Selector) -> Grant {
    Grant { action, selector }
}
