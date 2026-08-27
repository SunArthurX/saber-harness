//! Capsule creation from authoritative facts, verification with drift
//! reconcile, and continuation semantics (ADR-015).

use crate::capsule::{
    ArtifactRef, CAPSULE_SCHEMA_VERSION, CapsuleError, ResumptionCapsule, TaskLink,
    capsule_digest_of, capsule_id_for, fingerprint_of_inventory,
};
use serde::Serialize;

/// Authoritative facts supplied by the durable event store. The builder
/// refuses missing facts rather than inventing state (ADR-015).
#[derive(Clone, Debug)]
pub struct CapsuleFacts {
    /// Owning tenant.
    pub tenant: String,
    /// Owning workspace.
    pub workspace: String,
    /// Goal the lineage serves.
    pub goal_id: String,
    /// Ordered task lineage from the store.
    pub lineage: Vec<TaskLink>,
    /// Artifact references with digests computed by the store.
    pub artifacts: Vec<ArtifactRef>,
    /// Decision pointers from the store.
    pub decision_ids: Vec<String>,
    /// Workspace inventory (path, digest) at creation time.
    pub inventory: Vec<(String, String)>,
    /// Creation time in Unix milliseconds.
    pub created_at_ms: u64,
}

/// Build a capsule from complete facts. Nothing is invented: missing
/// identifiers or an empty lineage fail closed.
///
/// # Errors
///
/// [`CapsuleError::Malformed`] for incomplete facts.
pub fn capsule_from_facts(facts: &CapsuleFacts) -> Result<ResumptionCapsule, CapsuleError> {
    if facts.tenant.is_empty()
        || facts.workspace.is_empty()
        || facts.goal_id.is_empty()
        || facts.lineage.is_empty()
        || facts
            .lineage
            .iter()
            .any(|link| link.task_id.is_empty() || link.state.is_empty())
        || facts.artifacts.iter().any(|artifact| {
            artifact.path.is_empty() || !artifact.content_digest.starts_with("sha256:")
        })
        || facts.created_at_ms == 0
    {
        return Err(CapsuleError::Malformed);
    }
    let workspace_fingerprint = fingerprint_of_inventory(&facts.inventory);
    let draft = ResumptionCapsule {
        capsule_id: String::new(),
        schema_version: CAPSULE_SCHEMA_VERSION.to_owned(),
        tenant: facts.tenant.clone(),
        workspace: facts.workspace.clone(),
        goal_id: facts.goal_id.clone(),
        lineage: facts.lineage.clone(),
        artifacts: facts.artifacts.clone(),
        decision_ids: facts.decision_ids.clone(),
        workspace_fingerprint,
        created_at_ms: facts.created_at_ms,
        capsule_digest: String::new(),
    };
    let capsule_digest = capsule_digest_of(&draft);
    let capsule = ResumptionCapsule {
        capsule_id: capsule_id_for(
            &facts.tenant,
            &facts.workspace,
            &facts.goal_id,
            &capsule_digest,
        ),
        capsule_digest,
        ..draft
    };
    capsule.validate()?;
    Ok(capsule)
}

/// One observed drift item at verification time.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "drift", rename_all = "snake_case")]
pub enum DriftItem {
    /// A referenced artifact is missing.
    ArtifactMissing {
        /// Artifact path.
        path: String,
    },
    /// A referenced artifact's content changed.
    ArtifactMutated {
        /// Artifact path.
        path: String,
        /// Digest recorded in the capsule.
        expected: String,
        /// Digest observed now.
        observed: String,
    },
    /// The workspace fingerprint changed overall.
    FingerprintChanged {
        /// Fingerprint recorded in the capsule.
        expected: String,
        /// Fingerprint observed now.
        observed: String,
    },
}

/// Verification outcome state.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationState {
    /// Capsule verified and the environment matches: safe to continue.
    Ready,
    /// Drift detected: explicit reconciliation required before continuing.
    NeedsReconcile,
}

/// The full verification report.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CapsuleVerification {
    /// Verified capsule id.
    pub capsule_id: String,
    /// Outcome state.
    pub state: VerificationState,
    /// Observed drift items (empty when Ready).
    pub drift: Vec<DriftItem>,
}

