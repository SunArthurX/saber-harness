//! Evidence declaration, subagent reports and judgment (ADR-016, TM-08).

use serde::Serialize;

/// Acceptance evidence a task declares up front.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EvidenceSpec {
    /// Stable label for this evidence item.
    pub label: String,
    /// The expected evidence shape.
    pub kind: EvidenceKind,
}

/// The evidence shapes the judge can verify.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EvidenceKind {
    /// A workspace artifact must hash to this digest.
    ArtifactDigest {
        /// Expected `sha256:<64 hex>`.
        digest: String,
    },
    /// A declared command must have exited zero.
    CommandSucceeded {
        /// Canonical argv joined by spaces.
        argv: String,
    },
}

/// One reported evidence item from a subagent.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ReportedEvidence {
    /// Label matching a declared spec.
    pub label: String,
    /// The observed evidence.
    pub observation: Observation,
}

/// What the subagent observed; the judge recomputes trust from it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "observation", rename_all = "snake_case")]
pub enum Observation {
    /// The artifact content the subagent claims produced the digest.
    Artifact {
        /// Full artifact bytes as seen by the subagent.
        bytes: Vec<u8>,
    },
    /// The command exit status the subagent claims.
    Command {
        /// Canonical argv joined by spaces.
        argv: String,
        /// Claimed exit code.
        exit_code: i32,
    },
}

/// A subagent's completion report.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SubagentReport {
    /// The delegation this report answers.
    pub delegation_id: String,
    /// The subagent identity making the claim.
    pub subagent_id: String,
    /// The task it claims complete.
    pub task_id: String,
    /// The evidence items it offers.
    pub evidence: Vec<ReportedEvidence>,
}

/// Judgment verdicts with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Judgment {
    /// Evidence matched the declaration exactly.
    Verified,
    /// Evidence missing, mismatched or untrustworthy.
    Rejected(RejectionReason),
}

/// Why a report was rejected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RejectionReason {
    /// The report names another delegation.
    WrongDelegation,
    /// The reporter identity does not match the assignment (TM-08).
    ForgedIdentity,
    /// A declared evidence item was not reported.
    MissingEvidence,
    /// Evidence was reported that was never declared.
    UndeclaredEvidence,
    /// A digest or outcome did not verify against the declaration.
    EvidenceMismatch,
    /// The task is not in the delegated state.
    NotDelegated,
}

impl std::fmt::Display for RejectionReason {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::WrongDelegation => "wrong_delegation",
            Self::ForgedIdentity => "forged_identity",
            Self::MissingEvidence => "missing_evidence",
            Self::UndeclaredEvidence => "undeclared_evidence",
            Self::EvidenceMismatch => "evidence_mismatch",
            Self::NotDelegated => "not_delegated",
        })
    }
}

impl std::error::Error for RejectionReason {}

/// Judge a report against a task's declared evidence. The judge trusts
/// nothing: digests are recomputed from the reported artifact bytes, and
/// the reporter identity must equal the assignment.
#[must_use]
pub fn judge_report(
    report: &SubagentReport,
    expected_delegation_id: &str,
    expected_subagent_id: &str,
    declared: &[EvidenceSpec],
) -> Judgment {
    if report.delegation_id != expected_delegation_id {
        return Judgment::Rejected(RejectionReason::WrongDelegation);
    }
    if report.subagent_id != expected_subagent_id {
        return Judgment::Rejected(RejectionReason::ForgedIdentity);
    }
    let mut matched_labels = std::collections::BTreeSet::new();
    for spec in declared {
        let Some(observed) = report.evidence.iter().find(|item| item.label == spec.label) else {
            return Judgment::Rejected(RejectionReason::MissingEvidence);
        };
        matched_labels.insert(spec.label.clone());
        let verified = match (&spec.kind, &observed.observation) {
            (EvidenceKind::ArtifactDigest { digest }, Observation::Artifact { bytes }) => {
                artifact_digest(bytes) == *digest
            }
            (
                EvidenceKind::CommandSucceeded { argv },
                Observation::Command {
                    argv: reported_argv,
                    exit_code,
                },
            ) => argv == reported_argv && *exit_code == 0,
            // Observation shape does not match the declared evidence kind.
            _ => false,
        };
        if !verified {
            return Judgment::Rejected(RejectionReason::EvidenceMismatch);
        }
    }
    if report
        .evidence
        .iter()
        .any(|item| !matched_labels.contains(&item.label))
    {
        return Judgment::Rejected(RejectionReason::UndeclaredEvidence);
    }
    Judgment::Verified
}

/// Artifact digest with the orchestrator domain label.
#[must_use]
pub fn artifact_digest(bytes: &[u8]) -> String {
    saber_policy::sha256_label(&[b"saber-orchestrator-artifact-v1\0", bytes])
}
