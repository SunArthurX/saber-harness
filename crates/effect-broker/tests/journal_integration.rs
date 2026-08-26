//! Durable-journal integration: the broker's intent/result ordering against
//! the real encrypted S04 event store.

use std::path::PathBuf;

use saber_effect_broker::journal::{EffectJournal, JournalIntent, JournalResult, test_store};
use saber_event_store::StoreError;
use saber_policy::{
    Action, CapabilityRequest, DataClass, PolicyBundle, PolicyCondition, PolicyEngine, PolicyRule,
    PolicyTier, Principal, PrincipalKind, Resource, ResourcePattern, RuleEffect, sha256_label,
};
use saber_sandbox::fake::{FakeBackend, FakeBackendConfig};
use saber_sandbox::{
    BackendRegistry, BudgetSpec, CommandSpec, EnvSpec, MountSource, MountSpec, NetworkSpec, Realm,
};
use saber_secret_broker::{Channel, SecretBroker};

use saber_effect_broker::{EffectBroker, IsolatedEffect};

struct StaticKeys([u8; 32]);

impl saber_event_store::DatabaseKeyProvider for StaticKeys {
    fn load(&self, _workspace_id: &str) -> Result<saber_event_store::DatabaseKey, StoreError> {
        Ok(saber_event_store::DatabaseKey::new(self.0))
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
                rule_id: "org.spawn".to_owned(),
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

#[test]
fn intent_and_result_are_durable_in_the_encrypted_store() {
    let directory = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
    let provider = StaticKeys([9; 32]);
    let mut store = test_store(&provider, "ws_01", directory.path())
        .unwrap_or_else(|error| unreachable!("{error}"));

    let intent = JournalIntent {
        event_id: "event_1",
        workspace_id: "ws_01",
        intent_id: "intent_1",
        effect_kind: "sandbox.exec",
        action: "process.spawn",
        resource: "process://ws_01/deploy.sh",
        plan_digest: "sha256:plan",
        egress_purpose: None,
        occurred_at_ms: 1_000,
        idempotency_key: "idem_1",
    };
    store
        .record_intent(&intent)
        .unwrap_or_else(|error| unreachable!("{error}"));
    let result = JournalResult {
        event_id: "event_2",
        workspace_id: "ws_01",
        intent_id: "intent_1",
        completed: true,
        occurred_at_ms: 1_001,
        idempotency_key: "idem_2",
    };
    store
        .record_result(&result)
        .unwrap_or_else(|error| unreachable!("{error}"));
    let pending = store
        .pending_effects()
        .unwrap_or_else(|error| unreachable!("{error}"));
    assert!(
        pending.is_empty(),
        "completed intent must leave no pending effect"
    );

    // Replaying identical intents is idempotent.
    store
        .record_intent(&intent)
        .unwrap_or_else(|error| unreachable!("{error}"));
}

#[test]
#[allow(clippy::too_many_lines)]
fn broker_execution_journals_through_the_real_store() {
    let directory = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
    let provider = StaticKeys([9; 32]);
    let mut store = test_store(&provider, "ws_01", directory.path())
        .unwrap_or_else(|error| unreachable!("{error}"));

    let fake = FakeBackend::new(saber_sandbox::Platform::Linux, FakeBackendConfig::default());
    let mut broker = EffectBroker::new(
        engine(),
        saber_policy::MemoryAuditSink::default(),
        BackendRegistry::with_testing_backends(vec![Box::new(fake)]),
        SecretBroker::default(),
        saber_egress::EgressEngine::new(1, Vec::new())
            .unwrap_or_else(|error| unreachable!("{error}")),
    );

    let plan = saber_sandbox::SandboxPlan {
        version: 1,
        workspace_id: "ws_01".to_owned(),
        realm: Realm::S3IsolatedOverlay,
        mounts: vec![
            MountSpec {
                target: "tools".to_owned(),
                source: MountSource::SystemTools {
                    host_path: PathBuf::from("/usr"),
                },
                writable: false,
                executable: true,
            },
            MountSpec {
                target: "scratch".to_owned(),
                source: MountSource::Overlay {
                    host_path: directory.path().to_path_buf(),
                },
                writable: true,
                executable: false,
            },
        ],
        env: EnvSpec::default(),
        budget: BudgetSpec::default_budget(),
        network: NetworkSpec::Denied,
        command: Some(CommandSpec {
            argv: vec!["/tools/bin/build".to_owned()],
            cwd: "/scratch".to_owned(),
            stdin: None,
        }),
    };
    let effect = IsolatedEffect {
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
            Resource::new(Action::ProcessSpawn, "process://ws_01/build.sh")
                .unwrap_or_else(|error| unreachable!("{error}")),
            sha256_label(&[b"build-v1"]),
            None,
            false,
            DataClass::Internal,
            1_000,
        )
        .unwrap_or_else(|error| unreachable!("{error}")),
        plan,
        leases: Vec::new(),
        egress: None,
    };

    let prepared = broker
        .prepare(&effect)
        .unwrap_or_else(|error| unreachable!("{error}"));
    let approval_request = saber_policy::ApprovalRequest::new(
        format!("approval-{}", prepared.digest()),
        prepared,
        saber_policy::ResourcePattern::exact(Action::ProcessSpawn, "process://ws_01/build.sh")
            .unwrap_or_else(|error| unreachable!("{error}")),
        "run the exact build command once",
        vec![
            "approve this exact command once".to_owned(),
            "deny".to_owned(),
        ],
        saber_policy::ApprovalScope::Once,
        2_000,
    )
    .unwrap_or_else(|error| unreachable!("{error}"));
    let grant = saber_policy::ApprovalGrant::approve(
        &approval_request,
        "grant_01",
        "human_01",
        saber_policy::ResourcePattern::exact(Action::ProcessSpawn, "process://ws_01/build.sh")
            .unwrap_or_else(|error| unreachable!("{error}")),
        1_500,
    )
    .unwrap_or_else(|error| unreachable!("{error}"));

    let outcome = broker.execute(&effect, Some(&grant), &mut store, 1_001);
    assert!(
        outcome.is_ok(),
        "permitted spawn must execute through the fake backend: {outcome:?}"
    );
    let pending = store
        .pending_effects()
        .unwrap_or_else(|error| unreachable!("{error}"));
    assert!(pending.is_empty());
    let _ = Channel::EnvVar(String::new());
}