/// The present environment against which a capsule is verified.
#[derive(Clone, Debug)]
pub struct PresentEnvironment {
    /// Resumer tenant.
    pub tenant: String,
    /// Resumer workspace.
    pub workspace: String,
    /// Current artifact contents by workspace-relative path.
    pub artifacts: Vec<(String, Vec<u8>)>,
    /// Current workspace inventory (path, digest).
    pub inventory: Vec<(String, String)>,
}

/// Verify a capsule against the present environment: digest chain, scope,
/// artifact contents and workspace fingerprint. Drift yields
/// `NeedsReconcile` with evidence — never a silent continue.
///
/// # Errors
///
/// [`CapsuleError`] for tampered capsules, unknown versions and
/// cross-workscope injection; environmental drift is NOT an error, it is
/// the `NeedsReconcile` state.
pub fn verify_capsule(
    capsule: &ResumptionCapsule,
    environment: &PresentEnvironment,
) -> Result<CapsuleVerification, CapsuleError> {
    capsule.validate()?;
    if capsule.tenant != environment.tenant || capsule.workspace != environment.workspace {
        return Err(CapsuleError::CrossWorkspace);
    }
    let mut drift = Vec::new();
    for reference in &capsule.artifacts {
        let observed = environment
            .artifacts
            .iter()
            .find(|(path, _)| path == &reference.path);
        match observed {
            None => drift.push(DriftItem::ArtifactMissing {
                path: reference.path.clone(),
            }),
            Some((_, bytes)) => {
                // Artifact digests use the capsule-artifact domain label,
                // shared with the fact source via artifact_digest_of.
                let observed_digest = crate::capsule::digest_of(b"saber-capsule-artifact", bytes);
                if observed_digest != reference.content_digest {
                    drift.push(DriftItem::ArtifactMutated {
                        path: reference.path.clone(),
                        expected: reference.content_digest.clone(),
                        observed: observed_digest,
                    });
                }
            }
        }
    }
    let observed_fingerprint = fingerprint_of_inventory(&environment.inventory);
    if observed_fingerprint != capsule.workspace_fingerprint {
        drift.push(DriftItem::FingerprintChanged {
            expected: capsule.workspace_fingerprint.clone(),
            observed: observed_fingerprint,
        });
    }
    let state = if drift.is_empty() {
        VerificationState::Ready
    } else {
        VerificationState::NeedsReconcile
    };
    Ok(CapsuleVerification {
        capsule_id: capsule.capsule_id.clone(),
        state,
        drift,
    })
}

/// The continuation handed to a successor task. Lineage is verbatim:
/// nothing is truncated, extended or paraphrased (ADR-015).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct Continuation {
    /// Verified capsule id.
    pub capsule_id: String,
    /// Goal the continuation serves.
    pub goal_id: String,
    /// Recorded task lineage, verbatim.
    pub lineage: Vec<TaskLink>,
    /// Content-addressed artifact references.
    pub artifacts: Vec<ArtifactRef>,
    /// Decision pointers.
    pub decision_ids: Vec<String>,
}

/// Continue from a capsule. Allowed only when verification is `Ready`;
/// a drifted environment must reconcile first.
///
/// # Errors
///
/// [`CapsuleError::Malformed`] when verification is not `Ready` — callers
/// surface the drift evidence from the verification report.
pub fn continue_from(
    capsule: &ResumptionCapsule,
    verification: &CapsuleVerification,
) -> Result<Continuation, CapsuleError> {
    if verification.state != VerificationState::Ready {
        return Err(CapsuleError::Malformed);
    }
    if verification.capsule_id != capsule.capsule_id {
        return Err(CapsuleError::DigestMismatch);
    }
    Ok(Continuation {
        capsule_id: capsule.capsule_id.clone(),
        goal_id: capsule.goal_id.clone(),
        lineage: capsule.lineage.clone(),
        artifacts: capsule.artifacts.clone(),
        decision_ids: capsule.decision_ids.clone(),
    })
}

/// Digest helper for artifact contents at capsule creation, exposed so the
/// fact source and the verifier agree on the domain label.
#[must_use]
pub fn artifact_digest_of(bytes: &[u8]) -> String {
    crate::capsule::digest_of(b"saber-capsule-artifact", bytes)
}
