// Generated from canonical JSON Schema by scripts/generate-contracts.mjs. DO NOT EDIT.

export interface Workspace {
  workspace_id: string;
  revision: number;
  root_uri: string;
  created_at: string;
}

export interface Goal {
  goal_id: string;
  workspace_id: string;
  objective: string;
  created_at: string;
}

export interface Task {
  task_id: string;
  goal_id: string;
  title: string;
  state: RunState;
}

export interface Run {
  run_id: string;
  task_id: string;
  attempt: number;
  state: RunState;
}

export interface Artifact {
  artifact_id: string;
  run_id: string;
  media_type: string;
  content_hash: string;
}

export interface Decision {
  decision_id: string;
  workspace_id: string;
  statement: string;
  evidence_refs: Array<string>;
}

export interface Memory {
  memory_id: string;
  workspace_id: string;
  source_trust: SourceTrust;
  sensitivity: Sensitivity;
  revision_hash: string;
}

export interface Capability {
  capability_id: string;
  action: string;
  resource_pattern: string;
  effect: CapabilityEffect;
}

export interface Incident {
  incident_id: string;
  severity: IncidentSeverity;
  summary: string;
  status: IncidentStatus;
}

export interface EvolutionCandidate {
  candidate_id: string;
  kind: EvolutionKind;
  scope: EvolutionScope;
  origin: EvolutionOrigin;
  evidence_refs: Array<string>;
  source_trust: SourceTrust;
  target_hash: string;
  permissions: Array<string>;
  evaluation_plan: string;
}

export type RunState = "queued" | "running" | "blocked" | "succeeded" | "failed" | "cancelled";

export type SourceTrust = "owner" | "agent_derived" | "external_untrusted" | "system";

export type Sensitivity = "public" | "internal" | "confidential" | "restricted";

export type CapabilityEffect = "allow" | "deny";

export type IncidentSeverity = "info" | "warning" | "critical";

export type IncidentStatus = "open" | "mitigated" | "resolved";

export type EvolutionKind = "memory" | "rule" | "skill" | "tool" | "strategy" | "core_pr";

export type EvolutionScope = "user" | "workspace" | "repo" | "organization";

export type EvolutionOrigin = "explicit_learn" | "correction" | "repeated_pattern" | "incident" | "eval_gap";

export interface EventEnvelope {
  event_id: string;
  schema_version: "1.0.0";
  event_type: string;
  occurred_at: string;
  workspace_id: string;
  actor_id: string;
  causation_id?: string | null;
  correlation_id: string;
  sensitivity: Sensitivity;
  policy_snapshot_id: string;
  payload: Record<string, unknown>;
}

export type ControlMethod = "approval.resolve" | "core.health" | "core.initialize" | "events.subscribe" | "goal.create" | "plan.freeze" | "run.cancel" | "run.fork" | "run.pause" | "run.resume" | "run.retry" | "run.start" | "run.steer";

export interface RequestContext {
  request_id: string;
  actor_id: string;
  workspace_id: string;
  causation_id?: string | null;
  deadline_unix_ms: number;
  idempotency_key?: string | null;
}

export interface ControlRequest {
  jsonrpc: "2.0";
  protocol_version: "1.0.0" | "0.1.0";
  method: ControlMethod;
  context: RequestContext;
  params: Record<string, unknown>;
}

export interface ControlError {
  code: number;
  message: string;
  request_id?: string | null;
}
