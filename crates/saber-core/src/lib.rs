//! Trusted agent core for Saber.
//!
//! This crate composes the S00-S24 harness into one auditable run: a
//! deterministic default-deny policy decision (with exact, expiring
//! operator approval), fail-closed sandboxed execution through the
//! platform backend registry, and a transactional intent/result trail
//! inside the encrypted `SQLCipher` event store. Nothing executes before
//! its decision is durably audited, and an unavailable sandbox denies
//! the effect rather than degrading to host execution.

// The unix-domain supervision endpoint; Windows compiles the crate
// without it and the CLI fails closed there by design.
#[cfg(unix)]
pub mod serve;
#[cfg(windows)]
pub mod serve_windows;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{SystemTime, UNIX_EPOCH};

use saber_event_store::{
    DatabaseKey, DatabaseKeyProvider, EffectDisposition, EffectIntent, EffectResult, EventStore,
    StoreError,
};
use saber_policy::vocabulary::Action;
use saber_policy::{
    ApprovalGrant, ApprovalRequest, ApprovalScope, CapabilityRequest, DataClass, DecisionAuditSink,
    EnforcementError, PolicyBundle, PolicyCondition, PolicyDecision, PolicyEnforcer, PolicyEngine,
    PolicyRule, PolicyTier, Principal, PrincipalKind, Resource, ResourcePattern, RuleEffect,
    sha256_label,
};
use saber_sandbox::{
    BackendRegistry, BudgetSpec, CommandSpec, EnvSpec, ExecOutcome, MountSource, MountSpec,
    NetworkSpec, Realm, SandboxError, SandboxPlan,
};
use serde_json::json;

/// Exit code meaning "policy denied the run".
pub const EXIT_DENIED: i32 = 2;
/// Exit code meaning "the authorized effect failed after the decision".
pub const EXIT_EFFECT_FAILED: i32 = 3;

/// Failures that prevent a run from reaching a terminal audit record.
#[derive(Debug)]
pub enum RunError {
    /// The caller supplied an unusable program path.
    InvalidProgram(String),
    /// The encrypted store could not be opened or written.
    Store(StoreError),
    /// The policy snapshot, request or approval was malformed.
    Policy(String),
}

impl std::fmt::Display for RunError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidProgram(detail) => write!(formatter, "invalid_program: {detail}"),
            Self::Store(error) => write!(formatter, "store: {error}"),
            Self::Policy(detail) => write!(formatter, "policy: {detail}"),
        }
    }
}

impl std::error::Error for RunError {}

impl From<StoreError> for RunError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

/// Terminal disposition of one run.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RunOutcome {
    /// Policy allowed the effect and the sandbox executed the child.
    Executed {
        /// Child exit code when it terminated normally.
        exit_code: Option<i32>,
        /// Captured stdout, bounded by the realm budget.
        stdout: Vec<u8>,
        /// Captured stderr, bounded by the realm budget.
        stderr: Vec<u8>,
        /// Wall-clock child duration in milliseconds.
        duration_ms: u64,
    },
    /// Policy denied (default deny, explicit deny or missing/invalid
    /// approval). Zero effects executed.
    Denied {
        /// Stable decision outcome label (`deny` or `require_approval`).
        outcome: &'static str,
        /// Stable machine-readable reason code.
        reason: String,
    },
    /// Policy allowed the effect but the sandbox refused or failed;
    /// the refusal is audited, never degraded to host execution.
    Failed {
        /// Stable refusal code.
        reason: String,
    },
}

/// One complete, audited run record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunReport {
    /// Stable run identifier inside the store.
    pub run_id: String,
    /// Terminal disposition.
    pub outcome: RunOutcome,
    /// Decision identifier when the run was denied (empty otherwise;
    /// authorization evidence lives in the encrypted audit trail).
    pub decision_id: String,
    /// Whether the store's hash chain still verifies after the run.
    pub hash_chain_verified: bool,
    /// Total events in the store after the run.
    pub events: usize,
    /// Store database path (encrypted at rest).
    pub store_path: PathBuf,
}

