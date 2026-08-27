//! Verifiable Resumption Capsule (ADR-015).

use serde::{Deserialize, Serialize};

/// Supported capsule schema versions.
pub const CAPSULE_SCHEMA_VERSION: &str = "1.0.0";

/// One task in the recorded lineage.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TaskLink {
    /// Task identifier from the authoritative facts.
    pub task_id: String,
    /// Recorded terminal state.
    pub state: String,
}

/// One content-addressed artifact reference.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ArtifactRef {
    /// Workspace-relative artifact path.
    pub path: String,
    /// `sha256:<64 hex>` of the artifact content at capsule creation.
    pub content_digest: String,
}

/// The capsule envelope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ResumptionCapsule {
    /// Stable content-derived capsule identifier.
    pub capsule_id: String,
    /// Schema version; unknown versions fail closed.
    pub schema_version: String,
    /// Owning tenant.
    pub tenant: String,
    /// Owning workspace.
    pub workspace: String,
    /// Goal the lineage serves.
    pub goal_id: String,
    /// Ordered task lineage.
    pub lineage: Vec<TaskLink>,
    /// Content-addressed artifact references.
    pub artifacts: Vec<ArtifactRef>,
    /// Decision pointers from the authoritative store.
    pub decision_ids: Vec<String>,
    /// Workspace fingerprint (sorted path+digest inventory digest) at
    /// creation.
    pub workspace_fingerprint: String,
    /// Creation time in Unix milliseconds.
    pub created_at_ms: u64,
    /// Digest over the canonical capsule body.
    pub capsule_digest: String,
}

/// Capsule failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CapsuleError {
    /// Unknown schema version.
    UnknownVersion,
    /// The capsule digest does not match its recomputation.
    DigestMismatch,
    /// Facts or shape were incomplete/malformed.
    Malformed,
    /// The capsule targets a foreign scope.
    CrossWorkspace,
}

impl std::fmt::Display for CapsuleError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::UnknownVersion => "unknown_version",
            Self::DigestMismatch => "digest_mismatch",
            Self::Malformed => "malformed",
            Self::CrossWorkspace => "cross_workspace",
        })
    }
}

impl std::error::Error for CapsuleError {}

/// Digest of arbitrary bytes with a domain label.
#[must_use]
pub fn digest_of(label: &[u8], bytes: &[u8]) -> String {
    saber_policy::sha256_label(&[label, b"\0", bytes])
}

/// Workspace fingerprint: digest over a sorted (path, content-digest)
/// inventory. Pure: callers supply the inventory.
#[must_use]
pub fn fingerprint_of_inventory(inventory: &[(String, String)]) -> String {
    let mut sorted: Vec<&(String, String)> = inventory.iter().collect();
    sorted.sort();
    let mut body = String::new();
    for (path, digest) in sorted {
        body.push_str(path);
        body.push('\0');
        body.push_str(digest);
        body.push('\0');
    }
    digest_of(b"saber-capsule-fingerprint-v1", body.as_bytes())
}

/// Capsule id derived from scope, goal and capsule digest.
#[must_use]
pub fn capsule_id_for(
    tenant: &str,
    workspace: &str,
    goal_id: &str,
    capsule_digest: &str,
) -> String {
    saber_policy::sha256_label(&[
        b"saber-capsule-id-v1\0",
        tenant.as_bytes(),
        workspace.as_bytes(),
        goal_id.as_bytes(),
        capsule_digest.as_bytes(),
    ])
}

/// Digest over the canonical capsule body (everything except the digest
/// itself and the id, which derive from it).
#[must_use]
pub fn capsule_digest_of(capsule: &ResumptionCapsule) -> String {
    let mut body: Vec<u8> = b"saber-capsule-body-v1\0".to_vec();
    let push = |body: &mut Vec<u8>, bytes: &[u8]| body.extend_from_slice(bytes);
    push(&mut body, capsule.schema_version.as_bytes());
    body.push(0);
    push(&mut body, capsule.tenant.as_bytes());
    body.push(0);
    push(&mut body, capsule.workspace.as_bytes());
    body.push(0);
    push(&mut body, capsule.goal_id.as_bytes());
    body.push(0);
    for link in &capsule.lineage {
        push(&mut body, link.task_id.as_bytes());
        body.push(0);
        push(&mut body, link.state.as_bytes());
        body.push(0);
    }
    for artifact in &capsule.artifacts {
        push(&mut body, artifact.path.as_bytes());
        body.push(0);
        push(&mut body, artifact.content_digest.as_bytes());
        body.push(0);
    }
    for decision in &capsule.decision_ids {
        push(&mut body, decision.as_bytes());
        body.push(0);
    }
    push(&mut body, capsule.workspace_fingerprint.as_bytes());
    body.push(0);
    push(&mut body, &capsule.created_at_ms.to_le_bytes());
    digest_of(b"saber-capsule-digest", &body)
}

impl ResumptionCapsule {
    /// Validate the capsule's own digest chain and shape.
    ///
    /// # Errors
    ///
    /// Deterministic codes per [`CapsuleError`].
    pub fn validate(&self) -> Result<(), CapsuleError> {
        if self.schema_version != CAPSULE_SCHEMA_VERSION {
            return Err(CapsuleError::UnknownVersion);
        }
        if self.tenant.is_empty()
            || self.workspace.is_empty()
            || self.goal_id.is_empty()
            || self.lineage.is_empty()
        {
            return Err(CapsuleError::Malformed);
        }
        if capsule_digest_of(self) != self.capsule_digest {
            return Err(CapsuleError::DigestMismatch);
        }
        if self.capsule_id
            != capsule_id_for(
                &self.tenant,
                &self.workspace,
                &self.goal_id,
                &self.capsule_digest,
            )
        {
            return Err(CapsuleError::DigestMismatch);
        }
        Ok(())
    }
}
