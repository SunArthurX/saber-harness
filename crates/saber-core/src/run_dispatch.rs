//! S30 run-method dispatch shared by both platform transports.
//!
//! Both the unix socket and the Windows named pipe server hand governed
//! run methods to this module so the mutation surface cannot drift
//! between platforms: goal and plan authoring, run start/pause/resume/
//! steer/cancel/fork/retry and exact one-shot approval resolution all
//! execute through the [`RunEngine`] over the encrypted store.

use saber_core_protocol::ControlMethod;
use saber_event_store::EventStore;
use serde_json::Value;

use crate::run_engine::RunEngine;

/// Execute a governed run method, or `None` when the method belongs to
/// another handler (initialize/health/subscribe).
///
/// # Errors
///
/// Every engine failure surfaces as a stable error string that the
/// transport writes as an error frame; nothing here can bypass the
/// store.
pub fn dispatch_run_method(
    method: &ControlMethod,
    params: &Value,
    store: &mut EventStore,
    engine: &mut RunEngine,
    workspace: &str,
    now_ms: u64,
) -> Option<Result<Value, String>> {
    match method {
        ControlMethod::GoalCreate => Some(engine.create_goal(store, workspace, params, now_ms)),
        ControlMethod::PlanFreeze => Some(engine.freeze_plan(store, workspace, params, now_ms)),
        ControlMethod::RunStart => Some(engine.start_run(store, workspace, params, now_ms)),
        ControlMethod::RunPause => Some(engine.pause_run(store, workspace, params, now_ms)),
        ControlMethod::RunResume => Some(engine.resume_run(store, workspace, params, now_ms)),
        ControlMethod::RunCancel => Some(engine.cancel_run(store, workspace, params, now_ms)),
        ControlMethod::RunSteer => Some(engine.steer_run(store, workspace, params, now_ms)),
        ControlMethod::RunFork | ControlMethod::RunRetry => {
            Some(engine.fork_run(store, workspace, params, now_ms))
        }
        ControlMethod::ApprovalResolve => {
            Some(engine.resolve_approval(store, workspace, params, now_ms))
        }
        ControlMethod::ChangesetPrepare => Some(crate::change_set::ChangeSetEngine::prepare(
            store,
            engine.store_dir(),
            workspace,
            params,
            now_ms,
        )),
        ControlMethod::ChangesetApply => Some(crate::change_set::ChangeSetEngine::apply(
            store, workspace, params, now_ms,
        )),
        ControlMethod::ChangesetRollback => Some(crate::change_set::ChangeSetEngine::rollback(
            store,
            engine.store_dir(),
            workspace,
            params,
            now_ms,
        )),
        ControlMethod::ChangesetCommit => Some(crate::change_set::ChangeSetEngine::commit(
            store, workspace, params, now_ms,
        )),
        ControlMethod::TaskDelegate => Some(crate::multi_agent::MultiAgentEngine::delegate_task(
            store, workspace, params, now_ms,
        )),
        ControlMethod::WorktreeCreate => Some(
            crate::multi_agent::MultiAgentEngine::create_worktree(store, workspace, params, now_ms),
        ),
        ControlMethod::WorktreeIntegrate => Some(crate::multi_agent::MultiAgentEngine::integrate(
            store, workspace, params, now_ms,
        )),
        ControlMethod::CoreInitialize
        | ControlMethod::CoreHealth
        | ControlMethod::EventsSubscribe => None,
    }
}
