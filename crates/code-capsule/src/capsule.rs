//! The typed Code Capsule envelope (ADR-018).

use saber_orchestrator::Grant;
use saber_sandbox::{BudgetSpec, Realm};
use serde::Serialize;

/// Supported capsule schema versions.
pub const CAPSULE_SCHEMA_VERSION: &str = "1.0.0";

/// One digest-pinned dependency lock.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DependencyLock {
    /// Dependency name.
    pub name: String,
    /// `sha256:<64 hex>` pin of the exact dependency content.
    pub digest: String,
}

/// The capsule envelope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CodeCapsule {
    /// Stable content-derived capsule id.
    pub capsule_id: String,
    /// Schema version; unknown versions fail closed.
    pub schema_version: String,
    /// Human-meaningful capsule name.
    pub name: String,
    /// Monotonic version within the name.
    pub version: u32,
    /// `sha256:<64 hex>` of the capsule source bytes.
    pub source_digest: String,
    /// Digest-pinned dependencies; execution may use nothing else.
    pub dependencies: Vec<DependencyLock>,
    /// Declared grants from the closed action+selector vocabulary.
    pub grants: Vec<Grant>,
    /// Target sandbox realm for execution.
    pub realm: Realm,
    /// Resource budgets the realm enforces.
    pub budget: BudgetSpec,
    /// Digest over the canonical capsule body.
    pub capsule_digest: String,
}

/// Capsule failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CapsuleError {
    /// Digest recomputation failed: tampering.
    DigestMismatch,
    /// Malformed shape (empty names, bad versions, unpinned locks).
    Malformed,
    /// Unknown schema version.
    UnknownVersion,
    /// Grants wider than the superseded version.
    Escalation,
    /// Unknown or inactive capsule/version.
    Unknown,
    /// The capsule is not promoted in the workshop.
    NotPromoted,
    /// The request exceeds the capsule's declared grants.
    UndeclaredGrant,
    /// The request uses a dependency outside the pinned locks.
    UndeclaredDependency,
    /// The capsule's budget is exhausted.
    BudgetExhausted,
}

impl std::fmt::Display for CapsuleError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::DigestMismatch => "digest_mismatch",
            Self::Malformed => "malformed",
            Self::UnknownVersion => "unknown_version",
            Self::Escalation => "escalation",
            Self::Unknown => "unknown",
            Self::NotPromoted => "not_promoted",
            Self::UndeclaredGrant => "undeclared_grant",
            Self::UndeclaredDependency => "undeclared_dependency",
            Self::BudgetExhausted => "budget_exhausted",
        })
    }
}

impl std::error::Error for CapsuleError {}

/// Digest of the capsule source bytes.
#[must_use]
pub fn source_digest_of(bytes: &[u8]) -> String {
    saber_policy::sha256_label(&[b"saber-capsule-src-v1\0", bytes])
}

/// Digest over the canonical capsule body (everything except the id and
/// digest, which derive from it).
#[must_use]
pub fn capsule_digest_of(capsule: &CodeCapsule) -> String {
    let mut body: Vec<u8> = b"saber-code-capsule-body-v1\0".to_vec();
    let push = |body: &mut Vec<u8>, bytes: &[u8]| body.extend_from_slice(bytes);
    push(&mut body, capsule.schema_version.as_bytes());
    body.push(0);
    push(&mut body, capsule.name.as_bytes());
    body.push(0);
    push(&mut body, &capsule.version.to_le_bytes());
    body.push(0);
    push(&mut body, capsule.source_digest.as_bytes());
    body.push(0);
    for dependency in &capsule.dependencies {
        push(&mut body, dependency.name.as_bytes());
        body.push(0);
        push(&mut body, dependency.digest.as_bytes());
        body.push(0);
    }
    for grant in &capsule.grants {
        let selector = match &grant.selector {
            saber_orchestrator::Selector::Exact(resource) => format!("exact:{resource}"),
            saber_orchestrator::Selector::Prefix(resource) => format!("prefix:{resource}"),
        };
        push(&mut body, format!("{:?}", grant.action).as_bytes());
        body.push(0);
        push(&mut body, selector.as_bytes());
        body.push(0);
    }
    push(&mut body, capsule.realm.as_str().as_bytes());
    body.push(0);
    push(&mut body, &capsule.budget.wall_clock_ms.to_le_bytes());
    push(&mut body, &capsule.budget.max_output_bytes.to_le_bytes());
    saber_policy::sha256_label(&[&body])
}

/// Stable capsule id.
#[must_use]
pub fn capsule_id_of(name: &str, capsule_digest: &str) -> String {
    saber_policy::sha256_label(&[
        b"saber-code-capsule-id-v1\0",
        name.as_bytes(),
        capsule_digest.as_bytes(),
    ])
}

impl CodeCapsule {
    /// Validate the whole envelope: version, shape, pinned locks and the
    /// digest chain (ADR-018).
    ///
    /// # Errors
    ///
    /// Deterministic codes per [`CapsuleError`].
    pub fn validate(&self) -> Result<(), CapsuleError> {
        if self.schema_version != CAPSULE_SCHEMA_VERSION {
            return Err(CapsuleError::UnknownVersion);
        }
        if self.name.is_empty() || self.version == 0 || self.source_digest.len() != 71 {
            return Err(CapsuleError::Malformed);
        }
        for dependency in &self.dependencies {
            if dependency.name.is_empty() || dependency.digest.len() != 71 {
                return Err(CapsuleError::Malformed);
            }
        }
        if capsule_digest_of(self) != self.capsule_digest {
            return Err(CapsuleError::DigestMismatch);
        }
        if self.capsule_id != capsule_id_of(&self.name, &self.capsule_digest) {
            return Err(CapsuleError::DigestMismatch);
        }
        Ok(())
    }

    /// Whether every grant sits within a previous version's grants —
    /// supersession may only attenuate (ADR-018).
    #[must_use]
    pub fn grants_within(&self, previous: &Self) -> bool {
        self.grants
            .iter()
            .all(|grant| previous.grants.iter().any(|parent| grant.within(parent)))
    }
}
