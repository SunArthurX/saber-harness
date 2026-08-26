//! Canonical capability vocabulary and resource grammar.

use std::fmt::{Display, Formatter};
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::PolicyError;

/// A closed side-effect action understood by the trusted policy boundary.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[repr(usize)]
pub enum Action {
    /// Read workspace content.
    #[serde(rename = "fs.read")]
    FsRead,
    /// Create or change workspace content.
    #[serde(rename = "fs.write")]
    FsWrite,
    /// Delete workspace content.
    #[serde(rename = "fs.delete")]
    FsDelete,
    /// Start a process.
    #[serde(rename = "process.spawn")]
    ProcessSpawn,
    /// Signal an existing process.
    #[serde(rename = "process.signal")]
    ProcessSignal,
    /// Make an HTTP request.
    #[serde(rename = "network.http")]
    NetworkHttp,
    /// Open a raw network connection.
    #[serde(rename = "network.raw")]
    NetworkRaw,
    /// Listen for network connections.
    #[serde(rename = "network.listen")]
    NetworkListen,
    /// Use a credential through the secret broker.
    #[serde(rename = "secret.use")]
    SecretUse,
    /// Control a browser session.
    #[serde(rename = "browser.control")]
    BrowserControl,
    /// Create a Git commit.
    #[serde(rename = "git.commit")]
    GitCommit,
    /// Push Git objects or refs.
    #[serde(rename = "git.push")]
    GitPush,
    /// Force-update a Git ref.
    #[serde(rename = "git.force")]
    GitForce,
    /// Deploy to a cloud target.
    #[serde(rename = "cloud.deploy")]
    CloudDeploy,
    /// Read from an external agent or service.
    #[serde(rename = "external.read")]
    ExternalRead,
    /// Mutate an external agent or service.
    #[serde(rename = "external.write")]
    ExternalWrite,
    /// Install a plugin package.
    #[serde(rename = "plugin.install")]
    PluginInstall,
    /// Publish a governed capability generation.
    #[serde(rename = "capability.publish")]
    CapabilityPublish,
    /// Propose a change to Saber itself.
    #[serde(rename = "self.propose-change")]
    SelfProposeChange,
}

/// Every action in stable vocabulary order.
pub const ALL_ACTIONS: [Action; 19] = [
    Action::FsRead,
    Action::FsWrite,
    Action::FsDelete,
    Action::ProcessSpawn,
    Action::ProcessSignal,
    Action::NetworkHttp,
    Action::NetworkRaw,
    Action::NetworkListen,
    Action::SecretUse,
    Action::BrowserControl,
    Action::GitCommit,
    Action::GitPush,
    Action::GitForce,
    Action::CloudDeploy,
    Action::ExternalRead,
    Action::ExternalWrite,
    Action::PluginInstall,
    Action::CapabilityPublish,
    Action::SelfProposeChange,
];

impl Action {
    /// Stable dotted action name shared by manifests, policy, approval UI and audit.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::FsRead => "fs.read",
            Self::FsWrite => "fs.write",
            Self::FsDelete => "fs.delete",
            Self::ProcessSpawn => "process.spawn",
            Self::ProcessSignal => "process.signal",
            Self::NetworkHttp => "network.http",
            Self::NetworkRaw => "network.raw",
            Self::NetworkListen => "network.listen",
            Self::SecretUse => "secret.use",
            Self::BrowserControl => "browser.control",
            Self::GitCommit => "git.commit",
            Self::GitPush => "git.push",
            Self::GitForce => "git.force",
            Self::CloudDeploy => "cloud.deploy",
            Self::ExternalRead => "external.read",
            Self::ExternalWrite => "external.write",
            Self::PluginInstall => "plugin.install",
            Self::CapabilityPublish => "capability.publish",
            Self::SelfProposeChange => "self.propose-change",
        }
    }

    /// Frozen metadata for this action.
    #[must_use]
    pub const fn descriptor(self) -> ActionDescriptor {
        ACTION_DESCRIPTORS[self as usize]
    }
}

impl Display for Action {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for Action {
    type Err = PolicyError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        ALL_ACTIONS
            .into_iter()
            .find(|action| action.as_str() == value)
            .ok_or(PolicyError::UnknownAction)
    }
}

