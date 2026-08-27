//! Remote Execution Realm (ADR-022).

use std::collections::BTreeMap;

use saber_orchestrator::Grant;
use saber_policy::{DataClass, sha256_label};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Realm failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RealmError {
    /// The envelope digest did not match: tampering in transit.
    EnvelopeTampered,
    /// The submission was malformed.
    Malformed,
    /// Unknown task.
    UnknownTask,
    /// The task already terminated; no state change possible.
    Terminal,
    /// A result arrived whose digest does not match the claim.
    ResultDigestMismatch,
    /// A stale success arrived after reaping.
    StaleSuccess,
    /// The claimed state transition is illegal.
    IllegalTransition,
}

impl std::fmt::Display for RealmError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::EnvelopeTampered => "envelope_tampered",
            Self::Malformed => "malformed",
            Self::UnknownTask => "unknown_task",
            Self::Terminal => "terminal",
            Self::ResultDigestMismatch => "result_digest_mismatch",
            Self::StaleSuccess => "stale_success",
            Self::IllegalTransition => "illegal_transition",
        })
    }
}

impl std::error::Error for RealmError {}

/// The traveling policy envelope (ADR-022): local decisions travel,
/// remote realms never re-decide.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PolicyEnvelope {
    /// The workspace the task belongs to.
    pub workspace_id: String,
    /// The granted capability (closed vocabulary).
    pub grant: Grant,
    /// Data classification of inputs.
    pub data_class: DataClass,
    /// Wall-clock budget for the remote work.
    pub deadline_ms: u64,
    /// Digest binding the canonical envelope body.
    pub envelope_digest: String,
}

/// Compute the envelope digest.
#[must_use]
pub fn envelope_digest_of(envelope: &PolicyEnvelope) -> String {
    let selector = match &envelope.grant.selector {
        saber_orchestrator::Selector::Exact(resource) => format!("exact:{resource}"),
        saber_orchestrator::Selector::Prefix(resource) => format!("prefix:{resource}"),
    };
    let mut hasher = Sha256::new();
    hasher.update(b"saber-remote-envelope-v1\0");
    hasher.update(envelope.workspace_id.as_bytes());
    hasher.update([0]);
    hasher.update(format!("{:?}", envelope.grant.action).as_bytes());
    hasher.update([0]);
    hasher.update(selector.as_bytes());
    hasher.update([0]);
    hasher.update(format!("{:?}", envelope.data_class).as_bytes());
    hasher.update([0]);
    hasher.update(envelope.deadline_ms.to_le_bytes());
    format!("sha256:{}", saber_sandbox::hex_upper(&hasher.finalize()))
}

impl PolicyEnvelope {
    /// Validate the envelope digest chain.
    ///
    /// # Errors
    ///
    /// [`RealmError::EnvelopeTampered`] on mismatch;
    /// [`RealmError::Malformed`] for empty bindings.
    pub fn validate(&self) -> Result<(), RealmError> {
        if self.workspace_id.is_empty() || self.deadline_ms == 0 {
            return Err(RealmError::Malformed);
        }
        if envelope_digest_of(self) != self.envelope_digest {
            return Err(RealmError::EnvelopeTampered);
        }
        Ok(())
    }

    /// Build an envelope with a computed digest.
    #[must_use]
    pub fn new(workspace_id: &str, grant: Grant, data_class: DataClass, deadline_ms: u64) -> Self {
        let draft = Self {
            workspace_id: workspace_id.to_owned(),
            grant,
            data_class,
            deadline_ms,
            envelope_digest: String::new(),
        };
        Self {
            envelope_digest: envelope_digest_of(&draft),
            ..draft
        }
    }
}

/// Remote task states (ADR-022).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum RemoteTaskState {
    /// Submitted, not yet leased.
    Submitted,
    /// Running under a heartbeat lease.
    Running {
        /// Heartbeat lease deadline in Unix milliseconds.
        lease_deadline_ms: u64,
    },
    /// Succeeded with verified digests.
    Succeeded,
    /// Failed (error, timeout, reaped or hostile output).
    Failed {
        /// Stable failure reason.
        reason: &'static str,
    },
    /// Cancelled by local decision.
    Cancelled,
}

/// One remote task.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RemoteTask {
    /// Stable task id.
    pub task_id: String,
    /// The validated traveling envelope.
    pub envelope: PolicyEnvelope,
    /// Current state.
    pub state: RemoteTaskState,
}

