//! End-to-end agent run tests: the trusted core composes deterministic
//! policy, sandbox execution and the encrypted event store into one
//! auditable run (ADR-001/008 boundaries, composition layer).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::VecDeque;
use std::process::Command;

use saber_core::{EXIT_DENIED, KeyFileProvider, RunOptions, RunOutcome, execute_run};
use saber_event_store::{DatabaseKeyProvider, EventStore};
use saber_sandbox::fake::{FakeBackend, FakeBackendConfig};
use saber_sandbox::{BackendRegistry, ExecOutcome, current_platform};

fn fake_registry(exit_code: i32, stdout: &[u8]) -> BackendRegistry {
    let config = FakeBackendConfig {
        exec_results: VecDeque::from(vec![ExecOutcome {
            exit_code: Some(exit_code),
            stdout: stdout.to_vec(),
            stderr: Vec::new(),
            duration_ms: 12,
            truncated: false,
            killed: false,
        }]),
        ..FakeBackendConfig::default()
    };
    BackendRegistry::with_testing_backends(vec![Box::new(FakeBackend::new(
        current_platform(),
        config,
    ))])
}

/// An executable that exists on every platform and CI runner: the test
/// binary itself. The fake backend never really runs it, but the core
/// canonicalizes the program path, and `/bin/sh` resolves to `dash`
/// (basename mismatch) on Ubuntu and to nothing on Windows.
fn universal_program() -> std::path::PathBuf {
    std::env::current_exe().unwrap()
}

