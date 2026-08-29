//! S30 governed run engine — the Core-side authority for Goal, Plan,
//! approval and run execution.
//!
//! Every mutation is an append-only event in the encrypted store; the
//! in-memory index is a disposable projection rebuilt by replay (the
//! store is the single source of truth). Effects are the only real side
//! effects and they run AFTER policy checks and — for edits and
//! commands — an exact one-shot approval whose digest must match the
//! displayed card. Terminal run states can never regress: the store's
//! transition table has no outgoing edges from succeeded, failed or
//! cancelled, and every engine transition goes through it.
//!
//! The deterministic executor is the RT-1 fixture model route: plans
//! carry explicit effect steps (file read/edit, command run, network
//! request) and goals carry frozen acceptance checks that an independent
//! verifier evaluates after the steps complete (CDX-05). Network effects
//! are denied by policy BEFORE any socket is opened.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use saber_core_protocol::RunState;
use saber_event_store::{
    CommitOutcome, EffectDisposition, EffectIntent, EffectResult, EventStore, RunTransition,
    StoreError,
};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

/// Approval cards expire after this long without a decision.
const APPROVAL_TTL_MS: u64 = 300_000;

/// Fixture model route recorded in every run binding.
pub const FIXTURE_MODEL_ROUTE: &str = "fixture-deterministic";

/// Engine policy classification for an effect kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PolicyDecision {
    Allowed,
    NeedsApproval,
    Denied,
}

fn classify_effect(kind: &str) -> PolicyDecision {
    match kind {
        "file.read" => PolicyDecision::Allowed,
        "file.edit" | "command.run" | "command.test" => PolicyDecision::NeedsApproval,
        // Denial happens before any network attempt is made.
        _ => PolicyDecision::Denied,
    }
}

pub(crate) fn hex_digest(parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    let bytes = hasher.finalize();
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn short_tag(seed: &str) -> String {
    hex_digest(&[seed.as_bytes()])[..12].to_owned()
}

fn require<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("missing_param:{key}"))
}

/// One governed run's engine state — a disposable projection over events.
#[derive(Clone, Debug, Default)]
struct RunRecord {
    workspace: String,
    goal_id: String,
    plan_version: i64,
    state: String,
    /// Effect steps still to execute, in plan order.
    remaining_steps: Vec<Value>,
    /// Active approval card, if waiting for one.
    pending_approval: Option<Value>,
    resolved_approvals: Vec<String>,
    worktree: String,
}

/// The governed run engine index over the encrypted event store.
#[derive(Default)]
pub struct RunEngine {
    store_dir: std::path::PathBuf,
    workspace_hint: Option<String>,
    event_counter: u64,
    goals: HashMap<String, Value>,
    plans: HashMap<(String, i64), Value>,
    bindings: HashMap<String, Value>,
    runs: HashMap<String, RunRecord>,
}

impl RunEngine {
    /// Rebuild the disposable index by replaying the durable events.
    ///
    /// # Errors
    ///
    /// Returns a store error string when replay fails.
    pub fn rebuild(store_dir: &std::path::Path, store: &EventStore) -> Result<Self, String> {
        let mut engine = RunEngine {
            store_dir: store_dir.to_path_buf(),
            ..RunEngine::default()
        };
        let total = store.event_count().map_err(|e| e.to_string())?;
        let mut cursor = 0_i64;
        while cursor < total {
            let (events, next) = store
                .replay_events(cursor, 500)
                .map_err(|e| e.to_string())?;
            if next <= cursor {
                break;
            }
            for event in &events {
                engine.apply_event(&event.event_type, &event.payload_json);
            }
            cursor = next;
        }
        Ok(engine)
    }

    /// Store directory backing baseline snapshots (S31).
    pub(crate) fn store_dir(&self) -> &std::path::Path {
        &self.store_dir
    }

    fn note_workspace(&mut self, workspace: &str) {
        self.workspace_hint = Some(workspace.to_owned());
    }

