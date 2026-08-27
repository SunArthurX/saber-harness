//! The orchestrator: scheduling, judgment wiring, failure domains and
//! deterministic cancellation over the Goal DAG (ADR-016).

use std::collections::{BTreeMap, BTreeSet};

/// Orchestrator failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrchestratorError {
    /// The task is unknown or not schedulable now.
    NotReady,
    /// The delegation request escalated beyond the parent.
    Escalation,
    /// The task already terminated.
    Terminal,
    /// The task id is unknown.
    UnknownTask,
}

impl std::fmt::Display for OrchestratorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::NotReady => "not_ready",
            Self::Escalation => "escalation",
            Self::Terminal => "terminal",
            Self::UnknownTask => "unknown_task",
        })
    }
}

impl std::error::Error for OrchestratorError {}

/// The pure orchestrator for one goal.
pub struct GoalOrchestrator {
    dag: GoalDag,
    parent_grants: Vec<Grant>,
    states: BTreeMap<String, TaskState>,
    delegations: BTreeMap<String, Delegation>,
    completed: BTreeSet<String>,
    cancelled: BTreeSet<String>,
    rejected_counts: BTreeMap<String, u32>,
    exhausted: BTreeSet<String>,
}

impl GoalOrchestrator {
    /// Construct an orchestrator over a validated DAG with the parent's
    /// authority (every delegation attenuates from it).
    #[must_use]
    pub fn new(dag: GoalDag, parent_grants: Vec<Grant>) -> Self {
        let states = dag
            .task_ids()
            .map(|task_id| (task_id.to_owned(), TaskState::Pending))
            .collect();
        Self {
            dag,
            parent_grants,
            states,
            delegations: BTreeMap::new(),
            completed: BTreeSet::new(),
            cancelled: BTreeSet::new(),
            rejected_counts: BTreeMap::new(),
            exhausted: BTreeSet::new(),
        }
    }

    /// The underlying DAG.
    #[must_use]
    pub fn dag(&self) -> &GoalDag {
        &self.dag
    }

    /// One task's current state.
    #[must_use]
    pub fn state(&self, task_id: &str) -> Option<TaskState> {
        self.states.get(task_id).copied()
    }

    /// Ready (dependency-satisfied, non-terminal) tasks in deterministic
    /// order.
    #[must_use]
    pub fn ready(&self) -> Vec<String> {
        self.dag
            .ready_tasks(&self.completed)
            .into_iter()
            .map(|task| task.task_id.clone())
            .filter(|task_id| {
                matches!(self.states.get(task_id), Some(TaskState::Pending))
                    && !self.cancelled.contains(task_id)
            })
            .collect()
    }

    /// Delegate one ready task to a subagent with attenuated grants.
    ///
    /// # Errors
    ///
    /// [`OrchestratorError::NotReady`] when dependencies are unmet or the
    /// task is terminal; [`OrchestratorError::Escalation`] when the
    /// request exceeds the parent authority.
    pub fn delegate_task(
        &mut self,
        task_id: &str,
        subagent_id: &str,
        requested: &[Grant],
        budget_tokens: u64,
    ) -> Result<Delegation, OrchestratorError> {
        if !self.states.contains_key(task_id) {
            return Err(OrchestratorError::UnknownTask);
        }
        let state = self
            .states
            .get(task_id)
            .copied()
            .unwrap_or(TaskState::Pending);
        if matches!(state, TaskState::Failed | TaskState::Cancelled) {
            return Err(OrchestratorError::Terminal);
        }
        let ready = self.ready();
        if !ready.iter().any(|ready_id| ready_id == task_id) {
            return Err(OrchestratorError::NotReady);
        }
        let retries = self
            .rejected_counts
            .get(task_id)
            .map_or(crate::delegation::MAX_RETRIES, |used| {
                crate::delegation::MAX_RETRIES.saturating_sub(*used)
            });
        if retries == 0 || self.exhausted.contains(task_id) {
            self.states.insert(task_id.to_owned(), TaskState::Failed);
            return Err(OrchestratorError::Terminal);
        }
        let delegation = delegate(
            &self.parent_grants,
            task_id,
            subagent_id,
            requested,
            budget_tokens,
            retries,
        )
        .map_err(|error| match error {
            crate::delegation::DelegationError::Escalation => OrchestratorError::Escalation,
            crate::delegation::DelegationError::Malformed => OrchestratorError::NotReady,
        })?;
        self.states.insert(task_id.to_owned(), TaskState::Delegated);
        self.delegations
            .insert(task_id.to_owned(), delegation.clone());
        Ok(delegation)
    }