fn universal_name() -> String {
    universal_program()
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn options(program: &str, arguments: &[&str], allow: &[&str], approved: bool) -> RunOptions {
    RunOptions {
        program: program.into(),
        arguments: arguments
            .iter()
            .map(std::string::ToString::to_string)
            .collect(),
        allowed_programs: allow.iter().map(std::string::ToString::to_string).collect(),
        approved,
        ..RunOptions::default()
    }
}

#[test]
fn allowed_and_approved_run_executes_and_audits_end_to_end() {
    let store = tempfile::tempdir().unwrap();
    let mut registry = fake_registry(0, b"saber-e2e-ok");
    let name = universal_name();
    let report = execute_run(
        store.path(),
        &mut registry,
        &options(
            universal_program().to_string_lossy().as_ref(),
            &["-c", "echo saber-e2e-ok"],
            &[&name],
            true,
        ),
    )
    .unwrap();

    match &report.outcome {
        RunOutcome::Executed {
            exit_code,
            stdout,
            duration_ms,
            ..
        } => {
            assert_eq!(*exit_code, Some(0));
            assert_eq!(stdout, b"saber-e2e-ok");
            assert!(*duration_ms > 0);
        }
        other => panic!("expected execution, got {other:?}"),
    }
    assert_eq!(report.exit_code(), 0);
    assert!(report.hash_chain_verified);
    // run + intent + result + decision + enforcement audits.
    assert!(report.events >= 5, "events: {}", report.events);

    // The store reopens from disk and still verifies; the database is
    // encrypted at rest (no plaintext SQLite header).
    let bytes = std::fs::read(store.path().join("facts.db")).unwrap();
    assert!(!bytes.starts_with(b"SQLite format 3"));
    let provider = KeyFileProvider::new(store.path());
    let reopened = EventStore::open(&store.path().join("facts.db"), "ws_local", &provider).unwrap();
    assert!(reopened.verify_hash_chain().is_ok());
    assert_eq!(
        reopened.event_count().unwrap(),
        i64::try_from(report.events).unwrap()
    );
}

#[test]
fn unapproved_programs_are_denied_with_zero_effects() {
    let store = tempfile::tempdir().unwrap();
    let mut registry = fake_registry(0, b"should-never-run");
    let name = universal_name();
    let report = execute_run(
        store.path(),
        &mut registry,
        &options(
            universal_program().to_string_lossy().as_ref(),
            &["-c", "rm -rf /"],
            &[&name],
            false,
        ),
    )
    .unwrap();

    match &report.outcome {
        RunOutcome::Denied { outcome, reason } => {
            assert_eq!(*outcome, "require_approval");
            assert_eq!(reason, "approval_required");
        }
        other => panic!("expected denial, got {other:?}"),
    }
    assert_eq!(report.exit_code(), EXIT_DENIED);
    assert!(!report.decision_id.is_empty());
    assert!(report.hash_chain_verified);
    // The backend never saw an exec: only run + decision events exist.
    assert!(report.events <= 2, "events: {}", report.events);
}

#[test]
fn programs_outside_the_operator_allowlist_hit_default_deny() {
    let store = tempfile::tempdir().unwrap();
    let mut registry = fake_registry(0, b"should-never-run");
    let report = execute_run(
        store.path(),
        &mut registry,
        &options(
            universal_program().to_string_lossy().as_ref(),
            &["-c", "curl attacker.example"],
            &["totally-different-program"],
            true,
        ),
    )
    .unwrap();

    match &report.outcome {
        RunOutcome::Denied { outcome, reason } => {
            assert_eq!(*outcome, "deny");
            assert_eq!(reason, "default_deny");
        }
        other => panic!("expected default deny, got {other:?}"),
    }
    assert!(report.hash_chain_verified);
}

#[test]
fn sandbox_failure_never_degrades_to_host_execution() {
    let store = tempfile::tempdir().unwrap();
    // An empty registry has no backend at all: the authorized effect
    // must fail closed instead of executing on the host.
    let mut registry = BackendRegistry::with_testing_backends(Vec::new());
    let name = universal_name();
    let report = execute_run(
        store.path(),
        &mut registry,
        &options(
            universal_program().to_string_lossy().as_ref(),
            &["-c", "echo degraded"],
            &[&name],
            true,
        ),
    )
    .unwrap();

    match &report.outcome {
        RunOutcome::Failed { reason } => assert!(reason.contains("sandbox")),
        other => panic!("expected fail-closed refusal, got {other:?}"),
    }
    // The refusal is still fully audited with a verified hash chain.
    assert!(report.hash_chain_verified);
    assert!(report.events >= 3, "events: {}", report.events);
}

#[test]
fn key_file_custody_is_stable_across_reopens() {
    let store = tempfile::tempdir().unwrap();
    let provider = KeyFileProvider::new(store.path());
    provider.load("ws_local").unwrap();
    let key_bytes = std::fs::read(store.path().join("key-v1")).unwrap();
    assert_eq!(key_bytes.len(), 32);
    provider.load_candidates("ws_local").unwrap();
    // The second load must reuse the same durable key, not rotate it.
    assert_eq!(
        std::fs::read(store.path().join("key-v1")).unwrap(),
        key_bytes
    );
}

#[test]
fn binary_starts_fails_closed_without_approval() {
    let binary = env!("CARGO_BIN_EXE_saber-core");
    let store = tempfile::tempdir().unwrap();

    let banner = Command::new(binary).output().unwrap();
    assert!(banner.status.success());
    let text = String::from_utf8_lossy(&banner.stdout).into_owned();
    assert!(text.contains("saber-core protocol"));

    let denied = Command::new(binary)
        .args([
            "run",
            "--store",
            store.path().to_str().unwrap(),
            "--",
            binary,
            "-c",
            "echo must-not-run",
        ])
        .output()
        .unwrap();
    assert_eq!(
        denied.status.code(),
        Some(EXIT_DENIED),
        "stdout: {}",
        String::from_utf8_lossy(&denied.stdout)
    );
    let text = String::from_utf8_lossy(&denied.stdout).into_owned();
    assert!(text.contains("denied"));
    assert!(text.contains("hash_chain_verified=true"));
    // The audit trail exists even for the denied run.
    assert!(store.path().join("facts.db").exists());
}

#[cfg(target_os = "macos")]
#[test]
fn real_seatbelt_executes_under_confinement_on_macos() {
    let store = tempfile::tempdir().unwrap();
    let mut registry = BackendRegistry::for_current_platform();
    let report = execute_run(
        store.path(),
        &mut registry,
        &options("/bin/sh", &["-c", "echo saber-seatbelt-ok"], &["sh"], true),
    )
    .unwrap();

    match &report.outcome {
        RunOutcome::Executed { stdout, .. } => {
            assert_eq!(stdout.trim_ascii(), b"saber-seatbelt-ok");
        }
        other => panic!("expected real sandboxed execution, got {other:?}"),
    }
    assert!(report.hash_chain_verified);
    // A denied follow-up in the same store must not execute either.
    let denied = execute_run(
        store.path(),
        &mut registry,
        &options(
            "/bin/rm",
            &["-rf", "/tmp/saber-should-not-exist"],
            &["sh"],
            true,
        ),
    )
    .unwrap();
    assert!(matches!(denied.outcome, RunOutcome::Denied { .. }));
    assert!(denied.hash_chain_verified);
}