impl RunReport {
    /// Process exit code reflecting the terminal disposition.
    #[must_use]
    pub const fn exit_code(&self) -> i32 {
        match &self.outcome {
            RunOutcome::Executed {
                exit_code: Some(code),
                ..
            } => *code,
            RunOutcome::Executed { .. } => 1,
            RunOutcome::Denied { .. } => EXIT_DENIED,
            RunOutcome::Failed { .. } => EXIT_EFFECT_FAILED,
        }
    }
}

/// Operator-controlled inputs for one run.
#[derive(Clone, Debug)]
pub struct RunOptions {
    /// Workspace partition for the store.
    pub workspace_id: String,
    /// Task scope binding approvals and events.
    pub task_id: String,
    /// Absolute host program path to execute.
    pub program: PathBuf,
    /// Arguments after the program.
    pub arguments: Vec<String>,
    /// Program basenames the operator added to the User-tier permit
    /// rules. Empty keeps default deny.
    pub allowed_programs: Vec<String>,
    /// Whether the operator supplied explicit approval for this exact
    /// request. `process.spawn` always requires it.
    pub approved: bool,
    /// Deterministic clock override for tests (Unix milliseconds).
    pub now_ms: Option<u64>,
    /// Optional stdin payload for the child.
    pub stdin: Option<Vec<u8>>,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            workspace_id: "ws_local".to_owned(),
            task_id: "task_local".to_owned(),
            program: PathBuf::new(),
            arguments: Vec::new(),
            allowed_programs: Vec::new(),
            approved: false,
            now_ms: None,
            stdin: None,
        }
    }
}

fn unix_ms(override_ms: Option<u64>) -> u64 {
    override_ms.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| {
                u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
            })
    })
}

/// File-backed local key custody for the runner. Production deployments
/// use the OS credential store; this provider keeps a random 32-byte
/// key next to the store with owner-only permissions on Unix.
pub struct KeyFileProvider {
    path: PathBuf,
}

impl KeyFileProvider {
    /// Custodian for `<store_dir>/key-v1`.
    #[must_use]
    pub fn new(store_dir: &Path) -> Self {
        Self {
            path: store_dir.join("key-v1"),
        }
    }

    fn load_or_create(&self) -> Result<DatabaseKey, StoreError> {
        if let Ok(bytes) = std::fs::read(&self.path)
            && bytes.len() == 32
        {
            let mut key = [0_u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(DatabaseKey::new(key));
        }
        let mut key = [0_u8; 32];
        getrandom::fill(&mut key).map_err(|_| StoreError::KeyCustody)?;
        write_private(&self.path, &key)?;
        Ok(DatabaseKey::new(key))
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::write(path, bytes).map_err(|_| StoreError::KeyCustody)?;
        let permissions = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(path, permissions).map_err(|_| StoreError::KeyCustody)?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, bytes).map_err(|_| StoreError::KeyCustody)?;
    }
    Ok(())
}

impl DatabaseKeyProvider for KeyFileProvider {
    fn load(&self, _workspace_id: &str) -> Result<DatabaseKey, StoreError> {
        self.load_or_create()
    }

    fn load_candidates(&self, workspace_id: &str) -> Result<Vec<DatabaseKey>, StoreError> {
        Ok(vec![self.load(workspace_id)?])
    }
}

/// `DecisionAuditSink` over a shared store so the effect closure can
/// append its transactional intent/result inside the same run.
struct SharedSink(Rc<RefCell<EventStore>>);

impl DecisionAuditSink for SharedSink {
    type Error = StoreError;

    fn record_decision(
        &mut self,
        record: &saber_policy::PolicyDecisionAudit,
    ) -> Result<(), StoreError> {
        self.0.borrow_mut().record_decision(record)
    }

    fn record_enforcement(
        &mut self,
        decision_id: &str,
        occurred_at_ms: u64,
        result: saber_policy::EnforcementResult,
    ) -> Result<(), StoreError> {
        self.0
            .borrow_mut()
            .record_enforcement(decision_id, occurred_at_ms, result)
    }
}

