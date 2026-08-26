//! The single composition point that makes S05 policy decisions enforceable
//! at the OS and network boundary.
//!
//! [`EffectBroker`] executes one [`IsolatedEffect`] in a fixed order:
//! validate the plan, authorize egress when the action touches the network,
//! select a healthy sandbox backend fail-closed, allocate the realm, prepare
//! the exact `sandboxed=true` capability request, durably journal the intent,
//! run the S05 audit-before-effect enforcement with secret lease injection,
//! redact captured output, destroy the realm and journal the verified result.
//! Policy, sandbox health, secret custody, egress or audit failure executes
//! zero effects (ADR-008).

pub mod journal;
pub mod plugin_host;

use std::collections::BTreeMap;

pub use journal::{EffectJournal, JournalIntent, JournalResult};
pub use plugin_host::{
    CIRCUIT_FAILURE_THRESHOLD, DeclaredAction, HostError, PluginHost, PluginManifest,
};

use saber_egress::{EgressDecision, EgressEngine, EgressReason, EgressRequest};
use saber_policy::{
    ApprovalGrant, CapabilityRequest, DataClass, DecisionAuditSink, EnforcementError,
    MemoryAuditSink, PolicyDecision, PolicyEnforcer, PolicyEngine, PolicyError, sha256_label,
};
use saber_sandbox::{
    BackendRegistry, PlanError, RealmHandle, RedactableValue, SandboxError, SandboxPlan,
    ValidatedPlan,
};
use saber_secret_broker::{BrokerError, Channel, LeaseRequest, SecretBroker};

/// Everything one isolated effect needs.
pub struct IsolatedEffect {
    /// The exact S05 request with `sandboxed=false`; the broker rewrites it
    /// after realm allocation and the approval must bind the rewritten form.
    pub request: CapabilityRequest,
    /// The sandbox plan describing realm, mounts, env, budget and network.
    pub plan: SandboxPlan,
    /// Secret leases the effect needs, bound to the request digest.
    pub leases: Vec<LeaseRequest>,
    /// The egress request when the action touches the network.
    pub egress: Option<EgressRequest>,
}

/// Outcome of a successfully executed isolated effect; output is redacted.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EffectOutcome {
    /// Redacted stdout.
    pub stdout: Vec<u8>,
    /// Redacted stderr.
    pub stderr: Vec<u8>,
    /// Child exit code when it terminated normally.
    pub exit_code: Option<i32>,
    /// Wall-clock duration in milliseconds.
    pub duration_ms: u64,
    /// Whether captured output was truncated.
    pub truncated: bool,
    /// Whether the child was killed by the deadline.
    pub killed: bool,
    /// Number of secret redactions applied to captured output.
    pub redactions: usize,
    /// Egress decision reason when the action touched the network.
    pub egress_reason: Option<EgressReason>,
}

/// Errors produced inside the enforcement closure.
#[derive(Debug)]
pub enum ClosureError {
    /// A sandbox operation failed.
    Sandbox(SandboxError),
    /// The secret broker refused a lease.
    Secret(BrokerError),
}

/// Failure taxonomy of the broker. Every variant means zero or fully
/// reconciled effects.
#[derive(Debug)]
pub enum BrokerFailure<AuditError, JournalError> {
    /// The sandbox plan was invalid.
    Plan(PlanError),
    /// No healthy sandbox backend covered the plan, or a backend operation
    /// failed before/after the effect.
    Sandbox(SandboxError),
    /// The egress PEP denied the request.
    EgressDenied(EgressDecision),
    /// The secret broker refused a lease.
    Secret(BrokerError),
    /// Policy denied or still requires approval.
    Policy(PolicyDecision),
    /// A supplied approval was invalid.
    Approval(PolicyError),
    /// The intent could not be durably recorded before any audit or effect.
    Journal(JournalError),
    /// The decision could not be durably audited before the effect.
    AuditBefore(AuditError),
    /// The enforcement-result audit needs reconciliation.
    AuditAfter(AuditError),
    /// The verified result could not be journaled; the effect ran and this is
    /// an explicit reconciliation case.
    JournalAfter(JournalError),
}

/// The composition point.
pub struct EffectBroker<Sink>
where
    Sink: DecisionAuditSink,
{
    registry: BackendRegistry,
    egress: EgressEngine,
    enforcer: PolicyEnforcer<Sink>,
    secrets: SecretBroker,
}