/// Stable risk class used by approval and UI policy.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskClass {
    /// Read-only or otherwise bounded local behavior.
    Low,
    /// A reversible workspace mutation.
    Moderate,
    /// A consequential host, network or external mutation.
    High,
    /// Credential, force, deployment, supply-chain or self-change authority.
    Critical,
}

impl RiskClass {
    /// Stable registry value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Moderate => "moderate",
            Self::High => "high",
            Self::Critical => "critical",
        }
    }
}

/// Whether a matching policy permit may still require human approval.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalMode {
    /// Policy alone can authorize the action.
    Never,
    /// Policy conditions decide whether a user prompt is needed.
    RiskBased,
    /// A scoped approval is mandatory.
    Always,
}

impl ApprovalMode {
    /// Stable registry value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Never => "never",
            Self::RiskBased => "risk_based",
            Self::Always => "always",
        }
    }
}

/// Whether policy may grant this action beyond a single approval lifecycle.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Persistence {
    /// User/task policy may retain a bounded grant.
    Allowed,
    /// Every authorization must remain ephemeral.
    Forbidden,
}

/// Compact execution-boundary requirements for an action.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct ExecutionRequirements(u8);

impl ExecutionRequirements {
    const SANDBOX: Self = Self(1);
    const NETWORK: Self = Self(2);
    const SECRET: Self = Self(4);
    const SANDBOX_NETWORK: Self = Self(Self::SANDBOX.0 | Self::NETWORK.0);
    const SANDBOX_SECRET: Self = Self(Self::SANDBOX.0 | Self::SECRET.0);
    const SANDBOX_SECRET_NETWORK: Self = Self(Self::SANDBOX.0 | Self::SECRET.0 | Self::NETWORK.0);

    const fn contains(self, requirement: Self) -> bool {
        self.0 & requirement.0 == requirement.0
    }
}

/// Immutable metadata for one canonical action.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ActionDescriptor {
    /// URI scheme accepted for the action's resource.
    pub resource_scheme: &'static str,
    /// Baseline risk classification.
    pub risk: RiskClass,
    /// Whether a user policy may persist authorization for this action.
    pub persistence: Persistence,
    /// Required execution boundaries as a closed flag set.
    pub requirements: ExecutionRequirements,
    /// Baseline approval behavior.
    pub approval: ApprovalMode,
}

impl ActionDescriptor {
    const fn new(
        resource_scheme: &'static str,
        risk: RiskClass,
        persistence: Persistence,
        requirements: ExecutionRequirements,
        approval: ApprovalMode,
    ) -> Self {
        Self {
            resource_scheme,
            risk,
            persistence,
            requirements,
            approval,
        }
    }

    /// Whether a bounded persistent grant is permitted.
    #[must_use]
    pub const fn persistable(self) -> bool {
        matches!(self.persistence, Persistence::Allowed)
    }

    /// Whether execution requires a sandbox realm.
    #[must_use]
    pub const fn requires_sandbox(self) -> bool {
        self.requirements.contains(ExecutionRequirements::SANDBOX)
    }

    /// Whether execution requires a brokered credential reference.
    #[must_use]
    pub const fn requires_secret(self) -> bool {
        self.requirements.contains(ExecutionRequirements::SECRET)
    }

    /// Whether execution crosses the network boundary.
    #[must_use]
    pub const fn requires_network(self) -> bool {
        self.requirements.contains(ExecutionRequirements::NETWORK)
    }
}