fn operator_bundle(allowed_programs: &[String]) -> Result<PolicyBundle, RunError> {
    let mut rules = Vec::new();
    for program in allowed_programs {
        let selector = ResourcePattern::exact(Action::ProcessSpawn, format!("process://{program}"))
            .map_err(|error| RunError::Policy(error.to_string()))?;
        rules.push(PolicyRule {
            rule_id: format!("operator-permit-process-{program}"),
            effect: RuleEffect::Permit,
            action: Action::ProcessSpawn,
            resource: selector,
            condition: PolicyCondition {
                require_sandbox: true,
                ..PolicyCondition::default()
            },
            requires_approval: false,
        });
    }
    PolicyBundle::new(PolicyTier::User, "operator-cli", 1, rules)
        .map_err(|error| RunError::Policy(error.to_string()))
}

fn build_plan(options: &RunOptions, program_dir: &Path, entry: &str) -> SandboxPlan {
    let mut argv = Vec::with_capacity(options.arguments.len() + 1);
    argv.push(format!("/tools/{entry}"));
    argv.extend(options.arguments.iter().cloned());
    SandboxPlan {
        version: 1,
        workspace_id: options.workspace_id.clone(),
        realm: Realm::S2IsolatedReadOnly,
        mounts: vec![MountSpec {
            target: "tools".to_owned(),
            source: MountSource::SystemTools {
                host_path: program_dir.to_path_buf(),
            },
            writable: false,
            executable: true,
        }],
        env: EnvSpec::default(),
        budget: BudgetSpec::default_budget(),
        network: NetworkSpec::Denied,
        command: Some(CommandSpec {
            argv,
            cwd: "/tools".to_owned(),
            stdin: options.stdin.clone(),
        }),
    }
}

fn exec_in_registry(
    registry: &mut BackendRegistry,
    plan: &SandboxPlan,
) -> Result<ExecOutcome, SandboxError> {
    let validated = plan.validate().map_err(|_| SandboxError::PlanViolation)?;
    let selection = registry.select_for(&validated)?;
    let backend = registry.backend_mut(selection.index)?;
    let handle = backend.create(&validated)?;
    for mount in &validated.plan.mounts {
        backend.mount(&handle, mount)?;
    }
    backend.network(&handle, &validated.plan.network)?;
    let command = validated
        .plan
        .command
        .clone()
        .ok_or(SandboxError::PlanViolation)?;
    let injected: BTreeMap<String, saber_sandbox::RedactableValue> = BTreeMap::default();
    let outcome = backend.exec(&handle, &command, injected);
    let destroyed = backend.destroy(&handle);
    let outcome = outcome?;
    destroyed?;
    Ok(outcome)
}

fn program_location(options: &RunOptions) -> Result<(PathBuf, String), RunError> {
    let invalid = || RunError::InvalidProgram(options.program.to_string_lossy().into_owned());
    let canonical = options.program.canonicalize().map_err(|_| invalid())?;
    let entry = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(invalid)?
        .to_owned();
    let parent = canonical.parent().ok_or_else(invalid)?.to_path_buf();
    if !canonical.is_absolute() || canonical.components().count() < 2 {
        return Err(invalid());
    }
    Ok((parent, entry))
}

fn denial_of(decision: &PolicyDecision) -> RunOutcome {
    let outcome = match decision.outcome {
        saber_policy::DecisionOutcome::RequireApproval => "require_approval",
        _ => "deny",
    };
    RunOutcome::Denied {
        outcome,
        reason: decision.reason.as_str().to_owned(),
    }
}

/// Open (or create) the run's encrypted store and append its run
/// record. Run-scoped identifiers derive from the store's event
/// sequence so repeated runs in one store stay distinct instead of
/// collapsing into one replayed idempotency bucket.
fn open_run_store(
    store_dir: &Path,
    options: &RunOptions,
    now: u64,
) -> Result<(Rc<RefCell<EventStore>>, String, u64), RunError> {
    std::fs::create_dir_all(store_dir).map_err(|_| StoreError::KeyCustody)?;
    let provider = KeyFileProvider::new(store_dir);
    let store = EventStore::open(
        &store_dir.join("facts.db"),
        &options.workspace_id,
        &provider,
    )?;
    let store = Rc::new(RefCell::new(store));
    let sequence = u64::try_from(store.borrow().run_count()?)
        .unwrap_or(0)
        .saturating_add(1);
    let run_id = format!("run_{sequence:04}");
    store.borrow_mut().create_run(
        &format!("event_run_{sequence}"),
        &options.workspace_id,
        &run_id,
        &options.task_id,
        now,
        &format!("run-idem-{sequence}"),
    )?;
    Ok((store, run_id, sequence))
}