    fn apply_event(&mut self, event_type: &str, payload_json: &str) {
        let Ok(payload) = serde_json::from_str::<Value>(payload_json) else {
            return;
        };
        match event_type {
            "goal.created" => {
                if let Some(goal_id) = payload.get("goal_id").and_then(Value::as_str) {
                    self.goals.insert(goal_id.to_owned(), payload);
                }
            }
            "plan.frozen" => {
                if let Some(goal_id) = payload.get("goal_id").and_then(Value::as_str) {
                    let version = payload.get("version").and_then(Value::as_i64).unwrap_or(0);
                    self.plans.insert((goal_id.to_owned(), version), payload);
                }
            }
            "run.binding_recorded" => {
                if let Some(run_id) = payload.get("run_id").and_then(Value::as_str) {
                    let goal_id = payload
                        .get("goal_id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    let version = payload
                        .get("plan_version")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    let steps = self
                        .plans
                        .get(&(goal_id.clone(), version))
                        .and_then(|plan| plan.get("steps"))
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    let entry = self.runs.entry(run_id.to_owned()).or_default();
                    entry.workspace = self.workspace_hint.clone().unwrap_or_default();
                    entry.goal_id = goal_id;
                    entry.plan_version = version;
                    entry.remaining_steps = steps;
                    if let Some(worktree) = payload.get("worktree").and_then(Value::as_str) {
                        entry.worktree.clone_from(&worktree.to_owned());
                    }
                    entry.state = "queued".into();
                    self.bindings.insert(run_id.to_owned(), payload);
                }
            }
            "run.state_changed" => {
                if let Some(run) = payload
                    .get("run_id")
                    .and_then(Value::as_str)
                    .and_then(|id| self.runs.get_mut(id))
                {
                    run.state = payload
                        .get("to")
                        .and_then(Value::as_str)
                        .unwrap_or(&run.state)
                        .to_owned();
                    if run.state == "running" {
                        run.pending_approval = None;
                    }
                }
            }
            "run.waiting_approval" => {
                let run_id = payload.get("run_id").and_then(Value::as_str).unwrap_or("");
                if let Some(run) = self.runs.get_mut(run_id) {
                    run.pending_approval = payload.get("card").cloned();
                }
            }
            "run.approval_resolved" => {
                let run_id = payload.get("run_id").and_then(Value::as_str).unwrap_or("");
                let approval_id = payload
                    .get("approval_id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                if let Some(run) = self.runs.get_mut(run_id) {
                    run.resolved_approvals.push(approval_id);
                    run.pending_approval = None;
                }
            }
            "run.effect_completed" | "run.effect_denied" | "run.effect_denied_by_policy" => {
                let run_id = payload.get("run_id").and_then(Value::as_str).unwrap_or("");
                let step_id = payload
                    .get("step_id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                if let Some(run) = self.runs.get_mut(run_id) {
                    run.remaining_steps.retain(|step| {
                        step.get("step_id").and_then(Value::as_str) != Some(step_id.as_str())
                    });
                }
            }
            _ => {}
        }
    }

    /// WP01 — create a Goal with frozen acceptance fields.
    ///
    /// # Errors
    ///
    /// Fails closed on missing objective/acceptance fields or store errors.
    pub fn create_goal(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        self.note_workspace(workspace);
        let objective = require(params, "objective")?;
        let acceptance = params
            .get("acceptance")
            .and_then(Value::as_array)
            .filter(|list| !list.is_empty())
            .ok_or("missing_param:acceptance")?;
        for check in acceptance {
            require(check, "check_id")?;
            require(check, "kind")?;
        }
        let goal_id = format!("goal-{now_ms}-{}", short_tag(objective));
        let payload = json!({
            "goal_id": goal_id,
            "objective": objective,
            "acceptance": acceptance,
            "constraints": params.get("constraints").cloned().unwrap_or(json!([])),
            "budget": params.get("budget").cloned().unwrap_or(json!({})),
            "deadline_ms": params.get("deadline_ms").and_then(Value::as_i64).unwrap_or(0),
            "owner": params.get("owner").and_then(Value::as_str).unwrap_or("user"),
            "evidence_requirements": params.get("evidence_requirements").cloned().unwrap_or(json!([])),
        });
        let idempotency = require(params, "idempotency_key")?;
        let outcome = store
            .append_core_event(
                &format!("goal_{goal_id}"),
                workspace,
                "goal.created",
                now_ms,
                &payload,
                idempotency,
            )
            .map_err(map_store_error)?;
        if matches!(outcome, CommitOutcome::Committed { .. }) {
            self.goals.insert(goal_id.clone(), payload);
        }
        Ok(json!({ "goal_id": goal_id }))
    }

    /// WP01 — freeze an immutable plan version. Editing is a new version;
    /// frozen versions never change.
    ///
    /// # Errors
    ///
    /// Fails closed on unknown goals, malformed steps or store errors.
    pub fn freeze_plan(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        self.note_workspace(workspace);
        let goal_id = require(params, "goal_id")?;
        if !self.goals.contains_key(goal_id) {
            return Err("unknown_goal".into());
        }
        let steps = params
            .get("steps")
            .and_then(Value::as_array)
            .filter(|list| !list.is_empty())
            .ok_or("missing_param:steps")?;
        for step in steps {
            require(step, "step_id")?;
            let effect = step.get("effect").ok_or("missing_param:effect")?;
            require(effect, "kind")?;
        }
        let version = i64::try_from(
            self.plans
                .keys()
                .filter(|key| key.0.as_str() == goal_id)
                .count(),
        )
        .unwrap_or(0)
            + 1;
        let worktree = require(params, "worktree")?;
        let payload = json!({
            "goal_id": goal_id,
            "version": version,
            "parent_version": params.get("parent_version").and_then(Value::as_i64),
            "worktree": worktree,
            "steps": steps,
            "diff": params.get("diff").cloned().unwrap_or(json!({})),
        });
        let idempotency = require(params, "idempotency_key")?;
        store
            .append_core_event(
                &format!("plan_{goal_id}_v{version}_{now_ms}"),
                workspace,
                "plan.frozen",
                now_ms,
                &payload,
                idempotency,
            )
            .map_err(map_store_error)?;
        self.plans.insert((goal_id.to_owned(), version), payload);
        Ok(json!({ "goal_id": goal_id, "version": version }))
    }

    /// WP01 — start a run bound to one frozen plan version, then execute
    /// until an approval, a pause request or a terminal state.
    ///
    /// # Errors
    ///
    /// Fails closed on unfrozen plans, invalid transitions and store errors.
    pub fn start_run(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        self.note_workspace(workspace);
        let goal_id = require(params, "goal_id")?;
        let version = params
            .get("plan_version")
            .and_then(Value::as_i64)
            .ok_or("missing_param:plan_version")?;
        let plan = self
            .plans
            .get(&(goal_id.to_owned(), version))
            .ok_or("plan_not_frozen")?
            .clone();
        let idempotency = require(params, "idempotency_key")?;
        let run_id = format!("run-{now_ms}-{}", short_tag(goal_id));
        let worktree = plan
            .get("worktree")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let binding = json!({
            "run_id": run_id,
            "goal_id": goal_id,
            "plan_version": version,
            "model_route": params.get("model_route").and_then(Value::as_str).unwrap_or(FIXTURE_MODEL_ROUTE),
            "realm": params.get("realm").and_then(Value::as_str).unwrap_or("local"),
            "worktree": worktree,
            "policy_snapshot": hex_digest(&[b"s30-policy-v1"]),
            "parent_run_id": params.get("parent_run_id").and_then(Value::as_str),
            "bound_at_ms": now_ms,
        });
        store
            .create_run(
                &format!("runq_{run_id}"),
                workspace,
                &run_id,
                goal_id,
                now_ms,
                idempotency,
            )
            .map_err(map_store_error)?;
        store
            .append_core_event(
                &format!("runbound_{run_id}"),
                workspace,
                "run.binding_recorded",
                now_ms,
                &binding,
                &format!("{idempotency}-binding"),
            )
            .map_err(map_store_error)?;
        self.apply_event("run.binding_recorded", &binding.to_string());
        // S31: snapshot the baseline inventory so the change set can be
        // reviewed, applied, rolled back and proven by hashes.
        let baseline = crate::change_set::ChangeSetEngine::snapshot_baseline(
            &self.store_dir,
            &run_id,
            &worktree,
        )?;
        store
            .append_core_event(
                &format!("baseline_{run_id}"),
                workspace,
                "run.baseline_snapshot",
                now_ms,
                &baseline,
                &format!("{idempotency}-baseline"),
            )
            .map_err(map_store_error)?;
        if binding
            .get("parent_run_id")
            .and_then(Value::as_str)
            .is_some()
        {
            store
                .append_core_event(
                    &format!("fork_{run_id}"),
                    workspace,
                    "run.forked",
                    now_ms,
                    &json!({ "run_id": run_id, "parent_run_id": binding.get("parent_run_id") }),
                    &format!("{idempotency}-fork"),
                )
                .map_err(map_store_error)?;
        }
        self.transition(
            store,
            &run_id,
            &RunState::Running,
            &[],
            now_ms,
            &format!("{idempotency}-go"),
        )?;
        self.execute_pending(store, workspace, &run_id, now_ms)
    }

    /// WP04 — pause: no new effects are scheduled past the boundary.
    ///
    /// # Errors
    ///
    /// Fails closed unless the run sits at a safe (blocked/queued) boundary.
    pub fn pause_run(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let run_id = require(params, "run_id")?;
        let record = self.runs.get(run_id).ok_or("unknown_run")?.clone();
        let boundary = record
            .remaining_steps
            .first()
            .and_then(|step| step.get("step_id"))
            .and_then(Value::as_str)
            .unwrap_or("end")
            .to_owned();
        match record.state.as_str() {
            "blocked" | "queued" => {
                self.append(
                    store,
                    workspace,
                    "run.paused",
                    now_ms,
                    &json!({ "run_id": run_id, "boundary_step": boundary }),
                    &format!("{run_id}-pause-{now_ms}"),
                )?;
                Ok(json!({ "run_id": run_id, "paused_at": boundary }))
            }
            _ => Err("pause_requires_safe_boundary".into()),
        }
    }

    /// WP04 — resume revalidates the bound policy snapshot, then continues.
    ///
    /// # Errors
    ///
    /// Fails closed on non-blocked runs or revalidation mismatch.
    pub fn resume_run(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let run_id = require(params, "run_id")?;
        let idempotency = require(params, "idempotency_key")?;
        let record = self.runs.get(run_id).ok_or("unknown_run")?.clone();
        if record.state != "blocked" {
            return Err("not_resumable".into());
        }
        let bound_snapshot = self
            .bindings
            .get(run_id)
            .and_then(|binding| binding.get("policy_snapshot"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let current_snapshot = hex_digest(&[b"s30-policy-v1"]);
        if bound_snapshot != current_snapshot {
            return Err("resume_revalidation_failed".into());
        }
        self.append(
            store,
            workspace,
            "run.resume_revalidated",
            now_ms,
            &json!({ "run_id": run_id, "policy_snapshot": current_snapshot }),
            &format!("{run_id}-resume-valid-{now_ms}"),
        )?;
        self.transition(
            store,
            run_id,
            &RunState::Running,
            &[],
            now_ms,
            &format!("{idempotency}-resume"),
        )?;
        self.execute_pending(store, workspace, run_id, now_ms)
    }

    /// WP04 — cancel: terminal, with compensation records for pending effects.
    ///
    /// # Errors
    ///
    /// Fails closed on unknown or already-terminal runs.
    pub fn cancel_run(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let run_id = require(params, "run_id")?;
        let idempotency = require(params, "idempotency_key")?;
        let record = self.runs.get(run_id).ok_or("unknown_run")?.clone();
        if matches!(record.state.as_str(), "succeeded" | "failed" | "cancelled") {
            return Err("run_already_terminal".into());
        }
        let compensated: Vec<Value> = record
            .pending_approval
            .as_ref()
            .and_then(|card| card.get("approval_id").cloned())
            .into_iter()
            .collect();
        self.append(
            store,
            workspace,
            "run.cancel_propagated",
            now_ms,
            &json!({ "run_id": run_id, "compensated": compensated, "realm": "local" }),
            &format!("{run_id}-cancel-prop-{now_ms}"),
        )?;
        self.transition(
            store,
            run_id,
            &RunState::Cancelled,
            &[],
            now_ms,
            &format!("{idempotency}-cancel"),
        )?;
        Ok(json!({ "run_id": run_id, "state": "cancelled" }))
    }

    /// WP04 — fork/retry: an explicit lineage run over the same frozen
    /// plan version, recorded as `run.forked` with the parent binding.
    ///
    /// # Errors
    ///
    /// Fails closed on unknown parents or any start-run failure.
    pub fn fork_run(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let parent = require(params, "run_id")?;
        let binding = self.bindings.get(parent).cloned().ok_or("unknown_run")?;
        let goal_id = binding
            .get("goal_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let plan_version = binding
            .get("plan_version")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let fork_params = json!({
            "goal_id": goal_id,
            "plan_version": plan_version,
            "model_route": binding.get("model_route"),
            "realm": binding.get("realm"),
            "parent_run_id": parent,
            "idempotency_key": require(params, "idempotency_key")?,
        });
        self.start_run(store, workspace, &fork_params, now_ms)
    }

    /// WP04 — steer: an explicit causal control event, never worker input.
    ///
    /// # Errors
    ///
    /// Fails closed on unknown runs.
    pub fn steer_run(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let run_id = require(params, "run_id")?;
        let text = require(params, "text")?;
        if !self.runs.contains_key(run_id) {
            return Err("unknown_run".into());
        }
        let state = self
            .runs
            .get(run_id)
            .map(|run| run.state.clone())
            .unwrap_or_default();
        // Blocked runs accept the steer now; a running run records it to
        // apply after the current effect. Steering never contaminates the
        // worker input stream — it is a control event in the journal.
        let boundary = if state == "blocked" {
            "now"
        } else {
            "after_current_effect"
        };
        self.append(
            store,
            workspace,
            "run.steered",
            now_ms,
            &json!({ "run_id": run_id, "text": text, "boundary": boundary }),
            &format!("{run_id}-steer-{}-{now_ms}", short_tag(text)),
        )?;
        Ok(json!({ "run_id": run_id, "boundary": boundary }))
    }

    /// Fail-closed validation of an approval resolution. Returns the
    /// card when every adversarial check passes.
    fn validate_approval(
        &self,
        run_id: &str,
        approval_id: &str,
        now_ms: u64,
    ) -> Result<Value, String> {
        let record = self.runs.get(run_id).ok_or("unknown_run")?.clone();
        let card = record
            .pending_approval
            .clone()
            .ok_or("no_pending_approval")?;
        if card.get("approval_id").and_then(Value::as_str) != Some(approval_id) {
            return Err("approval_unknown_for_run".into());
        }
        if record.resolved_approvals.iter().any(|id| id == approval_id) {
            return Err("approval_already_resolved".into());
        }
        let expires = card
            .get("expires_at_ms")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if now_ms.cast_signed() >= expires {
            return Err("approval_expired".into());
        }
        if record.plan_version
            != card
                .get("plan_version")
                .and_then(Value::as_i64)
                .unwrap_or(-1)
        {
            return Err("approval_plan_changed".into());
        }
        Ok(card)
    }

    /// Narrowing may only REMOVE trailing arguments, never add one.
    fn validate_scope_narrowing(card: &Value, scope: &Value) -> Result<(), String> {
        let approved: Vec<String> = card
            .get("argv")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        let narrowed: Vec<String> = scope
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        if narrowed != approved && !approved.starts_with(&narrowed[..]) {
            return Err("approval_scope_broadened".into());
        }
        Ok(())
    }

    /// WP03 — resolve an approval. Every adversarial path fails closed:
    /// unknown card, replay, expiry, digest mismatch, plan change and
    /// scope broadening are all rejected before any effect runs.
    ///
    /// # Errors
    ///
    /// Fails closed on every adversarial condition and store error.
    pub fn resolve_approval(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let run_id = require(params, "run_id")?;
        let approval_id = require(params, "approval_id")?;
        let decision = require(params, "decision")?;
        let record = self.runs.get(run_id).ok_or("unknown_run")?.clone();
        let card = self.validate_approval(run_id, approval_id, now_ms)?;
        let approved_digest = card
            .get("digest")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if let Some(presented) = params.get("digest").and_then(Value::as_str)
            && presented != approved_digest
        {
            return Err("approval_digest_mismatch".into());
        }
        if let Some(scope) = params.get("scope").and_then(|s| s.get("argv")) {
            Self::validate_scope_narrowing(&card, scope)?;
        }
        self.append(store, workspace, "run.approval_resolved", now_ms,
            &json!({ "run_id": run_id, "approval_id": approval_id, "decision": decision, "digest": approved_digest }),
            &format!("{approval_id}-resolved-{now_ms}"))?;
        if decision == "deny" {
            let step_id = card
                .get("step_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            self.append(
                store,
                workspace,
                "run.effect_denied",
                now_ms,
                &json!({ "run_id": run_id, "step_id": step_id, "approval_id": approval_id }),
                &format!("{approval_id}-deny-{now_ms}"),
            )?;
            self.remove_step(run_id, &step_id);
            if record.state == "blocked" {
                self.transition(
                    store,
                    run_id,
                    &RunState::Running,
                    &[],
                    now_ms,
                    &format!("{approval_id}-deny-continue-{now_ms}"),
                )?;
            }
            return self.execute_pending(store, workspace, run_id, now_ms);
        }
        if decision != "approve" {
            return Err("invalid_decision".into());
        }
        // Approved: the executed step must be exactly the approved step.
        let approved_step = card
            .get("step_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let next_step = record
            .remaining_steps
            .first()
            .and_then(|step| step.get("step_id"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if approved_step != next_step {
            return Err("approval_resource_changed".into());
        }
        self.transition(
            store,
            run_id,
            &RunState::Running,
            &[],
            now_ms,
            &format!("{approval_id}-continue-{now_ms}"),
        )?;
        self.execute_step(store, workspace, run_id, now_ms)
    }

    fn remove_step(&mut self, run_id: &str, step_id: &str) {
        if let Some(run) = self.runs.get_mut(run_id) {
            run.remaining_steps
                .retain(|step| step.get("step_id").and_then(Value::as_str) != Some(step_id));
        }
    }

    /// Execute remaining steps until approval, pause or terminal state.
    fn execute_pending(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        run_id: &str,
        now_ms: u64,
    ) -> Result<Value, String> {
        loop {
            let record = self.runs.get(run_id).ok_or("unknown_run")?.clone();
            if record.state != "running" {
                return Ok(json!({ "run_id": run_id, "state": record.state }));
            }
            let Some(step) = record.remaining_steps.first().cloned() else {
                return self.finish_run(store, workspace, run_id, now_ms);
            };
            let step_id = step
                .get("step_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let effect = step.get("effect").cloned().unwrap_or(json!({}));
            let kind = effect
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            match classify_effect(&kind) {
                PolicyDecision::Denied => {
                    // Policy denial happens before ANY attempt.
                    self.append(store, workspace, "run.effect_denied_by_policy", now_ms,
                        &json!({ "run_id": run_id, "step_id": step_id, "kind": kind, "reason": "network_egress_denied" }),
                        &format!("{run_id}-{step_id}-denied-{now_ms}"))?;
                    self.remove_step(run_id, &step_id);
                }
                PolicyDecision::Allowed => {
                    let outcome = execute_allowed_effect(&record.worktree, &effect)?;
                    self.record_effect(store, workspace, run_id, &step, &outcome, now_ms)?;
                    self.remove_step(run_id, &step_id);
                }
                PolicyDecision::NeedsApproval => {
                    let card = Self::build_card(run_id, &record, &step_id, &kind, &effect, now_ms);
                    self.transition(
                        store,
                        run_id,
                        &RunState::Blocked,
                        &[],
                        now_ms,
                        &format!("{run_id}-{step_id}-block-{now_ms}"),
                    )?;
                    self.append(
                        store,
                        workspace,
                        "run.waiting_approval",
                        now_ms,
                        &json!({ "run_id": run_id, "card": card }),
                        &format!("{run_id}-{step_id}-wait-{now_ms}"),
                    )?;
                    return Ok(
                        json!({ "run_id": run_id, "state": "waiting_approval", "card": card }),
                    );
                }
            }
        }
    }

    fn build_card(
        run_id: &str,
        record: &RunRecord,
        step_id: &str,
        kind: &str,
        effect: &Value,
        now_ms: u64,
    ) -> Value {
        let argv: Vec<String> = effect
            .get("argv")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        let resource = match kind {
            "file.edit" => effect
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            _ => argv.join(" "),
        };
        let canonical =
            serde_json::to_string(&json!({ "kind": kind, "effect": effect })).unwrap_or_default();
        json!({
            "approval_id": format!("appr-{step_id}-{now_ms}"),
            "step_id": step_id,
            "run_id": run_id,
            "plan_version": record.plan_version,
            "action": kind,
            "resource": resource,
            "argv": argv,
            "reason": effect.get("reason").and_then(Value::as_str).unwrap_or("plan step"),
            "boundary": format!("worktree:{}", record.worktree),
            "network": "none",
            "secret_refs": [],
            "expires_at_ms": now_ms.cast_signed() + APPROVAL_TTL_MS.cast_signed(),
            "scope": "one-shot",
            "digest": hex_digest(&[canonical.as_bytes()]),
            "alternatives": ["deny", "edit-manually"],
        })
    }

    /// Execute exactly the approved step, then continue the plan.
    fn execute_step(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        run_id: &str,
        now_ms: u64,
    ) -> Result<Value, String> {
        let record = self.runs.get(run_id).ok_or("unknown_run")?.clone();
        let Some(step) = record.remaining_steps.first().cloned() else {
            return self.finish_run(store, workspace, run_id, now_ms);
        };
        let step_id = step
            .get("step_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let effect = step.get("effect").cloned().unwrap_or(json!({}));
        let outcome = execute_command_effect(&record.worktree, &effect)?;
        self.record_effect(store, workspace, run_id, &step, &outcome, now_ms)?;
        self.remove_step(run_id, &step_id);
        self.execute_pending(store, workspace, run_id, now_ms)
    }

    /// CDX-05 — independent verifier over frozen acceptance, then the
    /// terminal transition with bound evidence (which the store requires).
    fn finish_run(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        run_id: &str,
        now_ms: u64,
    ) -> Result<Value, String> {
        let record = self.runs.get(run_id).ok_or("unknown_run")?.clone();
        let goal = self
            .goals
            .get(&record.goal_id)
            .cloned()
            .unwrap_or(json!({}));
        let checks = goal
            .get("acceptance")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut evidence = Vec::new();
        let mut all_passed = true;
        for check in &checks {
            let check_id = check
                .get("check_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let kind = check.get("kind").and_then(Value::as_str).unwrap_or("");
            let (passed, detail) = verify_acceptance(&record.worktree, kind, check);
            if passed {
                evidence.push(format!("evidence:{check_id}"));
            } else {
                all_passed = false;
            }
            self.append(store, workspace, "run.acceptance_checked", now_ms,
                &json!({ "run_id": run_id, "check_id": check_id, "passed": passed, "detail": detail }),
                &format!("{run_id}-check-{check_id}-{now_ms}"))?;
        }
        let verdict = if all_passed { "complete" } else { "revise" };
        self.append(
            store,
            workspace,
            "run.verdict",
            now_ms,
            &json!({ "run_id": run_id, "verdict": verdict, "evaluator": "independent-verifier" }),
            &format!("{run_id}-verdict-{now_ms}"),
        )?;
        let target = if all_passed {
            RunState::Succeeded
        } else {
            RunState::Failed
        };
        self.transition(
            store,
            run_id,
            &target,
            &evidence,
            now_ms,
            &format!("{run_id}-terminal-{now_ms}"),
        )?;
        Ok(json!({
            "run_id": run_id,
            "state": if all_passed { "succeeded" } else { "failed" },
            "verdict": verdict,
            "evidence": evidence,
        }))
    }

    fn transition(
        &mut self,
        store: &mut EventStore,
        run_id: &str,
        target: &RunState,
        evidence: &[String],
        now_ms: u64,
        idempotency: &str,
    ) -> Result<(), String> {
        let workspace = self
            .runs
            .get(run_id)
            .map(|run| run.workspace.clone())
            .unwrap_or_default();
        let command = RunTransition {
            event_id: &format!("rt_{run_id}_{}", short_tag(idempotency)),
            workspace_id: workspace.as_str(),
            run_id,
            target,
            acceptance_evidence: evidence,
            occurred_at_ms: now_ms,
            idempotency_key: idempotency,
        };
        match store.transition_run(&command) {
            Ok(_) => {
                if let Some(run) = self.runs.get_mut(run_id) {
                    state_to_name(target).clone_into(&mut run.state);
                    if run.state == "running" {
                        run.pending_approval = None;
                    }
                }
                Ok(())
            }
            Err(StoreError::InvalidTransition) => Err("invalid_transition".into()),
            Err(StoreError::AcceptanceEvidenceRequired) => {
                Err("acceptance_evidence_required".into())
            }
            Err(error) => Err(error.to_string()),
        }
    }

    fn append(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        event_type: &str,
        now_ms: u64,
        payload: &Value,
        idempotency: &str,
    ) -> Result<(), String> {
        self.event_counter += 1;
        // The counter suffix keeps event ids unique even when several
        // appends land in the same millisecond.
        let event_id = format!(
            "{}_{now_ms}_{}",
            event_type.replace('.', "_"),
            self.event_counter
        );
        store
            .append_core_event(
                &event_id,
                workspace,
                event_type,
                now_ms,
                payload,
                idempotency,
            )
            .map_err(map_store_error)?;
        self.apply_event(event_type, &payload.to_string());
        Ok(())
    }

    fn record_effect(
        &mut self,
        store: &mut EventStore,
        workspace: &str,
        run_id: &str,
        step: &Value,
        outcome: &Value,
        now_ms: u64,
    ) -> Result<(), String> {
        let step_id = step.get("step_id").and_then(Value::as_str).unwrap_or("");
        let kind = step
            .get("effect")
            .and_then(|effect| effect.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let resource = outcome.get("resource").cloned().unwrap_or(json!(""));
        store
            .record_effect_intent(&EffectIntent {
                event_id: &format!("intent_{run_id}_{step_id}_{now_ms}"),
                workspace_id: workspace,
                intent_id: &format!("intent-{run_id}-{step_id}"),
                effect_kind: kind,
                payload: &json!({ "kind": kind, "step_id": step_id, "run_id": run_id }),
                occurred_at_ms: now_ms,
                idempotency_key: &format!("{run_id}-intent-{step_id}-{now_ms}"),
            })
            .map_err(map_store_error)?;
        let duration_ms = outcome
            .get("duration_ms")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let result = json!({
            "resource": resource,
            "realm": "local",
            "duration_ms": duration_ms,
            "result": outcome,
            "evidence_id": format!("intent-{run_id}-{step_id}"),
        });
        store
            .record_effect_result(&EffectResult {
                event_id: &format!("result_{step_id}_{now_ms}"),
                workspace_id: workspace,
                intent_id: &format!("intent-{run_id}-{step_id}"),
                result: &result,
                disposition: EffectDisposition::Completed,
                occurred_at_ms: now_ms,
                idempotency_key: &format!("{run_id}-result-{step_id}-{now_ms}"),
            })
            .map_err(map_store_error)?;
        self.append(
            store,
            workspace,
            "run.effect_completed",
            now_ms,
            &json!({
                "run_id": run_id,
                "step_id": step_id,
                "kind": kind,
                "summary": {
                    "resource": resource,
                    "realm": "local",
                    "duration_ms": duration_ms,
                    "result_digest": outcome.get("digest").cloned().unwrap_or(json!("")),
                    "evidence_id": format!("intent-{run_id}-{step_id}"),
                },
            }),
            &format!("{run_id}-completed-{step_id}-{now_ms}"),
        )?;
        Ok(())
    }
}

fn map_store_error(error: StoreError) -> String {
    match error {
        StoreError::IdempotencyConflict => "idempotency_conflict".into(),
        StoreError::Database(inner) => {
            eprintln!("saber-core run engine: store error: {inner}");
            "database_error".into()
        }
        other => other.to_string(),
    }
}

fn state_to_name(state: &RunState) -> &'static str {
    match state {
        RunState::Queued => "queued",
        RunState::Running => "running",
        RunState::Blocked => "blocked",
        RunState::Succeeded => "succeeded",
        RunState::Failed => "failed",
        RunState::Cancelled => "cancelled",
    }
}

fn worktree_path(worktree: &str, relative: &str) -> Result<PathBuf, String> {
    if worktree.is_empty() || relative.is_empty() {
        return Err("missing_worktree_or_path".into());
    }
    let canonical_root = Path::new(worktree)
        .canonicalize()
        .map_err(|e| format!("worktree_unavailable:{e}"))?;
    // Join against the canonical root so symlinked platform temp dirs
    // (macOS /var -> /private/var) cannot fake a boundary violation.
    let joined = canonical_root.join(relative);
    // Parent must exist for canonicalize; guard traversal on the joined
    // path itself rather than trusting the parent alone.
    let normalized =
        joined
            .components()
            .fold(PathBuf::new(), |mut acc, component| match component {
                std::path::Component::ParentDir => {
                    acc.pop();
                    acc
                }
                std::path::Component::CurDir => acc,
                other => {
                    acc.push(other);
                    acc
                }
            });
    if !normalized.starts_with(&canonical_root) {
        return Err("path_outside_worktree".into());
    }
    Ok(normalized)
}

/// Execute a policy-allowed effect (file read). Edits and commands need
/// approval first and execute through [`execute_command_effect`].
fn execute_allowed_effect(worktree: &str, effect: &Value) -> Result<Value, String> {
    let kind = effect.get("kind").and_then(Value::as_str).unwrap_or("");
    match kind {
        "file.read" => {
            let relative = effect
                .get("path")
                .and_then(Value::as_str)
                .ok_or("missing_path")?;
            let path = worktree_path(worktree, relative)?;
            let bytes = std::fs::read(&path).map_err(|e| format!("read_failed:{e}"))?;
            Ok(json!({
                "resource": relative,
                "size": bytes.len(),
                "duration_ms": 0,
                "digest": hex_digest(&[&bytes]),
            }))
        }
        _ => Err("unsupported_unapproved_effect".into()),
    }
}

/// Execute an approved effect (file edit or exact-argv command run).
fn execute_command_effect(worktree: &str, effect: &Value) -> Result<Value, String> {
    let kind = effect.get("kind").and_then(Value::as_str).unwrap_or("");
    let started = std::time::Instant::now();
    match kind {
        "file.edit" => {
            let relative = effect
                .get("path")
                .and_then(Value::as_str)
                .ok_or("missing_path")?;
            let text = effect
                .get("text")
                .and_then(Value::as_str)
                .ok_or("missing_text")?;
            let path = worktree_path(worktree, relative)?;
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).map_err(|e| format!("mkdir_failed:{e}"))?;
            }
            std::fs::write(&path, text).map_err(|e| format!("write_failed:{e}"))?;
            Ok(json!({
                "resource": relative,
                "digest": hex_digest(&[text.as_bytes()]),
                "duration_ms": i64::try_from(started.elapsed().as_millis()).unwrap_or(0),
            }))
        }
        "command.run" | "command.test" => {
            let argv: Vec<String> = effect
                .get("argv")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .ok_or("missing_argv")?;
            if argv.len() < 2 {
                return Err("argv_requires_script_path".into());
            }
            let program = argv[0].as_str();
            if program != "node" && program != "node.exe" {
                return Err("program_not_permitted".into());
            }
            let root = Path::new(worktree)
                .canonicalize()
                .map_err(|e| format!("worktree_unavailable:{e}"))?;
            let script = Path::new(&argv[1]);
            let script_path = if script.is_absolute() {
                script.to_path_buf()
            } else {
                root.join(script)
            };
            let canonical_script = script_path
                .canonicalize()
                .map_err(|e| format!("script_unavailable:{e}"))?;
            if !canonical_script.starts_with(&root) {
                return Err("script_outside_worktree".into());
            }
            let mut command = std::process::Command::new(program);
            command.arg(&canonical_script);
            for extra in &argv[2..] {
                command.arg(extra);
            }
            command.current_dir(&root);
            let output = command.output().map_err(|e| format!("spawn_failed:{e}"))?;
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stdout_head: String = stdout.chars().take(2000).collect();
            let exit = output.status.code().unwrap_or(-1);
            Ok(json!({
                "resource": canonical_script.to_string_lossy(),
                "exit_code": exit,
                "stdout_head": stdout_head,
                "duration_ms": i64::try_from(started.elapsed().as_millis()).unwrap_or(0),
                "digest": hex_digest(&[stdout.as_bytes(), &exit.to_le_bytes()]),
            }))
        }
        _ => Err("unsupported_effect".into()),
    }
}

/// The independent verifier: evaluate one frozen acceptance check.
fn verify_acceptance(worktree: &str, kind: &str, check: &Value) -> (bool, String) {
    match kind {
        "file_contains" => {
            let path = check.get("path").and_then(Value::as_str).unwrap_or("");
            let needle = check.get("needle").and_then(Value::as_str).unwrap_or("");
            match worktree_path(worktree, path)
                .map_err(|e| e.clone())
                .and_then(|p| std::fs::read_to_string(p).map_err(|e| e.to_string()))
            {
                Ok(contents) => {
                    let passed = contents.contains(needle);
                    (passed, format!("file_contains:{path}:{passed}"))
                }
                Err(error) => (false, format!("check_failed:{error}")),
            }
        }
        "command_succeeds" => {
            // The check carries an argv, not an effect kind — wrap it in
            // the command shape the executor understands.
            let command_effect = json!({
                "kind": "command.run",
                "argv": check.get("argv").cloned().unwrap_or(json!([])),
            });
            match execute_command_effect(worktree, &command_effect) {
                Ok(outcome) => {
                    let exit = outcome
                        .get("exit_code")
                        .and_then(Value::as_i64)
                        .unwrap_or(-1);
                    (exit == 0, format!("exit_code:{exit}"))
                }
                Err(error) => (false, format!("check_failed:{error}")),
            }
        }
        _ => (false, "unknown_check_kind".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    trait ExpectOk<T> {
        fn ok_ctx(self, context: &str) -> T;
    }

    impl<T, E: std::fmt::Display> ExpectOk<T> for Result<T, E> {
        fn ok_ctx(self, context: &str) -> T {
            match self {
                Ok(value) => value,
                Err(error) => unreachable!("{context}: {error}"),
            }
        }
    }

    impl<T> ExpectOk<T> for Option<T> {
        fn ok_ctx(self, context: &str) -> T {
            match self {
                Some(value) => value,
                None => unreachable!("{context}"),
            }
        }
    }

    use saber_event_store::{DatabaseKey, DatabaseKeyProvider, StoreError};

    struct TestKeys;

    impl DatabaseKeyProvider for TestKeys {
        fn load(&self, _workspace_id: &str) -> Result<DatabaseKey, StoreError> {
            Ok(DatabaseKey::new([7; 32]))
        }

        fn load_candidates(&self, workspace_id: &str) -> Result<Vec<DatabaseKey>, StoreError> {
            Ok(vec![self.load(workspace_id)?])
        }
    }

    fn open_store(dir: &std::path::Path) -> EventStore {
        EventStore::open(&dir.join("store.db"), "ws-test", &TestKeys).ok_ctx("store opens")
    }

    fn fixture_plan_steps() -> Value {
        json!([
            { "step_id": "read", "effect": { "kind": "file.read", "path": "README.md" } },
            { "step_id": "edit", "effect": { "kind": "file.edit", "path": "notes.md", "text": "saber-was-here", "reason": "record outcome" } },
            { "step_id": "net", "effect": { "kind": "net.request", "url": "https://example.invalid" } },
        ])
    }

    #[test]
    fn policy_classification_is_fail_closed() {
        assert_eq!(classify_effect("file.read"), PolicyDecision::Allowed);
        assert_eq!(classify_effect("file.edit"), PolicyDecision::NeedsApproval);
        assert_eq!(
            classify_effect("command.run"),
            PolicyDecision::NeedsApproval
        );
        assert_eq!(classify_effect("net.request"), PolicyDecision::Denied);
        assert_eq!(classify_effect("shell.exec"), PolicyDecision::Denied);
        assert_eq!(classify_effect(""), PolicyDecision::Denied);
    }

    #[test]
    fn governed_run_reaches_approval_then_succeeds_after_exact_approval() {
        let tmp = tempfile::tempdir().ok_ctx("tmp");
        let worktree = tmp.path().join("wt");
        std::fs::create_dir_all(&worktree).ok_ctx("mkdir");
        std::fs::write(worktree.join("README.md"), "fixture").ok_ctx("write");
        let mut store = open_store(tmp.path());
        let mut engine = RunEngine::rebuild(tmp.path(), &store).ok_ctx("engine");

        let goal = engine
            .create_goal(&mut store, "ws-test", &json!({
                "objective": "fixture task",
                "acceptance": [ { "check_id": "c1", "kind": "file_contains", "path": "notes.md", "needle": "saber-was-here" } ],
                "idempotency_key": "goal-1",
            }), 1000)
            .ok_ctx("goal created");
        let goal_id = goal["goal_id"].as_str().ok_ctx("goal id").to_owned();
        let plan = engine
            .freeze_plan(
                &mut store,
                "ws-test",
                &json!({
                    "goal_id": goal_id,
                    "worktree": worktree.to_string_lossy(),
                    "steps": fixture_plan_steps(),
                    "idempotency_key": "plan-1",
                }),
                2000,
            )
            .ok_ctx("plan frozen");
        assert_eq!(plan["version"], 1);

        let started = engine
            .start_run(
                &mut store,
                "ws-test",
                &json!({
                    "goal_id": goal_id, "plan_version": 1, "idempotency_key": "run-1",
                }),
                3000,
            )
            .ok_ctx("run starts");
        assert_eq!(started["state"], "waiting_approval");
        let card = started["card"].clone();
        assert_eq!(card["action"], "file.edit");
        assert_eq!(card["scope"], "one-shot");
        assert_eq!(card["network"], "none");

        // Adversarial: wrong digest fails closed.
        let mismatch = engine.resolve_approval(
            &mut store,
            "ws-test",
            &json!({
                "run_id": started["run_id"], "approval_id": card["approval_id"],
                "decision": "approve", "digest": "deadbeef",
            }),
            3100,
        );
        assert!(mismatch.is_err());
        match mismatch {
            Err(error) => assert!(
                error.contains("digest"),
                "expected digest mismatch, got {error}"
            ),
            Ok(_) => unreachable!("digest mismatch must fail closed"),
        }

        let finished = engine
            .resolve_approval(
                &mut store,
                "ws-test",
                &json!({
                    "run_id": started["run_id"], "approval_id": card["approval_id"],
                    "decision": "approve", "digest": card["digest"],
                }),
                3200,
            )
            .ok_ctx("approval resolves");
        assert_eq!(finished["state"], "succeeded");
        assert_eq!(finished["verdict"], "complete");
        assert_eq!(finished["evidence"][0], "evidence:c1");
        // The network step was denied by policy, never attempted.
        let contents = std::fs::read_to_string(worktree.join("notes.md")).ok_ctx("edited");
        assert!(contents.contains("saber-was-here"));
    }

    #[test]
    fn approval_replay_and_terminal_regression_fail_closed() {
        let tmp = tempfile::tempdir().ok_ctx("tmp");
        let worktree = tmp.path().join("wt");
        std::fs::create_dir_all(&worktree).ok_ctx("mkdir");
        std::fs::write(worktree.join("README.md"), "fixture").ok_ctx("write");
        let mut store = open_store(tmp.path());
        let mut engine = RunEngine::rebuild(tmp.path(), &store).ok_ctx("engine");
        engine
            .create_goal(&mut store, "ws-test", &json!({
                "objective": "o", "acceptance": [{ "check_id": "c", "kind": "file_contains", "path": "README.md", "needle": "fixture" }],
                "idempotency_key": "g",
            }), 100)
            .ok_ctx("goal");
        let goal_id = format!("goal-100-{}", short_tag("o"));
        engine
            .freeze_plan(
                &mut store,
                "ws-test",
                &json!({
                    "goal_id": goal_id, "worktree": worktree.to_string_lossy(),
                    "steps": fixture_plan_steps(),
                    "idempotency_key": "p",
                }),
                200,
            )
            .ok_ctx("plan");
        let started = engine
            .start_run(
                &mut store,
                "ws-test",
                &json!({
                    "goal_id": goal_id, "plan_version": 1, "idempotency_key": "r",
                }),
                300,
            )
            .ok_ctx("run");
        let card = started["card"].clone();
        let run_id = started["run_id"].as_str().ok_ctx("run id").to_owned();

        let resolved = engine
            .resolve_approval(
                &mut store,
                "ws-test",
                &json!({
                    "run_id": run_id, "approval_id": card["approval_id"], "decision": "approve",
                }),
                400,
            )
            .ok_ctx("approve");
        assert_eq!(resolved["state"], "succeeded");

        // Replay of the same approval is rejected.
        let replay = engine.resolve_approval(
            &mut store,
            "ws-test",
            &json!({
                "run_id": run_id, "approval_id": card["approval_id"], "decision": "approve",
            }),
            500,
        );
        assert!(replay.is_err());
        // Terminal runs cannot be cancelled or re-transitioned.
        let cancel = engine.cancel_run(
            &mut store,
            "ws-test",
            &json!({
                "run_id": run_id, "idempotency_key": "cancel",
            }),
            600,
        );
        assert!(cancel.is_err());
    }

    #[test]
    fn engine_index_rebuilds_from_replayed_events() {
        let tmp = tempfile::tempdir().ok_ctx("tmp");
        let worktree = tmp.path().join("wt");
        std::fs::create_dir_all(&worktree).ok_ctx("mkdir");
        std::fs::write(worktree.join("README.md"), "fixture").ok_ctx("write");
        let mut store = open_store(tmp.path());
        let mut engine = RunEngine::rebuild(tmp.path(), &store).ok_ctx("engine");
        engine
            .create_goal(&mut store, "ws-test", &json!({
                "objective": "rebuild", "acceptance": [{ "check_id": "c", "kind": "file_contains", "path": "README.md", "needle": "fixture" }],
                "idempotency_key": "g",
            }), 100)
            .ok_ctx("goal");
        let goal_id = format!("goal-100-{}", short_tag("rebuild"));
        engine
            .freeze_plan(&mut store, "ws-test", &json!({
                "goal_id": goal_id, "worktree": worktree.to_string_lossy(),
                "steps": json!([{ "step_id": "read", "effect": { "kind": "file.read", "path": "README.md" } }]),
                "idempotency_key": "p",
            }), 200)
            .ok_ctx("plan");
        let started = engine
            .start_run(
                &mut store,
                "ws-test",
                &json!({
                    "goal_id": goal_id, "plan_version": 1, "idempotency_key": "r",
                }),
                300,
            )
            .ok_ctx("run");
        assert_eq!(started["state"], "succeeded");

        // A rebuilt engine (fresh process equivalent) sees the same truth.
        let rebuilt = RunEngine::rebuild(tmp.path(), &store).ok_ctx("rebuild");
        assert!(rebuilt.goals.contains_key(&goal_id));
        assert_eq!(rebuilt.runs.len(), 1);
    }
}
