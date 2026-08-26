//! Crash-recovery integration: a crash between the durable intent and the
//! result leaves exactly one pending effect that replays once under its
//! idempotency key through the real encrypted S04 store.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::sync::{Arc, Mutex};

use saber_effect_broker::journal::test_store;
use saber_event_store::{DatabaseKey, DatabaseKeyProvider, StoreError};
use saber_policy::{
    Action, DataClass, MemoryAuditSink, PolicyBundle, PolicyCondition, PolicyEngine, PolicyRule,
    PolicyTier, ResourcePattern, RuleEffect,
};
use saber_sandbox::fake::{FakeBackend, FakeBackendConfig};
use saber_sandbox::{BackendRegistry, SandboxError};
use saber_secret_broker::SecretBroker;
use saber_tool_broker::{
    FailureKind, ToolArgs, ToolBroker, ToolFailure, ToolInvocation, content_hash, mutation_plan,
    tool_request,
};

struct StaticKeys([u8; 32]);

impl DatabaseKeyProvider for StaticKeys {
    fn load(&self, _workspace_id: &str) -> Result<DatabaseKey, StoreError> {
        Ok(DatabaseKey::new(self.0))
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
                rule_id: "org.write".to_owned(),
                effect: RuleEffect::Permit,
                action: Action::FsWrite,
                resource: ResourcePattern::prefix(Action::FsWrite, "workspace://ws_01")
                    .unwrap_or_else(|error| unreachable!("{error}")),
                condition: PolicyCondition::default(),
                requires_approval: true,
            }],
        )
        .unwrap_or_else(|error| unreachable!("{error}")),
    ])
    .unwrap_or_else(|error| unreachable!("{error}"))
}

fn tool_broker(config: FakeBackendConfig) -> ToolBroker<MemoryAuditSink> {
    let fake = FakeBackend::new(saber_sandbox::Platform::Linux, config);
    ToolBroker::new(saber_effect_broker::EffectBroker::new(
        engine(),
        MemoryAuditSink::default(),
        BackendRegistry::with_testing_backends(vec![Box::new(fake)]),
        SecretBroker::default(),
        saber_egress::EgressEngine::new(1, Vec::new())
            .unwrap_or_else(|error| unreachable!("{error}")),
    ))
}

fn invocation(overlay: &std::path::Path) -> ToolInvocation {
    ToolInvocation {
        request: tool_request(
            "req_crash_1",
            "ws_01",
            "task_01",
            Action::FsWrite,
            "workspace://ws_01/out.txt",
            DataClass::Internal,
            1_000,
        )
        .unwrap_or_else(|error| unreachable!("{error}")),
        plan: mutation_plan(
            "ws_01",
            overlay,
            vec!["/tools/bin/apply".to_owned()],
            Some(b"patched".to_vec()),
        ),
        args: ToolArgs::Patch {
            path: "out.txt".to_owned(),
            expected_before_hash: content_hash(b"original"),
            new_content: b"patched".to_vec(),
        },
        overlay_root: Some(overlay.to_owned()),
    }
}

fn approval(
    broker: &ToolBroker<MemoryAuditSink>,
    invocation: &ToolInvocation,
) -> saber_policy::ApprovalGrant {
    let prepared = broker
        .prepare_invocation(invocation)
        .unwrap_or_else(|error| panic!("{error:?}"));
    let pattern = saber_policy::ResourcePattern::exact(Action::FsWrite, prepared.resource.as_str())
        .unwrap_or_else(|error| panic!("{error:?}"));
    let request = saber_policy::ApprovalRequest::new(
        format!("approval-{}", prepared.digest()),
        prepared,
        pattern.clone(),
        "apply this exact patch once",
        vec![
            "approve this exact patch once".to_owned(),
            "deny".to_owned(),
        ],
        saber_policy::ApprovalScope::Once,
        2_000,
    )
    .unwrap_or_else(|error| panic!("{error:?}"));
    saber_policy::ApprovalGrant::approve(&request, "grant_crash_1", "human_01", pattern, 1_500)
        .unwrap_or_else(|error| unreachable!("{error}"))
}