/// Execute one fully audited agent run.
///
/// The ordering is the immune-system contract: the run is created in
/// the encrypted store first; the deterministic policy decides before
/// any effect; `process.spawn` additionally requires an exact,
/// expiring operator approval; the effect only then allocates a sandbox
/// realm through the fail-closed backend registry, records its durable
/// intent, executes the child and records the verified result. Every
/// terminal path leaves a verifiable hash chain.
///
/// # Errors
///
/// [`RunError`] when the run could not reach a terminal audit record
/// (unusable program, unwritable store, malformed policy). Policy
/// denials are reported through [`RunReport`], not as errors: a denied
/// run is a successful, audited run.
pub fn execute_run(
    store_dir: &Path,
    registry: &mut BackendRegistry,
    options: &RunOptions,
) -> Result<RunReport, RunError> {
    let (_program_dir, entry) = program_location(options)?;
    let program_name = entry;
    let now = unix_ms(options.now_ms);

    let (store, run_id, sequence) = open_run_store(store_dir, options, now)?;
    let mut hash_parts: Vec<&[u8]> = Vec::with_capacity(options.arguments.len() + 1);
    hash_parts.push(program_name.as_bytes());
    for argument in &options.arguments {
        hash_parts.push(argument.as_bytes());
    }
    let operation_hash = sha256_label(&hash_parts);
    let request = CapabilityRequest::new(
        format!("req-{run_id}"),
        Principal {
            id: "saber-core".to_owned(),
            kind: PrincipalKind::AgentRuntime,
            on_behalf_of: Some("operator".to_owned()),
        },
        options.workspace_id.clone(),
        options.task_id.clone(),
        Action::ProcessSpawn,
        Resource::new(Action::ProcessSpawn, format!("process://{program_name}"))
            .map_err(|error| RunError::Policy(error.to_string()))?,
        operation_hash,
        None,
        true,
        DataClass::Internal,
        now,
    )
    .map_err(|error| RunError::Policy(error.to_string()))?;

    // The engine requires the immutable platform tier first; the
    // operator grants ride above it as the User tier.
    let platform = PolicyBundle::new(PolicyTier::PlatformHard, "platform-v1", 1, Vec::new())
        .map_err(|error| RunError::Policy(error.to_string()))?;
    let operator = operator_bundle(&options.allowed_programs)?;
    let engine = PolicyEngine::new(vec![platform, operator])
        .map_err(|error| RunError::Policy(error.to_string()))?;
    let mut enforcer = PolicyEnforcer::new(engine, SharedSink(Rc::clone(&store)));

    let grant = operator_grant(options, &request, &program_name, &run_id, now)?;

    let effect = sandboxed_effect(
        Rc::clone(&store),
        registry,
        options,
        &program_name,
        now,
        sequence,
    );

    let enforcement = enforcer.execute(&request, grant.as_ref(), now, effect);
    let (outcome, decision_id) = match enforcement {
        Ok(executed) => (
            RunOutcome::Executed {
                exit_code: executed.exit_code,
                stdout: executed.stdout,
                stderr: executed.stderr,
                duration_ms: executed.duration_ms,
            },
            String::new(),
        ),
        Err(EnforcementError::Decision(decision)) => {
            let id = decision.decision_id.clone();
            (denial_of(&decision), id)
        }
        Err(EnforcementError::Approval(_)) => (
            RunOutcome::Denied {
                outcome: "deny",
                reason: "approval_invalid".to_owned(),
            },
            String::new(),
        ),
        Err(EnforcementError::AuditBefore(error) | EnforcementError::AuditAfter(error)) => {
            return Err(RunError::Store(error));
        }
        Err(EnforcementError::Effect(error)) => (
            RunOutcome::Failed {
                reason: error.to_string(),
            },
            String::new(),
        ),
    };

    let events = usize::try_from(store.borrow().event_count()?).unwrap_or(0);
    let hash_chain_verified = store.borrow().verify_hash_chain().is_ok();
    Ok(RunReport {
        run_id,
        outcome,
        decision_id,
        hash_chain_verified,
        events,
        store_path: store_dir.join("facts.db"),
    })
}

