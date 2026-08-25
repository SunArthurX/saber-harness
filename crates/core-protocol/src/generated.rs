//! Generated from canonical JSON Schema by scripts/generate-contracts.mjs. DO NOT EDIT.
#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    pub workspace_id: String,
    pub revision: u64,
    pub root_uri: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Goal {
    pub goal_id: String,
    pub workspace_id: String,
    pub objective: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Task {
    pub task_id: String,
    pub goal_id: String,
    pub title: String,
    pub state: RunState,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Run {
    pub run_id: String,
    pub task_id: String,
    pub attempt: u64,
    pub state: RunState,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Artifact {
    pub artifact_id: String,
    pub run_id: String,
    pub media_type: String,
    pub content_hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Decision {
    pub decision_id: String,
    pub workspace_id: String,
    pub statement: String,
    pub evidence_refs: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Memory {
    pub memory_id: String,
    pub workspace_id: String,
    pub source_trust: SourceTrust,
    pub sensitivity: Sensitivity,
    pub revision_hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Capability {
    pub capability_id: String,
    pub action: String,
    pub resource_pattern: String,
    pub effect: CapabilityEffect,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Incident {
    pub incident_id: String,
    pub severity: IncidentSeverity,
    pub summary: String,
    pub status: IncidentStatus,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvolutionCandidate {
    pub candidate_id: String,
    pub kind: EvolutionKind,
    pub scope: EvolutionScope,
    pub origin: EvolutionOrigin,
    pub evidence_refs: Vec<String>,
    pub source_trust: SourceTrust,
    pub target_hash: String,
    pub permissions: Vec<String>,
    pub evaluation_plan: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunState {
    #[serde(rename = "queued")]
    Queued,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "blocked")]
    Blocked,
    #[serde(rename = "succeeded")]
    Succeeded,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "cancelled")]
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SourceTrust {
    #[serde(rename = "owner")]
    Owner,
    #[serde(rename = "agent_derived")]
    AgentDerived,
    #[serde(rename = "external_untrusted")]
    ExternalUntrusted,
    #[serde(rename = "system")]
    System,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Sensitivity {
    #[serde(rename = "public")]
    Public,
    #[serde(rename = "internal")]
    Internal,
    #[serde(rename = "confidential")]
    Confidential,
    #[serde(rename = "restricted")]
    Restricted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum CapabilityEffect {
    #[serde(rename = "allow")]
    Allow,
    #[serde(rename = "deny")]
    Deny,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum IncidentSeverity {
    #[serde(rename = "info")]
    Info,
    #[serde(rename = "warning")]
    Warning,
    #[serde(rename = "critical")]
    Critical,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum IncidentStatus {
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "mitigated")]
    Mitigated,
    #[serde(rename = "resolved")]
    Resolved,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EvolutionKind {
    #[serde(rename = "memory")]
    Memory,
    #[serde(rename = "rule")]
    Rule,
    #[serde(rename = "skill")]
    Skill,
    #[serde(rename = "tool")]
    Tool,
    #[serde(rename = "strategy")]
    Strategy,
    #[serde(rename = "core_pr")]
    CorePr,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EvolutionScope {
    #[serde(rename = "user")]
    User,
    #[serde(rename = "workspace")]
    Workspace,
    #[serde(rename = "repo")]
    Repo,
    #[serde(rename = "organization")]
    Organization,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EvolutionOrigin {
    #[serde(rename = "explicit_learn")]
    ExplicitLearn,
    #[serde(rename = "correction")]
    Correction,
    #[serde(rename = "repeated_pattern")]
    RepeatedPattern,
    #[serde(rename = "incident")]
    Incident,
    #[serde(rename = "eval_gap")]
    EvalGap,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventEnvelope {
    pub event_id: String,
    pub schema_version: String,
    pub event_type: String,
    pub occurred_at: String,
    pub workspace_id: String,
    pub actor_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    pub correlation_id: String,
    pub sensitivity: Sensitivity,
    pub policy_snapshot_id: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ControlMethod {
    #[serde(rename = "run.steer")]
    RunSteer,
    #[serde(rename = "run.cancel")]
    RunCancel,
    #[serde(rename = "run.retry")]
    RunRetry,
    #[serde(rename = "run.fork")]
    RunFork,
    #[serde(rename = "events.subscribe")]
    EventsSubscribe,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestContext {
    pub request_id: String,
    pub actor_id: String,
    pub workspace_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    pub deadline_unix_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRequest {
    pub jsonrpc: String,
    pub protocol_version: String,
    pub method: ControlMethod,
    pub context: RequestContext,
    pub params: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}