    /// Submit a subagent report for an in-flight task. Verified evidence
    /// completes the task; anything else is rejected (bounded retries,
    /// never wider authority).
    ///
    /// # Errors
    ///
    /// [`OrchestratorError::NotReady`] when the task is not delegated;
    /// [`OrchestratorError::Terminal`] when rejection exhausts retries.
    pub fn submit_report(
        &mut self,
        report: &SubagentReport,
    ) -> Result<Judgment, OrchestratorError> {
        let Some(delegation) = self.delegations.get(&report.task_id).cloned() else {
            return Err(OrchestratorError::NotReady);
        };
        if self.states.get(&report.task_id) != Some(&TaskState::Delegated) {
            return Err(OrchestratorError::NotReady);
        }
        let declared = self
            .dag
            .task(&report.task_id)
            .map(|task| task.declared_evidence.clone())
            .unwrap_or_default();
        let judgment = judge_report(
            report,
            &delegation.delegation_id,
            &delegation.subagent_id,
            &declared,
        );
        match judgment {
            Judgment::Verified => {
                self.states
                    .insert(report.task_id.clone(), TaskState::Completed);
                self.completed.insert(report.task_id.clone());
                self.delegations.remove(&report.task_id);
            }
            Judgment::Rejected(_reason) => {
                let used = self
                    .rejected_counts
                    .entry(report.task_id.clone())
                    .or_insert(0);
                *used += 1;
                if *used >= crate::delegation::MAX_RETRIES {
                    self.states
                        .insert(report.task_id.clone(), TaskState::Failed);
                    self.delegations.remove(&report.task_id);
                    return Err(OrchestratorError::Terminal);
                }
                // A fresh retry cycle: the failed delegation ends and the
                // re-delegation re-derives its authority from the parent —
                // never from the failed attempt.
                self.delegations.remove(&report.task_id);
                self.states
                    .insert(report.task_id.clone(), TaskState::Pending);
            }
        }
        Ok(judgment)
    }

    /// Record token-budget exhaustion for one task: fails that task alone;
    /// siblings and the goal continue (ADR-016).
    pub fn exhaust_budget(&mut self, task_id: &str) {
        if self.states.contains_key(task_id) {
            self.exhausted.insert(task_id.to_owned());
            self.states.insert(task_id.to_owned(), TaskState::Failed);
            self.delegations.remove(task_id);
        }
    }

    /// Cancel one task and every transitive descendant — exactly once,
    /// idempotently. Returns the cancellation blast radius.
    pub fn cancel(&mut self, task_id: &str) -> BTreeSet<String> {
        let mut radius = self.dag.descendants(task_id);
        radius.insert(task_id.to_owned());
        for id in &radius {
            if self.states.contains_key(id) {
                self.states.insert(id.clone(), TaskState::Cancelled);
                self.cancelled.insert(id.clone());
                self.delegations.remove(id);
            }
        }
        radius
    }
}

pub mod dag;
pub mod delegation;
pub mod judgment;

pub use dag::{DagError, GoalDag, TaskNode, TaskState};
pub use delegation::{Delegation, DelegationError, Grant, Selector, delegate};
pub use judgment::{
    EvidenceKind, EvidenceSpec, Judgment, Observation, RejectionReason, ReportedEvidence,
    SubagentReport, artifact_digest, judge_report,
};