#[test]
fn crash_between_intent_and_result_replays_exactly_once() {
    let store_dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error:?}"));
    let overlay_dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error:?}"));
    // The journal and the overlay must never share a directory: compensation
    // restores the overlay exactly, which would roll the journal back too.
    let overlay = overlay_dir
        .path()
        .canonicalize()
        .unwrap_or_else(|error| panic!("{error:?}"));
    std::fs::write(overlay.join("out.txt"), b"original")
        .unwrap_or_else(|error| panic!("{error:?}"));
    let provider = StaticKeys([9; 32]);
    let mut store = test_store(&provider, "ws_01", store_dir.path())
        .unwrap_or_else(|error| panic!("{error:?}"));

    // First attempt: the realm fails after the durable intent — the crash
    // window between intent and result.
    let failing = FakeBackendConfig {
        fail_exec: Some(SandboxError::ExecFailed),
        ..FakeBackendConfig::default()
    };
    let mut broker = tool_broker(failing);
    let first = invocation(&overlay);
    let grant = approval(&broker, &first);
    assert!(matches!(
        broker.run(&first, Some(&grant), &mut store, 1_001),
        Err(ToolFailure::Broker(_))
    ));
    let pending = store
        .pending_effects()
        .unwrap_or_else(|error| panic!("{error:?}"));
    assert_eq!(
        pending.len(),
        1,
        "exactly one pending effect after the crash"
    );

    // Recovery: a fresh broker with a healthy realm replays under the same
    // idempotency key; the intent is not duplicated and the effect lands once.
    let exec_count = Arc::new(Mutex::new(0_usize));
    let counted = Arc::clone(&exec_count);
    let mut healthy = FakeBackendConfig {
        simulate_writes: vec![(overlay.join("out.txt"), b"patched".to_vec())],
        ..FakeBackendConfig::default()
    };
    healthy.exec_hook = Some(Arc::new(move || {
        if let Ok(mut guard) = counted.lock() {
            *guard += 1;
        }
    }));
    let mut broker = tool_broker(healthy);
    let retry = invocation(&overlay);
    let grant = approval(&broker, &retry);
    let outcome = broker
        .run(&retry, Some(&grant), &mut store, 1_002)
        .unwrap_or_else(|error| panic!("{error:?}"));
    assert!(outcome.verified);
    assert_eq!(
        *exec_count.lock().unwrap(),
        1,
        "the effect ran exactly once"
    );
    assert_eq!(
        std::fs::read(overlay.join("out.txt")).unwrap_or_else(|error| unreachable!("{error}")),
        b"patched"
    );
    let pending = store
        .pending_effects()
        .unwrap_or_else(|error| panic!("{error:?}"));
    assert!(pending.is_empty(), "replay resolves the pending effect");
}

#[test]
fn verification_failure_is_durable_in_the_store() {
    let store_dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error:?}"));
    let overlay_dir = tempfile::tempdir().unwrap_or_else(|error| panic!("{error:?}"));
    // The journal and the overlay must never share a directory: compensation
    // restores the overlay exactly, which would roll the journal back too.
    let overlay = overlay_dir
        .path()
        .canonicalize()
        .unwrap_or_else(|error| panic!("{error:?}"));
    std::fs::write(overlay.join("out.txt"), b"original")
        .unwrap_or_else(|error| panic!("{error:?}"));
    let provider = StaticKeys([9; 32]);
    let mut store = test_store(&provider, "ws_01", store_dir.path())
        .unwrap_or_else(|error| panic!("{error:?}"));

    // The realm claims success but writes nothing: forged success.
    let mut broker = tool_broker(FakeBackendConfig::default());
    let forged = invocation(&overlay);
    let grant = approval(&broker, &forged);
    match broker.run(&forged, Some(&grant), &mut store, 1_001) {
        Err(ToolFailure::Verify {
            kind, compensated, ..
        }) => {
            assert_eq!(kind, FailureKind::NonRetriable);
            assert!(compensated);
        }
        other => panic!("expected forged-success rejection, got {other:?}"),
    }
    // The tool-level verification effect resolved durably as failed.
    let pending = store
        .pending_effects()
        .unwrap_or_else(|error| panic!("{error:?}"));
    assert!(
        pending
            .iter()
            .all(|effect| effect.effect_kind == "tool.verify"),
        "only the verification effect may remain unverified-by-higher-evidence"
    );
    assert_eq!(
        std::fs::read(overlay.join("out.txt")).unwrap_or_else(|error| unreachable!("{error}")),
        b"original",
        "compensation restores the original content"
    );
}