const ACTION_DESCRIPTORS: [ActionDescriptor; 19] = [
    ActionDescriptor::new(
        "workspace",
        RiskClass::Low,
        Persistence::Allowed,
        ExecutionRequirements::SANDBOX,
        ApprovalMode::RiskBased,
    ),
    ActionDescriptor::new(
        "workspace",
        RiskClass::Moderate,
        Persistence::Allowed,
        ExecutionRequirements::SANDBOX,
        ApprovalMode::RiskBased,
    ),
    ActionDescriptor::new(
        "workspace",
        RiskClass::High,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "process",
        RiskClass::High,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "process",
        RiskClass::High,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "network",
        RiskClass::High,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX_NETWORK,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "network",
        RiskClass::Critical,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX_NETWORK,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "network",
        RiskClass::Critical,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX_NETWORK,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "secret",
        RiskClass::Critical,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX_SECRET,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "browser",
        RiskClass::High,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX_NETWORK,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "git",
        RiskClass::Moderate,
        Persistence::Allowed,
        ExecutionRequirements::SANDBOX,
        ApprovalMode::RiskBased,
    ),
    ActionDescriptor::new(
        "git",
        RiskClass::High,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX_SECRET_NETWORK,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "git",
        RiskClass::Critical,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX_SECRET_NETWORK,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "cloud",
        RiskClass::Critical,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX_SECRET_NETWORK,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "external",
        RiskClass::Moderate,
        Persistence::Allowed,
        ExecutionRequirements::NETWORK,
        ApprovalMode::RiskBased,
    ),
    ActionDescriptor::new(
        "external",
        RiskClass::High,
        Persistence::Forbidden,
        ExecutionRequirements::NETWORK,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "plugin",
        RiskClass::Critical,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX_NETWORK,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "capability",
        RiskClass::Critical,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX,
        ApprovalMode::Always,
    ),
    ActionDescriptor::new(
        "self",
        RiskClass::Critical,
        Persistence::Forbidden,
        ExecutionRequirements::SANDBOX,
        ApprovalMode::Always,
    ),
];

/// Canonical, traversal-resistant resource identifier bound to an action.
#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct Resource(String);

impl Resource {
    /// Parse and validate a canonical resource for an action.
    ///
    /// # Errors
    ///
    /// Rejects the wrong scheme, ambiguous traversal, query/fragment suffixes and controls.
    pub fn new(action: Action, value: impl Into<String>) -> Result<Self, PolicyError> {
        let value = value.into();
        validate_resource(action, &value)?;
        Ok(Self(value))
    }

    /// Canonical resource text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn validate_for(&self, action: Action) -> Result<(), PolicyError> {
        validate_resource(action, &self.0)
    }
}

/// Exact or segment-bounded prefix selector used by a policy rule.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "match", content = "resource", rename_all = "snake_case")]
pub enum ResourcePattern {
    /// Match exactly one canonical resource.
    Exact(Resource),
    /// Match a canonical hierarchy root and its descendants.
    Prefix(Resource),
}

impl ResourcePattern {
    /// Construct an exact selector.
    ///
    /// # Errors
    ///
    /// Returns a resource grammar error for invalid input.
    pub fn exact(action: Action, value: impl Into<String>) -> Result<Self, PolicyError> {
        Resource::new(action, value).map(Self::Exact)
    }

    /// Construct a segment-bounded prefix selector.
    ///
    /// # Errors
    ///
    /// Returns a resource grammar error for invalid input.
    pub fn prefix(action: Action, value: impl Into<String>) -> Result<Self, PolicyError> {
        Resource::new(action, value).map(Self::Prefix)
    }

    /// Whether this selector contains the requested canonical resource.
    #[must_use]
    pub fn covers(&self, resource: &Resource) -> bool {
        match self {
            Self::Exact(expected) => expected == resource,
            Self::Prefix(prefix) => {
                let prefix = prefix.as_str().trim_end_matches('/');
                resource.as_str() == prefix
                    || resource
                        .as_str()
                        .strip_prefix(prefix)
                        .is_some_and(|suffix| suffix.starts_with('/'))
            }
        }
    }
}

fn validate_resource(action: Action, value: &str) -> Result<(), PolicyError> {
    if value.len() > 2048
        || value.chars().any(char::is_control)
        || value.chars().any(char::is_whitespace)
        || value.contains(['?', '#', '\\'])
    {
        return Err(PolicyError::InvalidResource);
    }
    let expected = action.descriptor().resource_scheme;
    let remainder = value
        .strip_prefix(expected)
        .and_then(|value| value.strip_prefix("://"))
        .ok_or(PolicyError::ResourceSchemeMismatch)?;
    if remainder.is_empty()
        || remainder.starts_with('/')
        || remainder
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || remainder.to_ascii_lowercase().contains("%2e")
    {
        return Err(PolicyError::InvalidResource);
    }
    Ok(())
}