#[cfg(test)]
mod orchestrator_tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use saber_policy::Action;

    use super::*;

    fn read_repo() -> Grant {
        Grant {
            action: Action::FsRead,
            selector: Selector::Prefix("workspace://ws_01/repo".to_owned()),
        }
    }

    fn task(id: &str, deps: &[&str], evidence: Vec<EvidenceSpec>) -> TaskNode {
        TaskNode {
            task_id: id.to_owned(),
            dependencies: deps.iter().map(ToString::to_string).collect(),
            declared_evidence: evidence,
        }
    }

    fn spec(digest: &str) -> EvidenceSpec {
        EvidenceSpec {
            label: "artifact".to_owned(),
            kind: EvidenceKind::ArtifactDigest {
                digest: digest.to_owned(),
            },
        }
    }

    fn dag() -> GoalDag {
        GoalDag::new(
            "goal_01",
            vec![
                task(
                    "build",
                    &[],
                    vec![spec(&artifact_digest(b"built artifact"))],
                ),
                task(
                    "test",
                    &["build"],
                    vec![spec(&artifact_digest(b"test report"))],
                ),
                task(
                    "docs",
                    &["build"],
                    vec![spec(&artifact_digest(b"docs page"))],
                ),
            ],
        )
        .unwrap()
    }

    fn report(task_id: &str, delegation: &Delegation, bytes: &[u8]) -> SubagentReport {
        SubagentReport {
            delegation_id: delegation.delegation_id.clone(),
            subagent_id: delegation.subagent_id.clone(),
            task_id: task_id.to_owned(),
            evidence: vec![ReportedEvidence {
                label: "artifact".to_owned(),
                observation: Observation::Artifact {
                    bytes: bytes.to_vec(),
                },
            }],
        }
    }

    #[test]
    fn tasks_only_run_when_dependencies_are_evidence_complete() {
        let mut orchestrator = GoalOrchestrator::new(dag(), vec![read_repo()]);
        // "test" depends on "build": not schedulable before completion.
        assert_eq!(
            orchestrator.delegate_task("test", "sub_t", &[read_repo()], 1_000),
            Err(OrchestratorError::NotReady)
        );
        let build = orchestrator
            .delegate_task("build", "sub_b", &[read_repo()], 1_000)
            .unwrap();
        assert!(
            orchestrator
                .submit_report(&report("build", &build, b"built artifact"))
                .is_ok_and(|judgment| judgment == Judgment::Verified)
        );
        assert_eq!(orchestrator.state("build"), Some(TaskState::Completed));
        // Now test and docs are both ready, in deterministic order.
        assert_eq!(
            orchestrator.ready(),
            vec!["docs".to_owned(), "test".to_owned()]
        );
    }

    #[test]
    fn self_reported_success_without_evidence_is_rejected() {
        let mut orchestrator = GoalOrchestrator::new(dag(), vec![read_repo()]);
        let build = orchestrator
            .delegate_task("build", "sub_b", &[read_repo()], 1_000)
            .unwrap();
        // Wrong artifact bytes: digest mismatch.
        let forged = SubagentReport {
            delegation_id: build.delegation_id.clone(),
            subagent_id: build.subagent_id.clone(),
            task_id: "build".to_owned(),
            evidence: vec![ReportedEvidence {
                label: "artifact".to_owned(),
                observation: Observation::Artifact {
                    bytes: b"made up".to_vec(),
                },
            }],
        };
        assert_eq!(
            orchestrator.submit_report(&forged),
            Ok(Judgment::Rejected(RejectionReason::EvidenceMismatch))
        );
        assert_eq!(
            orchestrator.state("build"),
            Some(TaskState::Pending),
            "bounded retry pending"
        );
    }

    #[test]
    fn forged_subagent_identity_and_delegation_are_rejected() {
        let mut orchestrator = GoalOrchestrator::new(dag(), vec![read_repo()]);
        let build = orchestrator
            .delegate_task("build", "sub_b", &[read_repo()], 1_000)
            .unwrap();
        let impostor = SubagentReport {
            delegation_id: build.delegation_id.clone(),
            subagent_id: "sub_IMPOSTOR".to_owned(),
            task_id: "build".to_owned(),
            evidence: vec![ReportedEvidence {
                label: "artifact".to_owned(),
                observation: Observation::Artifact {
                    bytes: b"built artifact".to_vec(),
                },
            }],
        };
        assert_eq!(
            orchestrator.submit_report(&impostor),
            Ok(Judgment::Rejected(RejectionReason::ForgedIdentity))
        );
        // A report answering a different delegation is refused outright
        // (fresh delegation after the rejection started a retry cycle).
        let fresh = orchestrator
            .delegate_task("build", "sub_b", &[read_repo()], 1_000)
            .unwrap();
        let wrong = SubagentReport {
            delegation_id: "sha256:".to_owned() + &"0".repeat(64),
            subagent_id: fresh.subagent_id.clone(),
            task_id: "build".to_owned(),
            evidence: Vec::new(),
        };
        assert!(matches!(
            orchestrator.submit_report(&wrong),
            Ok(Judgment::Rejected(RejectionReason::WrongDelegation))
        ));
    }

    #[test]
    fn budget_exhaustion_fails_only_its_task() {
        let mut orchestrator = GoalOrchestrator::new(dag(), vec![read_repo()]);
        let build = orchestrator
            .delegate_task("build", "sub_b", &[read_repo()], 1_000)
            .unwrap();
        orchestrator.exhaust_budget("build");
        assert_eq!(orchestrator.state("build"), Some(TaskState::Failed));
        // The report for the exhausted task can no longer complete it.
        assert_eq!(
            orchestrator.submit_report(&report("build", &build, b"built artifact")),
            Err(OrchestratorError::NotReady)
        );
        // Siblings of the failure (once reachable) are untouched.
        assert_eq!(orchestrator.state("docs"), Some(TaskState::Pending));
    }

    #[test]
    fn bounded_retries_never_widen_authority() {
        let mut orchestrator = GoalOrchestrator::new(dag(), vec![read_repo()]);
        // First attempt: rejected once (digest mismatch).
        let first = orchestrator
            .delegate_task("build", "sub_b", &[read_repo()], 1_000)
            .unwrap();
        let bad = SubagentReport {
            delegation_id: first.delegation_id.clone(),
            subagent_id: first.subagent_id.clone(),
            task_id: "build".to_owned(),
            evidence: vec![ReportedEvidence {
                label: "artifact".to_owned(),
                observation: Observation::Artifact {
                    bytes: b"wrong".to_vec(),
                },
            }],
        };
        assert!(matches!(
            orchestrator.submit_report(&bad),
            Ok(Judgment::Rejected(_))
        ));
        // Escalated re-delegation is refused: retries never widen.
        let escalated = Grant {
            action: Action::FsRead,
            selector: Selector::Prefix("workspace://ws_01".to_owned()),
        };
        assert_eq!(
            orchestrator.delegate_task("build", "sub_b", &[escalated], 1_000),
            Err(OrchestratorError::Escalation)
        );
        // The bounded rejections eventually exhaust: terminal failure.
        for attempt in 0..1 {
            let again = orchestrator
                .delegate_task(
                    "build",
                    &format!("sub_retry_{attempt}"),
                    &[read_repo()],
                    1_000,
                )
                .unwrap();
            assert!(matches!(
                orchestrator.submit_report(&report("build", &again, b"wrong again")),
                Ok(Judgment::Rejected(_))
            ));
        }
        let final_attempt = orchestrator
            .delegate_task("build", "sub_final", &[read_repo()], 1_000)
            .unwrap();
        assert!(matches!(
            orchestrator.submit_report(&report("build", &final_attempt, b"wrong again")),
            Err(OrchestratorError::Terminal)
        ));
        assert_eq!(orchestrator.state("build"), Some(TaskState::Failed));
    }

    #[test]
    fn cancellation_cascades_to_descendants_exactly_once() {
        let mut orchestrator = GoalOrchestrator::new(dag(), vec![read_repo()]);
        let build = orchestrator
            .delegate_task("build", "sub_b", &[read_repo()], 1_000)
            .unwrap();
        assert!(
            orchestrator
                .submit_report(&report("build", &build, b"built artifact"))
                .is_ok()
        );
        let test = orchestrator
            .delegate_task("test", "sub_t", &[read_repo()], 1_000)
            .unwrap();
        // Cancelling "build" takes out its descendants test and docs.
        let radius = orchestrator.cancel("build");
        assert_eq!(
            radius,
            ["build".to_owned(), "docs".to_owned(), "test".to_owned()]
                .into_iter()
                .collect()
        );
        assert_eq!(orchestrator.state("test"), Some(TaskState::Cancelled));
        assert_eq!(orchestrator.state("docs"), Some(TaskState::Cancelled));
        // Completed ancestors are not retro-cancelled; idempotent re-cancel.
        assert_eq!(orchestrator.state("build"), Some(TaskState::Cancelled));
        assert_eq!(orchestrator.cancel("build").len(), 3);
        assert!(matches!(
            orchestrator.submit_report(&report("test", &test, b"test report")),
            Err(OrchestratorError::NotReady)
        ));
    }

    #[test]
    fn missing_and_undeclared_evidence_are_rejected() {
        let mut orchestrator = GoalOrchestrator::new(dag(), vec![read_repo()]);
        let build = orchestrator
            .delegate_task("build", "sub_b", &[read_repo()], 1_000)
            .unwrap();
        // No evidence at all.
        let empty = SubagentReport {
            delegation_id: build.delegation_id.clone(),
            subagent_id: build.subagent_id.clone(),
            task_id: "build".to_owned(),
            evidence: Vec::new(),
        };
        assert_eq!(
            orchestrator.submit_report(&empty),
            Ok(Judgment::Rejected(RejectionReason::MissingEvidence))
        );
        // Evidence with an undeclared label (fresh retry cycle).
        let fresh = orchestrator
            .delegate_task("build", "sub_b", &[read_repo()], 1_000)
            .unwrap();
        let extra = SubagentReport {
            delegation_id: fresh.delegation_id.clone(),
            subagent_id: fresh.subagent_id.clone(),
            task_id: "build".to_owned(),
            evidence: vec![
                ReportedEvidence {
                    label: "artifact".to_owned(),
                    observation: Observation::Artifact {
                        bytes: b"built artifact".to_vec(),
                    },
                },
                ReportedEvidence {
                    label: "undeclared".to_owned(),
                    observation: Observation::Artifact {
                        bytes: b"extra".to_vec(),
                    },
                },
            ],
        };
        assert_eq!(
            orchestrator.submit_report(&extra),
            Ok(Judgment::Rejected(RejectionReason::UndeclaredEvidence))
        );
    }
}