impl<Sink> EffectBroker<Sink>
where
    Sink: DecisionAuditSink,
{
    /// Compose a broker from its policy engine, audit sink, sandbox registry,
    /// secret custody and egress policy.
    #[must_use]
    pub fn new(
        engine: PolicyEngine,
        sink: Sink,
        registry: BackendRegistry,
        secrets: SecretBroker,
        egress: EgressEngine,
    ) -> Self {
        Self {
            registry,
            secrets,
            egress,
            enforcer: PolicyEnforcer::new(engine, sink),
        }
    }

    /// Mutable access to the secret broker for out-of-band registration.
    #[must_use]
    pub fn secrets_mut(&mut self) -> &mut SecretBroker {
        &mut self.secrets
    }

    /// The exact request this broker will evaluate for one effect; approvals
    /// must bind this rewritten `sandboxed=true` form.
    ///
    /// # Errors
    ///
    /// Invalid plans propagate before any backend contact.
    pub fn prepare(&self, effect: &IsolatedEffect) -> Result<CapabilityRequest, PlanError> {
        effect.plan.validate()?;
        CapabilityRequest::new(
            effect.request.request_id.clone(),
            effect.request.principal.clone(),
            effect.request.workspace_id.clone(),
            effect.request.task_id.clone(),
            effect.request.action,
            effect.request.resource.clone(),
            effect.request.operation_hash.clone(),
            effect.request.credential_ref.clone(),
            true,
            effect.request.data_class,
            effect.request.occurred_at_ms,
        )
        .map_err(|_| PlanError::RealmViolation)
    }

    /// Execute one isolated effect under the full boundary stack.
    ///
    /// # Errors
    ///
    /// Every [`BrokerFailure`] variant guarantees zero effects or an
    /// explicitly reconciled result-journal failure.
    #[allow(clippy::result_large_err, clippy::too_many_lines)]
    pub fn execute<JournalError>(
        &mut self,
        effect: &IsolatedEffect,
        approval: Option<&ApprovalGrant>,
        journal: &mut dyn EffectJournal<Error = JournalError>,
        now_ms: u64,
    ) -> Result<EffectOutcome, BrokerFailure<Sink::Error, JournalError>> {
        let validated = effect.plan.validate().map_err(BrokerFailure::Plan)?;
        let mut egress_reason: Option<EgressReason> = None;
        if effect.request.action.descriptor().requires_network() {
            let Some(egress_request) = &effect.egress else {
                return Err(BrokerFailure::EgressDenied(
                    self.egress.authorize(&missing_egress()),
                ));
            };
            if let Some(purpose) = mediated_purpose(&validated)
                && egress_request.purpose != purpose
            {
                return Err(BrokerFailure::EgressDenied(
                    self.egress.authorize(&missing_egress()),
                ));
            }
            let decision = self.egress.authorize(egress_request);
            if decision.reason != EgressReason::Allow {
                return Err(BrokerFailure::EgressDenied(decision));
            }
            egress_reason = Some(decision.reason);
        } else if effect.egress.is_some() {
            return Err(BrokerFailure::EgressDenied(EgressDecision {
                decision_id: sha256_label(&[b"egress-not-required"]),
                reason: EgressReason::DefaultDeny,
                authorization: None,
            }));
        }

        let selection = self
            .registry
            .select_for(&validated)
            .map_err(BrokerFailure::Sandbox)?;
        let backend = self
            .registry
            .backend_mut(selection.index)
            .map_err(BrokerFailure::Sandbox)?;
        let handle: RealmHandle = match backend.create(&validated) {
            Ok(handle) => handle,
            Err(error) => return Err(BrokerFailure::Sandbox(error)),
        };

        let prepared = match self.prepare(effect) {
            Ok(prepared) => prepared,
            Err(error) => {
                self.destroy_realm(selection.index, &handle);
                return Err(BrokerFailure::Plan(error));
            }
        };

        let request_digest = prepared.digest();
        let intent = JournalIntent {
            event_id: &format!("event-{request_digest}"),
            workspace_id: &prepared.workspace_id,
            intent_id: &format!("intent-{request_digest}"),
            effect_kind: "sandbox.exec",
            action: prepared.action.as_str(),
            resource: prepared.resource.as_str(),
            plan_digest: &validated.digest,
            egress_purpose: effect.egress.as_ref().map(|req| req.purpose.as_str()),
            occurred_at_ms: now_ms,
            idempotency_key: &format!("idem-{request_digest}"),
        };
        if let Err(error) = journal.record_intent(&intent) {
            self.destroy_realm(selection.index, &handle);
            return Err(BrokerFailure::Journal(error));
        }

        let command = validated.plan.command.clone();
        let mounts = validated.plan.mounts.clone();
        let network = validated.plan.network.clone();
        let lease_requests = effect.leases.clone();
        let mut captured: Option<EffectOutcome> = None;

        let enforcement = {
            let secrets = &mut self.secrets;
            let registry = &mut self.registry;
            self.enforcer.execute(&prepared, approval, now_ms, || {
                let backend = registry
                    .backend_mut(selection.index)
                    .map_err(ClosureError::Sandbox)?;
                for mount in &mounts {
                    backend
                        .mount(&handle, mount)
                        .map_err(ClosureError::Sandbox)?;
                }
                backend
                    .network(&handle, &network)
                    .map_err(ClosureError::Sandbox)?;
                let mut injected: BTreeMap<String, RedactableValue> = BTreeMap::new();
                for lease_request in &lease_requests {
                    let lease = secrets
                        .issue(lease_request, now_ms)
                        .map_err(ClosureError::Secret)?;
                    let material = secrets
                        .consume(&lease.lease_id, &request_digest, now_ms)
                        .map_err(ClosureError::Secret)?;
                    for channel in &lease.channels {
                        if let Channel::EnvVar(key) = channel {
                            injected
                                .insert(key.clone(), RedactableValue(material.expose().to_owned()));
                        }
                    }
                }
                let command = command
                    .clone()
                    .ok_or(ClosureError::Sandbox(SandboxError::PlanViolation))?;
                let mut outcome = backend
                    .exec(&handle, &command, injected)
                    .map_err(ClosureError::Sandbox)?;
                let mut redactions = secrets.redact(&mut outcome.stdout);
                redactions += secrets.redact(&mut outcome.stderr);
                captured = Some(EffectOutcome {
                    stdout: outcome.stdout,
                    stderr: outcome.stderr,
                    exit_code: outcome.exit_code,
                    duration_ms: outcome.duration_ms,
                    truncated: outcome.truncated,
                    killed: outcome.killed,
                    redactions,
                    egress_reason,
                });
                Ok::<(), ClosureError>(())
            })
        };

        self.destroy_realm(selection.index, &handle);

        match enforcement {
            Ok(()) => {
                let outcome = captured.unwrap_or(EffectOutcome {
                    stdout: Vec::new(),
                    stderr: Vec::new(),
                    exit_code: None,
                    duration_ms: 0,
                    truncated: false,
                    killed: false,
                    redactions: 0,
                    egress_reason: None,
                });
                let result = JournalResult {
                    event_id: &format!("event-result-{request_digest}"),
                    workspace_id: &prepared.workspace_id,
                    intent_id: &format!("intent-{request_digest}"),
                    completed: true,
                    occurred_at_ms: now_ms,
                    idempotency_key: &format!("idem-result-{request_digest}"),
                };
                if let Err(error) = journal.record_result(&result) {
                    return Err(BrokerFailure::JournalAfter(error));
                }
                Ok(outcome)
            }
            Err(EnforcementError::Decision(decision)) => Err(BrokerFailure::Policy(decision)),
            Err(EnforcementError::Approval(error)) => Err(BrokerFailure::Approval(error)),
            Err(EnforcementError::AuditBefore(error)) => Err(BrokerFailure::AuditBefore(error)),
            Err(EnforcementError::Effect(ClosureError::Sandbox(error))) => {
                Err(BrokerFailure::Sandbox(error))
            }
            Err(EnforcementError::Effect(ClosureError::Secret(error))) => {
                Err(BrokerFailure::Secret(error))
            }
            Err(EnforcementError::AuditAfter(error)) => Err(BrokerFailure::AuditAfter(error)),
        }
    }

    fn destroy_realm(&mut self, index: usize, handle: &RealmHandle) {
        if let Ok(backend) = self.registry.backend_mut(index) {
            let _ = backend.destroy(handle);
        }
    }
}