/// Build the operator's one-shot approval grant when requested. The
/// grant is bound to the exact request digest and the exact program
/// resource; `process.spawn` always requires it.
fn operator_grant(
    options: &RunOptions,
    request: &CapabilityRequest,
    program_name: &str,
    run_id: &str,
    now: u64,
) -> Result<Option<ApprovalGrant>, RunError> {
    if !options.approved {
        return Ok(None);
    }
    let selector =
        ResourcePattern::exact(Action::ProcessSpawn, format!("process://{program_name}"))
            .map_err(|error| RunError::Policy(error.to_string()))?;
    let approval = ApprovalRequest::new(
        format!("approval-{run_id}"),
        request.clone(),
        selector.clone(),
        "operator approved this exact sandboxed command",
        vec!["run a narrower command".to_owned()],
        ApprovalScope::Once,
        now + 300_000,
    )
    .map_err(|error| RunError::Policy(error.to_string()))?;
    let grant = ApprovalGrant::approve(
        &approval,
        format!("grant-{run_id}"),
        "operator",
        selector,
        now + 300_000,
    )
    .map_err(|error| RunError::Policy(error.to_string()))?;
    Ok(Some(grant))
}

/// The authorized effect: durable intent, fail-closed sandbox execution
/// through the registry, then the verified result — all inside the
/// run's encrypted audit trail.
fn sandboxed_effect<'a>(
    store: Rc<RefCell<EventStore>>,
    registry: &'a mut BackendRegistry,
    options: &RunOptions,
    program_name: &str,
    now: u64,
    sequence: u64,
) -> impl FnOnce() -> Result<ExecOutcome, RunError> + use<'a> {
    let program_dir = options
        .program
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let plan = build_plan(options, &program_dir, program_name);
    let shared = store;
    let workspace = options.workspace_id.clone();
    let arguments = options.arguments.clone();
    let program = program_name.to_owned();
    move || -> Result<ExecOutcome, RunError> {
        {
            let mut store = shared.borrow_mut();
            store.record_effect_intent(&EffectIntent {
                event_id: &format!("event_intent_{sequence}"),
                workspace_id: &workspace,
                intent_id: &format!("intent_{sequence}"),
                effect_kind: "process.spawn",
                payload: &json!({
                    "program": program,
                    "arguments": arguments,
                }),
                occurred_at_ms: now,
                idempotency_key: &format!("intent-idem-{sequence}"),
            })?;
        }
        let outcome = exec_in_registry(registry, &plan).map_err(RunError::from_sandbox)?;
        let exit_code = outcome.exit_code;
        let stdout_bytes = outcome.stdout.len();
        let stderr_bytes = outcome.stderr.len();
        let duration_ms = outcome.duration_ms;
        {
            let mut store = shared.borrow_mut();
            store.record_effect_result(&EffectResult {
                event_id: &format!("event_result_{sequence}"),
                workspace_id: &workspace,
                intent_id: &format!("intent_{sequence}"),
                result: &json!({
                    "exit_code": exit_code,
                    "stdout_bytes": stdout_bytes,
                    "stderr_bytes": stderr_bytes,
                    "duration_ms": duration_ms,
                }),
                disposition: EffectDisposition::Completed,
                occurred_at_ms: now,
                idempotency_key: &format!("result-idem-{sequence}"),
            })?;
        }
        Ok(outcome)
    }
}

impl RunError {
    fn from_sandbox(error: SandboxError) -> Self {
        Self::Policy(format!("sandbox: {error}"))
    }
}
