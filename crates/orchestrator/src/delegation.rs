//! Attenuated capability delegation (ADR-016).

use saber_policy::Action;
use serde::{Deserialize, Serialize};

/// A resource selector: exact or prefix.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "match", content = "resource", rename_all = "snake_case")]
pub enum Selector {
    /// Matches exactly this resource.
    Exact(String),
    /// Matches this resource and its descendants.
    Prefix(String),
}

impl Selector {
    /// Whether `self` selects a subset of `parent`'s selections.
    #[must_use]
    pub fn within(&self, parent: &Self) -> bool {
        match (self, parent) {
            // Exact and prefix children are both within a prefix parent
            // when they fall under it; a prefix child is broader than an
            // exact parent and therefore never within it.
            (Self::Exact(child) | Self::Prefix(child), Self::Prefix(parent_resource)) => {
                falls_within(child, parent_resource)
            }
            (Self::Exact(child), Self::Exact(parent_resource)) => child == parent_resource,
            (Self::Prefix(_), Self::Exact(_)) => false,
        }
    }

    /// Whether this selector covers one concrete resource string.
    #[must_use]
    pub fn covers(&self, resource: &str) -> bool {
        match self {
            Self::Exact(exact) => exact == resource,
            Self::Prefix(prefix) => falls_within(resource, prefix),
        }
    }
}

/// One capability grant: an action plus a resource selector.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Grant {
    /// Closed-vocabulary action.
    pub action: Action,
    /// Resource selector.
    pub selector: Selector,
}

impl Grant {
    /// Whether this grant is within (no broader than) a parent grant.
    #[must_use]
    pub fn within(&self, parent: &Self) -> bool {
        self.action == parent.action && self.selector.within(&parent.selector)
    }

    /// Whether this grant covers one concrete request.
    #[must_use]
    pub fn covers(&self, action: Action, resource: &str) -> bool {
        self.action == action && self.selector.covers(resource)
    }
}

/// Delegation failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DelegationError {
    /// A requested grant is not within the parent authority.
    Escalation,
    /// The request or budget was malformed.
    Malformed,
}

impl std::fmt::Display for DelegationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Escalation => "escalation",
            Self::Malformed => "malformed",
        })
    }
}

impl std::error::Error for DelegationError {}

/// One live delegation to a subagent.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct Delegation {
    /// Stable delegation identifier.
    pub delegation_id: String,
    /// The delegated task.
    pub task_id: String,
    /// The assigned subagent identity (reports must match it, TM-08).
    pub subagent_id: String,
    /// Attenuated grants (strictly within the parent's).
    pub grants: Vec<Grant>,
    /// Token budget for this delegation.
    pub budget_tokens: u64,
    /// Retry budget.
    pub retries_remaining: u32,
}

/// Maximum automatic retry rejections per task.
pub const MAX_RETRIES: u32 = 3;

/// Issue an attenuated delegation. Every requested grant must sit within
/// the parent authority; retries re-derive from the parent so a delegation
/// can never come back wider.
///
/// # Errors
///
/// [`DelegationError::Escalation`] when a request exceeds the parent;
/// [`DelegationError::Malformed`] for empty ids or zero budgets.
pub fn delegate(
    parent_grants: &[Grant],
    task_id: &str,
    subagent_id: &str,
    requested: &[Grant],
    budget_tokens: u64,
    retries_remaining: u32,
) -> Result<Delegation, DelegationError> {
    if task_id.is_empty() || subagent_id.is_empty() || budget_tokens == 0 {
        return Err(DelegationError::Malformed);
    }
    for grant in requested {
        if !parent_grants.iter().any(|parent| grant.within(parent)) {
            return Err(DelegationError::Escalation);
        }
    }
    Ok(Delegation {
        delegation_id: saber_policy::sha256_label(&[
            b"saber-delegation-v1\0",
            task_id.as_bytes(),
            subagent_id.as_bytes(),
        ]),
        task_id: task_id.to_owned(),
        subagent_id: subagent_id.to_owned(),
        grants: requested.to_vec(),
        budget_tokens,
        retries_remaining,
    })
}

fn falls_within(child: &str, parent: &str) -> bool {
    child == parent || child.starts_with(&format!("{parent}/"))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;

    fn read_repo() -> Grant {
        Grant {
            action: Action::FsRead,
            selector: Selector::Prefix("workspace://ws_01/repo".to_owned()),
        }
    }

    #[test]
    fn delegation_only_attenuates() {
        // A narrower selector within the parent is issuable.
        let narrow = Grant {
            action: Action::FsRead,
            selector: Selector::Exact("workspace://ws_01/repo/src".to_owned()),
        };
        assert!(
            delegate(
                &[read_repo()],
                "task_01",
                "sub_01",
                std::slice::from_ref(&narrow),
                1_000,
                MAX_RETRIES
            )
            .is_ok()
        );

        // A broader selector is an escalation.
        let broad = Grant {
            action: Action::FsRead,
            selector: Selector::Prefix("workspace://ws_01".to_owned()),
        };
        assert_eq!(
            delegate(
                &[read_repo()],
                "task_01",
                "sub_01",
                &[broad],
                1_000,
                MAX_RETRIES
            ),
            Err(DelegationError::Escalation)
        );

        // A different action is an escalation even with the same selector.
        let write = Grant {
            action: Action::FsWrite,
            selector: Selector::Exact("workspace://ws_01/repo/src".to_owned()),
        };
        assert_eq!(
            delegate(
                &[read_repo()],
                "task_01",
                "sub_01",
                &[write],
                1_000,
                MAX_RETRIES
            ),
            Err(DelegationError::Escalation)
        );
    }

    #[test]
    fn selectors_cover_and_narrow_correctly() {
        let repo = Selector::Prefix("workspace://ws_01/repo".to_owned());
        assert!(repo.covers("workspace://ws_01/repo"));
        assert!(repo.covers("workspace://ws_01/repo/src/lib.rs"));
        assert!(!repo.covers("workspace://ws_01/other"));
        assert!(Selector::Exact("workspace://ws_01/repo".to_owned()).within(&repo));
        assert!(!repo.within(&Selector::Exact("workspace://ws_01/repo".to_owned())));
        assert!(!Selector::Prefix("workspace://ws_01".to_owned()).within(&repo));
    }
}