/// A result claimed by the realm.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RemoteResult {
    /// The task the result belongs to.
    pub task_id: String,
    /// Claimed artifact digest.
    pub artifact_digest: String,
    /// The artifact bytes as received (evidence, verified by digest).
    pub artifact: Vec<u8>,
    /// Claimed exit code.
    pub exit_code: i32,
}

/// Heartbeat lease window.
pub const LEASE_WINDOW_MS: u64 = 60_000;

/// The realm coordinator: a pure state machine over remote tasks
/// (ADR-022). Transport/IO are outside; everything here is
/// deterministic.
#[derive(Default)]
pub struct RealmCoordinator {
    tasks: BTreeMap<String, RemoteTask>,
}

impl RealmCoordinator {
    /// Submit a task under a validated envelope.
    ///
    /// # Errors
    ///
    /// Envelope validation failures propagate.
    pub fn submit(&mut self, envelope: PolicyEnvelope) -> Result<String, RealmError> {
        envelope.validate()?;
        let task_id = sha256_label(&[
            b"saber-remote-task-v1\0",
            envelope.envelope_digest.as_bytes(),
        ]);
        self.tasks.insert(
            task_id.clone(),
            RemoteTask {
                task_id: task_id.clone(),
                envelope,
                state: RemoteTaskState::Submitted,
            },
        );
        Ok(task_id)
    }

    /// Lease (start running) a submitted task.
    ///
    /// # Errors
    ///
    /// [`RealmError::IllegalTransition`] unless `Submitted`.
    pub fn lease(&mut self, task_id: &str, now_ms: u64) -> Result<(), RealmError> {
        let task = self.task_mut(task_id)?;
        if !matches!(task.state, RemoteTaskState::Submitted) {
            return Err(RealmError::IllegalTransition);
        }
        task.state = RemoteTaskState::Running {
            lease_deadline_ms: now_ms + LEASE_WINDOW_MS,
        };
        Ok(())
    }

    /// Renew a running task's heartbeat lease.
    ///
    /// # Errors
    ///
    /// [`RealmError::IllegalTransition`] unless running and unexpired.
    pub fn heartbeat(&mut self, task_id: &str, now_ms: u64) -> Result<(), RealmError> {
        let task = self.task_mut(task_id)?;
        match task.state {
            RemoteTaskState::Running { lease_deadline_ms } => {
                if now_ms > lease_deadline_ms {
                    // The realm was already gone; a late heartbeat cannot
                    // resurrect it (it will be reaped by reap_expired).
                    return Err(RealmError::IllegalTransition);
                }
                task.state = RemoteTaskState::Running {
                    lease_deadline_ms: now_ms + LEASE_WINDOW_MS,
                };
                Ok(())
            }
            _ => Err(RealmError::IllegalTransition),
        }
    }

    /// Reap expired leases: crashed realms can never report success
    /// (ADR-022).
    pub fn reap_expired(&mut self, now_ms: u64) -> Vec<String> {
        let mut reaped = Vec::new();
        for (task_id, task) in &mut self.tasks {
            if let RemoteTaskState::Running { lease_deadline_ms } = task.state
                && now_ms > lease_deadline_ms
            {
                task.state = RemoteTaskState::Failed {
                    reason: "lease_expired",
                };
                reaped.push(task_id.clone());
            }
        }
        reaped
    }

    /// Admit a result: digest must match, the task must be running, and
    /// a stale success for a reaped task is refused. Returns the
    /// taint-labeled admission.
    ///
    /// # Errors
    ///
    /// Deterministic codes per [`RealmError`].
    pub fn admit_result(
        &mut self,
        result: &RemoteResult,
        now_ms: u64,
    ) -> Result<AdmittedResult, RealmError> {
        let task = self.task_mut(&result.task_id)?;
        match &task.state {
            RemoteTaskState::Running { lease_deadline_ms } => {
                if now_ms > *lease_deadline_ms {
                    task.state = RemoteTaskState::Failed {
                        reason: "lease_expired",
                    };
                    return Err(RealmError::StaleSuccess);
                }
            }
            RemoteTaskState::Failed { .. } => return Err(RealmError::StaleSuccess),
            _ => return Err(RealmError::IllegalTransition),
        }
        if result.exit_code != 0 {
            task.state = RemoteTaskState::Failed {
                reason: "nonzero_exit",
            };
            return Err(RealmError::IllegalTransition);
        }
        let actual = artifact_digest_of(&result.artifact);
        if actual != result.artifact_digest {
            // Digest mismatch is containment, not task failure: the realm
            // may retry with honest bytes (ADR-022 conservative reaping).
            return Err(RealmError::ResultDigestMismatch);
        }
        task.state = RemoteTaskState::Succeeded;
        Ok(AdmittedResult {
            task_id: result.task_id.clone(),
            artifact_digest: result.artifact_digest.clone(),
            taint: saber_egress::TaintKind::UntrustedSource,
        })
    }