fn missing_egress() -> EgressRequest {
    EgressRequest {
        purpose: "missing".to_owned(),
        scheme: "https".to_owned(),
        host: "denied.invalid".to_owned(),
        port: 443,
        data_class: DataClass::Public,
        taints: Vec::new(),
        credential_ref: None,
        payload_len: 0,
    }
}

fn mediated_purpose(plan: &ValidatedPlan) -> Option<String> {
    match &plan.plan.network {
        saber_sandbox::NetworkSpec::Mediated { purpose } => Some(purpose.clone()),
        saber_sandbox::NetworkSpec::Denied => None,
    }
}

/// Convenience alias for tests building brokers with the in-memory sink.
pub type MemoryEffectBroker = EffectBroker<MemoryAuditSink>;

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::items_after_statements
    )]
    use std::sync::{Arc, Mutex};

    use saber_egress::{DestinationPattern, EgressRule, RedirectPolicy, TaintKind};
    use saber_policy::{
        Action, PolicyBundle, PolicyCondition, PolicyRule, PolicyTier, Principal, PrincipalKind,
        Resource, ResourcePattern, RuleEffect,
    };
    use saber_sandbox::fake::{FakeBackend, FakeBackendConfig, RecordedOp};
    use saber_sandbox::{
        BackendRegistry, BudgetSpec, CommandSpec, EnvSpec, MountSource, MountSpec, NetworkSpec,
        Realm,
    };

    use super::*;

    const SECRET: &str = "sk-live-DEPLOY1234567890";

    #[derive(Default)]
    struct MemoryJournal {
        unavailable: bool,
        intents: usize,
        results: usize,
    }

    impl EffectJournal for MemoryJournal {
        type Error = &'static str;

        fn record_intent(&mut self, _intent: &JournalIntent<'_>) -> Result<(), Self::Error> {
            self.intents += 1;
            if self.unavailable {
                return Err("journal_unavailable");
            }
            Ok(())
        }

        fn record_result(&mut self, _result: &JournalResult<'_>) -> Result<(), Self::Error> {
            self.results += 1;
            if self.unavailable {
                return Err("journal_unavailable");
            }
            Ok(())
        }
    }

    fn engine() -> PolicyEngine {
        PolicyEngine::new(vec![
            PolicyBundle::new(PolicyTier::PlatformHard, "platform-v1", 1, Vec::new())
                .unwrap_or_else(|error| unreachable!("{error}")),
            PolicyBundle::new(
                PolicyTier::Organization,
                "org-v1",
                1,
                vec![PolicyRule {
                    rule_id: "org.exec".to_owned(),
                    effect: RuleEffect::Permit,
                    action: Action::ProcessSpawn,
                    resource: ResourcePattern::prefix(Action::ProcessSpawn, "process://ws_01")
                        .unwrap_or_else(|error| unreachable!("{error}")),
                    condition: PolicyCondition::default(),
                    requires_approval: false,
                }],
            )
            .unwrap_or_else(|error| unreachable!("{error}")),
        ])
        .unwrap_or_else(|error| unreachable!("{error}"))
    }

    fn egress_engine() -> EgressEngine {
        EgressEngine::new(
            1,
            vec![EgressRule {
                purpose: "model-provider".to_owned(),
                destinations: vec![DestinationPattern::Domain {
                    host: "api.model.example".to_owned(),
                    subdomains: true,
                }],
                schemes: vec!["https".to_owned()],
                max_data_class: DataClass::Internal,
                redirect: RedirectPolicy::SameHost,
                allow_ip_literals: false,
            }],
        )
        .unwrap_or_else(|error| unreachable!("{error}"))
    }

    fn secrets() -> SecretBroker {
        let mut broker = SecretBroker::default();
        broker
            .register(
                "credential://broker/deploy",
                SECRET,
                vec![Channel::EnvVar("DEPLOY_TOKEN".to_owned())],
                vec!["deploy".to_owned()],
            )
            .unwrap_or_else(|error| unreachable!("{error}"));
        broker
    }

    fn s3_plan() -> SandboxPlan {
        SandboxPlan {
            version: 1,
            workspace_id: "ws_01".to_owned(),
            realm: Realm::S3IsolatedOverlay,
            mounts: vec![
                MountSpec {
                    target: "tools".to_owned(),
                    source: MountSource::SystemTools {
                        host_path: std::env::temp_dir(),
                    },
                    writable: false,
                    executable: true,
                },
                MountSpec {
                    target: "scratch".to_owned(),
                    source: MountSource::Overlay {
                        host_path: std::env::temp_dir(),
                    },
                    writable: true,
                    executable: false,
                },
            ],
            env: EnvSpec {
                allow: BTreeMap::new(),
                lease_channels: vec!["DEPLOY_TOKEN".to_owned()],
            },
            budget: BudgetSpec::default_budget(),
            network: NetworkSpec::Denied,
            command: Some(CommandSpec {
                argv: vec!["/tools/bin/deploy".to_owned()],
                cwd: "/scratch".to_owned(),
                stdin: None,
            }),
        }
    }

    fn effect() -> IsolatedEffect {
        IsolatedEffect {
            request: CapabilityRequest::new(
                "req_01",
                Principal {
                    id: "runtime_01".to_owned(),
                    kind: PrincipalKind::AgentRuntime,
                    on_behalf_of: Some("human_01".to_owned()),
                },
                "ws_01",
                "task_01",
                Action::ProcessSpawn,
                Resource::new(Action::ProcessSpawn, "process://ws_01/deploy.sh")
                    .unwrap_or_else(|error| unreachable!("{error}")),
                sha256_label(&[b"deploy-v1"]),
                None,
                false,
                DataClass::Internal,
                1_000,
            )
            .unwrap_or_else(|error| unreachable!("{error}")),
            plan: s3_plan(),
            leases: Vec::new(),
            egress: None,
        }
    }

    fn broker(fake: FakeBackend) -> EffectBroker<saber_policy::MemoryAuditSink> {
        let registry = BackendRegistry::with_testing_backends(vec![Box::new(fake)]);
        EffectBroker::new(
            engine(),
            saber_policy::MemoryAuditSink::default(),
            registry,
            secrets(),
            egress_engine(),
        )
    }

    fn approval_for(
        broker: &EffectBroker<saber_policy::MemoryAuditSink>,
        effect: &IsolatedEffect,
    ) -> saber_policy::ApprovalGrant {
        let prepared = broker
            .prepare(effect)
            .unwrap_or_else(|error| unreachable!("{error}"));
        let request = saber_policy::ApprovalRequest::new(
            format!("approval-{}", prepared.digest()),
            prepared.clone(),
            saber_policy::ResourcePattern::exact(Action::ProcessSpawn, prepared.resource.as_str())
                .unwrap_or_else(|error| unreachable!("{error}")),
            "run the exact deploy script once",
            vec![
                "approve this exact command once".to_owned(),
                "deny".to_owned(),
            ],
            saber_policy::ApprovalScope::Once,
            2_000,
        )
        .unwrap_or_else(|error| unreachable!("{error}"));
        saber_policy::ApprovalGrant::approve(
            &request,
            format!("grant-{}", prepared.digest()),
            "human_01",
            saber_policy::ResourcePattern::exact(Action::ProcessSpawn, prepared.resource.as_str())
                .unwrap_or_else(|error| unreachable!("{error}")),
            1_500,
        )
        .unwrap_or_else(|error| unreachable!("{error}"))
    }

    #[test]
    fn happy_path_executes_realm_and_journals_intent_and_result() {
        let ops = Arc::new(Mutex::new(Vec::new()));
        let mut fake = FakeBackend::new(
            saber_sandbox::Platform::Linux,
            FakeBackendConfig {
                ops_sink: Some(Arc::clone(&ops)),
                ..FakeBackendConfig::default()
            },
        );
        fake.config_mut()
            .exec_results
            .push_back(saber_sandbox::ExecOutcome {
                exit_code: Some(0),
                stdout: format!("deployed with {SECRET}").into_bytes(),
                stderr: Vec::new(),
                duration_ms: 12,
                truncated: false,
                killed: false,
            });
        let mut broker = broker(fake);
        let grant = approval_for(&broker, &effect());
        let mut journal = MemoryJournal::default();
        let outcome = broker
            .execute(&effect(), Some(&grant), &mut journal, 1_001)
            .unwrap_or_else(|error| unreachable!("execute must succeed: {error:?}"));
        assert_eq!(outcome.exit_code, Some(0));
        assert_eq!(outcome.redactions, 1);
        assert!(
            !String::from_utf8_lossy(&outcome.stdout).contains(SECRET),
            "stdout must be redacted"
        );
        assert_eq!(journal.intents, 1);
        assert_eq!(journal.results, 1);
        let recorded = ops.lock().map(|guard| guard.clone()).unwrap_or_default();
        assert_eq!(recorded.len(), 6);
        assert!(matches!(
            recorded.last(),
            Some(RecordedOp::Destroyed { .. })
        ));
        assert!(recorded.iter().any(|op| matches!(
            op,
            RecordedOp::Executed { env_keys, .. } if env_keys.is_empty()
        )));
    }

    fn deny_engine() -> PolicyEngine {
        PolicyEngine::new(vec![
            PolicyBundle::new(PolicyTier::PlatformHard, "platform-v1", 1, Vec::new())
                .unwrap_or_else(|error| unreachable!("{error}")),
        ])
        .unwrap_or_else(|error| unreachable!("{error}"))
    }

    fn deny_broker() -> EffectBroker<saber_policy::MemoryAuditSink> {
        let fake = FakeBackend::new(saber_sandbox::Platform::Linux, FakeBackendConfig::default());
        EffectBroker::new(
            deny_engine(),
            saber_policy::MemoryAuditSink::default(),
            BackendRegistry::with_testing_backends(vec![Box::new(fake)]),
            secrets(),
            egress_engine(),
        )
    }

    #[test]
    fn policy_denial_leaves_zero_effects_and_no_realm() {
        let mut broker = deny_broker();
        let mut denied_effect = effect();
        denied_effect.plan.command = Some(CommandSpec {
            argv: vec!["/tools/bin/evil".to_owned()],
            cwd: "/scratch".to_owned(),
            stdin: None,
        });
        let mut journal = MemoryJournal::default();
        match broker.execute(&denied_effect, None, &mut journal, 1_001) {
            Err(BrokerFailure::Policy(decision)) => {
                assert_eq!(
                    decision.outcome,
                    saber_policy::DecisionOutcome::Deny,
                    "default deny must reject unpermitted spawn"
                );
                assert_eq!(decision.reason, saber_policy::DecisionReason::DefaultDeny);
            }
            other => unreachable!("expected policy denial, got {other:?}"),
        }
        assert_eq!(journal.intents, 1);
        assert_eq!(journal.results, 0);
    }

    #[test]
    fn journal_failure_runs_zero_effects() {
        let fake = FakeBackend::new(saber_sandbox::Platform::Linux, FakeBackendConfig::default());
        let mut broker = broker(fake);
        let mut journal = MemoryJournal {
            unavailable: true,
            intents: 0,
            results: 0,
        };
        assert!(matches!(
            broker.execute(&effect(), None, &mut journal, 1_001),
            Err(BrokerFailure::Journal(_))
        ));
    }

    #[test]
    fn egress_default_deny_blocks_network_actions_without_request() {
        let fake = FakeBackend::new(saber_sandbox::Platform::Linux, FakeBackendConfig::default());
        let mut broker = broker(fake);
        let mut network_effect = effect();
        network_effect.request = CapabilityRequest::new(
            "req_03",
            Principal {
                id: "runtime_01".to_owned(),
                kind: PrincipalKind::AgentRuntime,
                on_behalf_of: None,
            },
            "ws_01",
            "task_01",
            Action::NetworkHttp,
            Resource::new(Action::NetworkHttp, "network://api.model.example/https")
                .unwrap_or_else(|error| unreachable!("{error}")),
            sha256_label(&[b"net-v1"]),
            None,
            false,
            DataClass::Internal,
            1_000,
        )
        .unwrap_or_else(|error| unreachable!("{error}"));
        network_effect.egress = None;
        let mut journal = MemoryJournal::default();
        match broker.execute(&network_effect, None, &mut journal, 1_001) {
            Err(BrokerFailure::EgressDenied(decision)) => {
                assert_ne!(decision.reason, EgressReason::Allow);
            }
            other => unreachable!("expected egress denial, got {other:?}"),
        }
        assert_eq!(journal.intents, 0);

        network_effect.egress = Some(EgressRequest {
            purpose: "model-provider".to_owned(),
            scheme: "https".to_owned(),
            host: "api.model.example".to_owned(),
            port: 443,
            data_class: DataClass::Internal,
            taints: vec![TaintKind::Secret],
            credential_ref: None,
            payload_len: 10,
        });
        match broker.execute(&network_effect, None, &mut journal, 1_001) {
            Err(BrokerFailure::EgressDenied(decision)) => {
                assert_eq!(decision.reason, EgressReason::TaintedPayload);
            }
            other => unreachable!("expected taint denial, got {other:?}"),
        }
    }

    #[test]
    fn unavailable_backend_denies_fail_closed() {
        let mut broker = EffectBroker::new(
            engine(),
            saber_policy::MemoryAuditSink::default(),
            BackendRegistry::with_testing_backends(Vec::new()),
            secrets(),
            egress_engine(),
        );
        let mut journal = MemoryJournal::default();
        assert!(matches!(
            broker.execute(&effect(), None, &mut journal, 1_001),
            Err(BrokerFailure::Sandbox(_))
        ));
        assert_eq!(journal.intents, 0);
    }

    #[test]
    fn audit_failure_runs_zero_effects() {
        let fake = FakeBackend::new(saber_sandbox::Platform::Linux, FakeBackendConfig::default());
        let mut broker = EffectBroker::new(
            engine(),
            saber_policy::MemoryAuditSink {
                unavailable: true,
                ..saber_policy::MemoryAuditSink::default()
            },
            BackendRegistry::with_testing_backends(vec![Box::new(fake)]),
            secrets(),
            egress_engine(),
        );
        let mut journal = MemoryJournal::default();
        assert!(matches!(
            broker.execute(&effect(), None, &mut journal, 1_001),
            Err(BrokerFailure::AuditBefore(_))
        ));
    }

    #[test]
    fn secret_lease_failures_execute_zero_effects() {
        let fake = FakeBackend::new(saber_sandbox::Platform::Linux, FakeBackendConfig::default());
        let mut broker = broker(fake);
        let mut leased = effect();
        leased.leases = vec![LeaseRequest {
            credential_ref: "credential://broker/missing".to_owned(),
            request_digest: String::new(),
            channels: vec![Channel::EnvVar("DEPLOY_TOKEN".to_owned())],
            purpose: "deploy".to_owned(),
            expires_at_ms: 2_000,
        }];
        let grant = approval_for(&broker, &leased);
        let mut journal = MemoryJournal::default();
        match broker.execute(&leased, Some(&grant), &mut journal, 1_001) {
            Err(BrokerFailure::Secret(error)) => {
                assert_eq!(error, BrokerError::UnknownReference);
            }
            other => unreachable!("expected secret failure, got {other:?}"),
        }
    }

    #[test]
    fn healthy_secret_lease_injects_and_redacts() {
        let mut fake =
            FakeBackend::new(saber_sandbox::Platform::Linux, FakeBackendConfig::default());
        fake.config_mut()
            .exec_results
            .push_back(saber_sandbox::ExecOutcome {
                exit_code: Some(0),
                stdout: format!("token={SECRET}").into_bytes(),
                stderr: Vec::new(),
                duration_ms: 5,
                truncated: false,
                killed: false,
            });
        let mut broker = broker(fake);
        let mut leased = effect();
        let digest = broker
            .prepare(&leased)
            .unwrap_or_else(|error| unreachable!("{error}"))
            .digest();
        leased.leases = vec![LeaseRequest {
            credential_ref: "credential://broker/deploy".to_owned(),
            request_digest: digest,
            channels: vec![Channel::EnvVar("DEPLOY_TOKEN".to_owned())],
            purpose: "deploy".to_owned(),
            expires_at_ms: 60_000,
        }];
        let grant = approval_for(&broker, &leased);
        let mut journal = MemoryJournal::default();
        let outcome = broker
            .execute(&leased, Some(&grant), &mut journal, 1_001)
            .unwrap_or_else(|_| unreachable!("leased execute must succeed"));
        assert_eq!(outcome.redactions, 1);
        assert!(
            !String::from_utf8_lossy(&outcome.stdout).contains(SECRET),
            "leased material must be redacted from captured output"
        );
    }
}