    /// Cancel a task; cancellation is deterministic and terminal.
    ///
    /// # Errors
    ///
    /// Fails with an unknown-task or already-terminal error.
    pub fn cancel(&mut self, task_id: &str) -> Result<(), RealmError> {
        let task = self.task_mut(task_id)?;
        if matches!(
            task.state,
            RemoteTaskState::Succeeded
                | RemoteTaskState::Failed { .. }
                | RemoteTaskState::Cancelled
        ) {
            return Err(RealmError::Terminal);
        }
        task.state = RemoteTaskState::Cancelled;
        Ok(())
    }

    /// One task's state.
    #[must_use]
    pub fn task(&self, task_id: &str) -> Option<&RemoteTask> {
        self.tasks.get(task_id)
    }

    /// Whether any task is running in a given remote cell (cell =
    /// lease holder label derived from the task id prefix).
    #[must_use]
    pub fn running_count(&self) -> usize {
        self.tasks
            .values()
            .filter(|task| matches!(task.state, RemoteTaskState::Running { .. }))
            .count()
    }

    fn task_mut(&mut self, task_id: &str) -> Result<&mut RemoteTask, RealmError> {
        self.tasks.get_mut(task_id).ok_or(RealmError::UnknownTask)
    }
}

/// Digest of artifact bytes.
#[must_use]
pub fn artifact_digest_of(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"saber-remote-artifact-v1\0");
    hasher.update(bytes);
    format!("sha256:{}", saber_sandbox::hex_upper(&hasher.finalize()))
}

/// An admitted, taint-labeled remote result (INV-02 parity).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AdmittedResult {
    /// The task.
    pub task_id: String,
    /// Verified artifact digest.
    pub artifact_digest: String,
    /// Returned data is untrusted until locally verified.
    pub taint: saber_egress::TaintKind,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use saber_orchestrator::{Grant, Selector};
    use saber_policy::Action;

    use super::*;

    fn envelope() -> PolicyEnvelope {
        PolicyEnvelope::new(
            "ws_01",
            Grant {
                action: Action::ProcessSpawn,
                selector: Selector::Prefix("process://ws_01".to_owned()),
            },
            DataClass::Internal,
            3_600_000,
        )
    }

    fn result(task_id: &str, artifact: &[u8]) -> RemoteResult {
        RemoteResult {
            task_id: task_id.to_owned(),
            artifact_digest: artifact_digest_of(artifact),
            artifact: artifact.to_vec(),
            exit_code: 0,
        }
    }

    #[test]
    fn policy_envelopes_travel_and_tampering_is_detected() {
        let envelope = super::tests::envelope();
        envelope.validate().unwrap();
        // Same inputs, same envelope: deterministic.
        assert_eq!(
            envelope_digest_of(&super::tests::envelope()),
            envelope.envelope_digest
        );
        // Any field change breaks the digest.
        let mut tampered = super::tests::envelope();
        tampered.deadline_ms += 1;
        assert_eq!(tampered.validate(), Err(RealmError::EnvelopeTampered));
        let mut escalated = super::tests::envelope();
        escalated.grant = Grant {
            action: Action::ProcessSpawn,
            selector: Selector::Prefix("process://".to_owned()),
        };
        assert_eq!(escalated.validate(), Err(RealmError::EnvelopeTampered));
    }

    #[test]
    fn state_machine_is_deterministic_and_refuses_skips() {
        let mut realm = RealmCoordinator::default();
        let task_id = realm.submit(envelope()).unwrap();
        // Results cannot arrive before leasing.
        assert_eq!(
            realm.admit_result(&result(&task_id, b"x"), 1_000),
            Err(RealmError::IllegalTransition)
        );
        realm.lease(&task_id, 1_000).unwrap();
        // Double lease refused.
        assert_eq!(
            realm.lease(&task_id, 1_001),
            Err(RealmError::IllegalTransition)
        );
        // Heartbeats renew within the lease.
        realm.heartbeat(&task_id, 2_000).unwrap();
        let admitted = realm
            .admit_result(&result(&task_id, b"built"), 3_000)
            .unwrap();
        assert_eq!(admitted.task_id, task_id);
        // Succeeded is terminal.
        assert_eq!(
            realm.admit_result(&result(&task_id, b"again"), 3_001),
            Err(RealmError::IllegalTransition)
        );
    }

    #[test]
    fn crashed_realms_never_report_success_and_stale_success_refused() {
        let mut realm = RealmCoordinator::default();
        let task_id = realm.submit(envelope()).unwrap();
        realm.lease(&task_id, 1_000).unwrap();
        // The realm crashes; the lease expires and reaping fails the task.
        let reaped = realm.reap_expired(1_000 + LEASE_WINDOW_MS + 1);
        assert_eq!(reaped, vec![task_id.clone()]);
        // A late success claim is refused outright.
        assert_eq!(
            realm.admit_result(
                &result(&task_id, b"honest bytes"),
                1_000 + LEASE_WINDOW_MS + 2
            ),
            Err(RealmError::StaleSuccess)
        );
        // A late heartbeat cannot resurrect the reaped task.
        assert_eq!(
            realm.heartbeat(&task_id, 1_000 + LEASE_WINDOW_MS + 3),
            Err(RealmError::IllegalTransition)
        );
    }

    #[test]
    fn results_without_matching_digests_are_refused() {
        let mut realm = RealmCoordinator::default();
        let task_id = realm.submit(envelope()).unwrap();
        realm.lease(&task_id, 1_000).unwrap();
        let mut forged = result(&task_id, b"claimed bytes");
        forged.artifact = b"different bytes".to_vec();
        assert_eq!(
            realm.admit_result(&forged, 2_000),
            Err(RealmError::ResultDigestMismatch)
        );
        // Nonzero exit fails the task terminally.
        let mut failed = result(&task_id, b"x");
        failed.exit_code = 1;
        assert_eq!(
            realm.admit_result(&failed, 2_001),
            Err(RealmError::IllegalTransition)
        );
        assert!(matches!(
            realm.task(&task_id).unwrap().state,
            RemoteTaskState::Failed { .. }
        ));
    }

    #[test]
    fn returned_data_is_taint_labeled_for_admission() {
        let mut realm = RealmCoordinator::default();
        let task_id = realm.submit(envelope()).unwrap();
        realm.lease(&task_id, 1_000).unwrap();
        let admitted = realm
            .admit_result(&result(&task_id, b"artifact"), 2_000)
            .unwrap();
        assert_eq!(admitted.taint, saber_egress::TaintKind::UntrustedSource);
        assert_eq!(admitted.artifact_digest, artifact_digest_of(b"artifact"));
    }

    #[test]
    fn remote_faults_stay_in_their_cell() {
        let mut realm = RealmCoordinator::default();
        let mut distinct = envelope();
        distinct.deadline_ms = 1_800_000;
        distinct.envelope_digest = envelope_digest_of(&distinct);
        let a = realm.submit(envelope()).unwrap();
        let b = realm.submit(distinct).unwrap();
        assert_ne!(a, b, "distinct envelopes produce distinct tasks");
        realm.lease(&a, 1_000).unwrap();
        realm.lease(&b, 10_000_000).unwrap();
        // One cell's lease expires; the sibling keeps running.
        let reaped = realm.reap_expired(1_000 + LEASE_WINDOW_MS + 1);
        assert_eq!(reaped, vec![a.clone()], "only the expired cell is reaped");
        assert_eq!(realm.running_count(), 1);
        // The sibling still succeeds normally.
        let admitted = realm.admit_result(&result(&b, b"ok"), 10_050_000).unwrap();
        assert_eq!(admitted.task_id, b);
    }

    #[test]
    fn cancellation_propagates_deterministically() {
        let mut realm = RealmCoordinator::default();
        let task_id = realm.submit(envelope()).unwrap();
        realm.lease(&task_id, 1_000).unwrap();
        realm.cancel(&task_id).unwrap();
        assert!(matches!(
            realm.task(&task_id).unwrap().state,
            RemoteTaskState::Cancelled
        ));
        // Cancelled tasks accept no results and no double cancel.
        assert_eq!(
            realm.admit_result(&result(&task_id, b"x"), 2_000),
            Err(RealmError::IllegalTransition)
        );
        assert_eq!(realm.cancel(&task_id), Err(RealmError::Terminal));
        // Tampered envelopes never submit at all.
        let mut evil = super::tests::envelope();
        evil.data_class = DataClass::Restricted;
        assert_eq!(realm.submit(evil), Err(RealmError::EnvelopeTampered));
    }
}
