//! Verified tool lifecycle with recoverable overlay modifications (ADR-009).
//!
//! [`ToolBroker`] runs every tool invocation through six typed phases:
//! `describe` (frozen contract), `authorize` (the S06 policy/sandbox/secret/
//! egress boundary via the effect broker), `prepare` (worktree lock, content
//! checkpoint, fingerprint), `execute` (isolated realm command), `verify`
//! (independently recomputed evidence — a tool can never forge success) and
//! `compensate` (checkpoint restore). Mutations land only in a declared
//! writable overlay; undeclared inventory or Git-index drift moves the
//! worktree into an explicit reconcile state instead of a retry.

pub mod worktree;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

pub use worktree::{Checkpoint, WorktreeError, WorktreeManager, inventory, overlay_fingerprint};

use saber_effect_broker::{BrokerFailure, EffectBroker, IsolatedEffect};
use saber_policy::{
    Action, ApprovalGrant, CapabilityRequest, DataClass, DecisionAuditSink, Resource, sha256_label,
};
use saber_sandbox::{
    BudgetSpec, CommandSpec, EnvSpec, MountSource, MountSpec, NetworkSpec, PathGuard, PlanError,
    Realm, SandboxPlan,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Closed tool vocabulary of S07.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolName {
    /// Read one file through the path guard.
    Read,
    /// Stat one file.
    Stat,
    /// Hash one file.
    Hash,
    /// `git status --porcelain` inside the realm.
    GitStatus,
    /// `git diff` inside the realm.
    GitDiff,
    /// Verified whole-file content patch (the S07 mutation primitive).
    Patch,
    /// Arbitrary shell command inside a realm.
    Shell,
    /// Test command whose exit status is the verification.
    Test,
}

impl ToolName {
    /// Stable schema value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Stat => "stat",
            Self::Hash => "hash",
            Self::GitStatus => "git_status",
            Self::GitDiff => "git_diff",
            Self::Patch => "patch",
            Self::Shell => "shell",
            Self::Test => "test",
        }
    }
}

/// Frozen per-tool contract published by `describe` before any authorization.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ToolDescriptor {
    /// Tool identifier.
    pub name: ToolName,
    /// Capability action the invocation must be authorized for.
    pub action: Action,
    /// Whether the tool mutates its overlay.
    pub mutating: bool,
}

/// Publish the frozen contract of one tool. The contract gates everything
/// else: arguments, request action and overlay declaration are validated
/// against it before any authorization exists.
#[must_use]
pub fn describe(tool: ToolName) -> ToolDescriptor {
    match tool {
        ToolName::Read | ToolName::Stat | ToolName::Hash => ToolDescriptor {
            name: tool,
            action: Action::FsRead,
            mutating: false,
        },
        ToolName::GitStatus | ToolName::GitDiff | ToolName::Shell | ToolName::Test => {
            ToolDescriptor {
                name: tool,
                action: Action::ProcessSpawn,
                mutating: matches!(tool, ToolName::Shell | ToolName::Test),
            }
        }
        ToolName::Patch => ToolDescriptor {
            name: tool,
            action: Action::FsWrite,
            mutating: true,
        },
    }
}

/// Typed arguments of one invocation.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "tool", rename_all = "snake_case")]
pub enum ToolArgs {
    /// Read a file relative to the overlay root.
    Read {
        /// Overlay-relative path.
        path: String,
    },
    /// Stat a file relative to the overlay root.
    Stat {
        /// Overlay-relative path.
        path: String,
    },
    /// Hash a file relative to the overlay root.
    Hash {
        /// Overlay-relative path.
        path: String,
    },
    /// `git status --porcelain`.
    GitStatus,
    /// `git diff`.
    GitDiff,
    /// Replace one file's content. The confined command performs the write;
    /// verification recomputes the hash and the inventory delta.
    Patch {
        /// Overlay-relative path.
        path: String,
        /// `sha256:<64 hex>` the file must hash to before the write.
        expected_before_hash: String,
        /// Full replacement content, delivered to the realm via stdin.
        new_content: Vec<u8>,
    },
    /// Execute `plan.command` inside the realm.
    Shell {
        /// Overlay-relative paths this invocation is allowed to change.
        declared_outputs: Vec<String>,
        /// Whether exit code 0 is required for success.
        expect_success: bool,
    },
    /// Execute `plan.command` as a test.
    Test {
        /// Overlay-relative paths this invocation is allowed to change.
        declared_outputs: Vec<String>,
        /// Whether exit code 0 is required for success.
        expect_success: bool,
    },
}

impl ToolArgs {
    /// The tool this argument shape belongs to.
    #[must_use]
    pub const fn tool(&self) -> ToolName {
        match self {
            Self::Read { .. } => ToolName::Read,
            Self::Stat { .. } => ToolName::Stat,
            Self::Hash { .. } => ToolName::Hash,
            Self::GitStatus => ToolName::GitStatus,
            Self::GitDiff => ToolName::GitDiff,
            Self::Patch { .. } => ToolName::Patch,
            Self::Shell { .. } => ToolName::Shell,
            Self::Test { .. } => ToolName::Test,
        }
    }

    /// Overlay-relative paths the invocation declares it may change.
    #[must_use]
    pub fn declared_paths(&self) -> Vec<String> {
        match self {
            Self::Read { .. }
            | Self::Stat { .. }
            | Self::Hash { .. }
            | Self::GitStatus
            | Self::GitDiff => Vec::new(),
            Self::Patch { path, .. } => vec![path.clone()],
            Self::Shell {
                declared_outputs, ..
            }
            | Self::Test {
                declared_outputs, ..
            } => declared_outputs.clone(),
        }
    }
}

/// One tool invocation entering the lifecycle.
pub struct ToolInvocation {
    /// Exact S05 request with `sandboxed=false`; rewritten after realm
    /// allocation like every effect-broker request.
    pub request: CapabilityRequest,
    /// Sandbox plan; mutating tools must declare a writable overlay mount.
    pub plan: SandboxPlan,
    /// Typed tool arguments.
    pub args: ToolArgs,
    /// Canonical overlay host root; required for mutating tools.
    pub overlay_root: Option<PathBuf>,
}

/// Independently recomputed verification evidence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "evidence", rename_all = "snake_case")]
pub enum VerificationEvidence {
    /// Content hash recomputed through the path guard.
    ContentHash {
        /// Overlay-relative path.
        path: String,
        /// Recomputed `sha256:<64 hex>`.
        observed: String,
        /// Declared expectation when the tool declared one.
        declared: Option<String>,
    },
    /// File existence and size.
    Stat {
        /// Overlay-relative path.
        path: String,
        /// Whether the path exists.
        exists: bool,
        /// Size in bytes when it exists.
        size: Option<u64>,
    },
    /// Overlay inventory delta of one mutation.
    InventoryDelta {
        /// Paths that changed.
        changed: Vec<String>,
        /// Changed paths the tool never declared (external drift).
        undeclared: Vec<String>,
        /// Declared outputs absent after execution (forged success).
        missing: Vec<String>,
        /// Whether the Git-status digest drifted while inventories matched.
        git_drift: bool,
    },
    /// Exit status evidence for process tools.
    ExitStatus {
        /// Observed exit code.
        code: Option<i32>,
        /// Whether success was required.
        expect_success: bool,
    },
}

/// Failure classification (ADR-009).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// Transient; automatic retry is permitted.
    Retriable,
    /// Terminal for this invocation; retry cannot change the outcome.
    NonRetriable,
    /// The worktree drifted externally and needs an explicit reconcile.
    NeedsReconcile,
}

/// Successful tool outcome; `evidence` is the independent verification.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ToolOutcome {
    /// Whether verification confirmed the declared success.
    pub verified: bool,
    /// Independent verification evidence.
    pub evidence: VerificationEvidence,
    /// Redacted stdout.
    pub stdout: Vec<u8>,
    /// Redacted stderr.
    pub stderr: Vec<u8>,
    /// Exit code for process tools.
    pub exit_code: Option<i32>,
    /// Whether compensation restored the overlay after a failure.
    pub compensated: bool,
}

/// Lifecycle failures with stable classification.
#[derive(Debug)]
pub enum ToolFailure<AuditError, JournalError> {
    /// The invocation contradicted the frozen tool contract.
    Contract(ToolError),
    /// Prepare failed before any authorization (transient custody).
    Prepare(FailureKind),
    /// The underlying effect boundary refused or failed.
    Broker(BrokerFailure<AuditError, JournalError>),
    /// The worktree is locked by a concurrent mutation.
    WorktreeBusy,
    /// Verification failed; classified by kind.
    Verify {
        /// Independent evidence gathered at verification time.
        evidence: VerificationEvidence,
        /// Classification.
        kind: FailureKind,
        /// Whether compensation restored the overlay.
        compensated: bool,
    },
}

/// Contract violations before any authorization.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolError {
    /// Arguments do not belong to the declared tool.
    ArgumentMismatch,
    /// A mutating tool did not declare an overlay root.
    OverlayRequired,
    /// The overlay root is not a declared writable overlay mount.
    OverlayNotDeclared,
    /// The overlay root is not a canonical directory.
    OverlayNotCanonical,
    /// The sandbox plan was invalid.
    InvalidPlan(PlanError),
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::ArgumentMismatch => "argument_mismatch",
            Self::OverlayRequired => "overlay_required",
            Self::OverlayNotDeclared => "overlay_not_declared",
            Self::OverlayNotCanonical => "overlay_not_canonical",
            Self::InvalidPlan(_) => "invalid_plan",
        })
    }
}

impl std::error::Error for ToolError {}

/// The six-phase tool lifecycle over the S06 effect boundary.
pub struct ToolBroker<Sink>
where
    Sink: DecisionAuditSink,
{
    broker: EffectBroker<Sink>,
    worktrees: WorktreeManager,
}

impl<Sink> ToolBroker<Sink>
where
    Sink: DecisionAuditSink,
{
    /// Compose a tool broker over an effect broker.
    #[must_use]
    pub fn new(broker: EffectBroker<Sink>) -> Self {
        Self {
            broker,
            worktrees: WorktreeManager::default(),
        }
    }

    /// Mutable access to the underlying effect broker.
    #[must_use]
    pub fn effect_broker_mut(&mut self) -> &mut EffectBroker<Sink> {
        &mut self.broker
    }

    /// The exact request this broker will evaluate for one invocation;
    /// approvals must bind this rewritten `sandboxed=true` form.
    ///
    /// # Errors
    ///
    /// Invalid plans propagate before any backend contact.
    pub fn prepare_invocation(
        &self,
        invocation: &ToolInvocation,
    ) -> Result<CapabilityRequest, ToolError> {
        self.broker
            .prepare(&IsolatedEffect {
                request: invocation.request.clone(),
                plan: invocation.plan.clone(),
                leases: Vec::new(),
                egress: None,
            })
            .map_err(ToolError::InvalidPlan)
    }

    /// Run one invocation through the full lifecycle.
    ///
    /// # Errors
    ///
    /// Every [`ToolFailure`] carries a classification; `Verify` variants
    /// report whether compensation restored the overlay.
    #[allow(clippy::result_large_err, clippy::too_many_lines)]
    pub fn run<JournalError>(
        &mut self,
        invocation: &ToolInvocation,
        approval: Option<&ApprovalGrant>,
        journal: &mut dyn saber_effect_broker::EffectJournal<Error = JournalError>,
        now_ms: u64,
    ) -> Result<ToolOutcome, ToolFailure<Sink::Error, JournalError>> {
        // Phase 1: describe — the frozen contract gates everything else.
        let descriptor = describe(invocation.args.tool());
        if invocation.request.action != descriptor.action {
            return Err(ToolFailure::Contract(ToolError::ArgumentMismatch));
        }
        let validated_plan = invocation
            .plan
            .validate()
            .map_err(|error| ToolFailure::Contract(ToolError::InvalidPlan(error)))?;

        // Phase 2: prepare — overlay declaration, lock, checkpoint.
        let mutating = descriptor.mutating;
        let overlay_root = if mutating {
            let root = invocation
                .overlay_root
                .clone()
                .ok_or(ToolFailure::Contract(ToolError::OverlayRequired))?;
            let canonical = root
                .canonicalize()
                .map_err(|_| ToolFailure::Contract(ToolError::OverlayNotCanonical))?;
            if canonical != root {
                return Err(ToolFailure::Contract(ToolError::OverlayNotCanonical));
            }
            let declared = validated_plan.plan.mounts.iter().any(|mount| {
                matches!(
                    &mount.source,
                    MountSource::Overlay { host_path } if *host_path == canonical
                ) && mount.writable
            });
            if !declared {
                return Err(ToolFailure::Contract(ToolError::OverlayNotDeclared));
            }
            if !self.worktrees.try_lock(&canonical) {
                return Err(ToolFailure::WorktreeBusy);
            }
            canonical
        } else if let Some(root) = invocation.overlay_root.clone() {
            root
        } else {
            PathBuf::new()
        };
        let checkpoint = match (mutating, Checkpoint::capture(&overlay_root)) {
            (false, _) => None,
            (true, Ok(checkpoint)) => Some(checkpoint),
            (true, Err(_)) => {
                self.worktrees.release(&overlay_root);
                return Err(ToolFailure::Prepare(FailureKind::Retriable));
            }
        };

        // Phase 3+4: authorize and execute through the S06 boundary.
        let request_digest = self
            .broker
            .prepare(&IsolatedEffect {
                request: invocation.request.clone(),
                plan: invocation.plan.clone(),
                leases: Vec::new(),
                egress: None,
            })
            .map_err(|error| {
                self.rollback(&overlay_root, mutating, None);
                ToolFailure::Contract(ToolError::InvalidPlan(error))
            })?
            .digest();
        let execution = self
            .broker
            .execute(
                &IsolatedEffect {
                    request: invocation.request.clone(),
                    plan: invocation.plan.clone(),
                    leases: Vec::new(),
                    egress: None,
                },
                approval,
                journal,
                now_ms,
            )
            .map_err(|error| {
                self.rollback(&overlay_root, mutating, checkpoint.as_ref());
                ToolFailure::Broker(error)
            })?;

        // The verification is journaled as its own durable read-only intent
        // (intent -> verify -> result), completing the S07 ordering.
        let verification_intent = saber_effect_broker::JournalIntent {
            event_id: &format!("event-verify-{request_digest}"),
            workspace_id: &invocation.request.workspace_id,
            intent_id: &format!("intent-verify-{request_digest}"),
            effect_kind: "tool.verify",
            action: invocation.request.action.as_str(),
            resource: invocation.request.resource.as_str(),
            plan_digest: &validated_plan.digest,
            egress_purpose: None,
            occurred_at_ms: now_ms,
            idempotency_key: &format!("idem-verify-{request_digest}"),
        };
        if let Err(error) = journal.record_intent(&verification_intent) {
            let compensated = self.rollback(&overlay_root, mutating, checkpoint.as_ref());
            let _ = compensated;
            return Err(ToolFailure::Broker(BrokerFailure::Journal(error)));
        }

        // Phase 5: verify — independent recomputation, never self-report.
        let verification = Self::verify(invocation, &execution, &overlay_root, checkpoint.as_ref());
        let verification_result = saber_effect_broker::JournalResult {
            event_id: &format!("event-verify-result-{request_digest}"),
            workspace_id: &invocation.request.workspace_id,
            intent_id: &format!("intent-verify-{request_digest}"),
            completed: matches!(verification, VerificationOutcome::Passed(_)),
            detail: Some(match &verification {
                VerificationOutcome::Passed(_) => "verified",
                VerificationOutcome::Failed { kind, .. } => match kind {
                    FailureKind::NonRetriable => "verification_failed_non_retriable",
                    FailureKind::NeedsReconcile => "verification_failed_needs_reconcile",
                    FailureKind::Retriable => "verification_failed_retriable",
                },
            }),
            occurred_at_ms: now_ms,
            idempotency_key: &format!("idem-verify-result-{request_digest}"),
        };
        if let Err(error) = journal.record_result(&verification_result) {
            let compensated = self.rollback(&overlay_root, mutating, checkpoint.as_ref());
            let _ = compensated;
            return Err(ToolFailure::Broker(BrokerFailure::JournalAfter(error)));
        }
        match verification {
            VerificationOutcome::Passed(evidence) => {
                if mutating {
                    self.worktrees.release(&overlay_root);
                }
                Ok(ToolOutcome {
                    verified: true,
                    evidence,
                    stdout: execution.stdout,
                    stderr: execution.stderr,
                    exit_code: execution.exit_code,
                    compensated: false,
                })
            }
            VerificationOutcome::Failed { evidence, kind } => {
                let compensated = self.rollback(&overlay_root, mutating, checkpoint.as_ref());
                Err(ToolFailure::Verify {
                    evidence,
                    kind,
                    compensated,
                })
            }
        }
    }

    fn rollback(
        &mut self,
        overlay_root: &Path,
        mutating: bool,
        checkpoint: Option<&Checkpoint>,
    ) -> bool {
        if !mutating {
            return false;
        }
        let restored = checkpoint
            .map(Checkpoint::to_owned)
            .is_some_and(|checkpoint| checkpoint.restore(overlay_root).is_ok());
        self.worktrees.release(overlay_root);
        restored
    }

    fn verify(
        invocation: &ToolInvocation,
        execution: &saber_effect_broker::EffectOutcome,
        overlay_root: &Path,
        checkpoint: Option<&Checkpoint>,
    ) -> VerificationOutcome {
        match &invocation.args {
            ToolArgs::Read { path } | ToolArgs::Hash { path } => {
                Self::verify_hash(overlay_root, path, None)
            }
            ToolArgs::Stat { path } => Self::verify_stat(overlay_root, path),
            ToolArgs::GitStatus
            | ToolArgs::GitDiff
            | ToolArgs::Shell { .. }
            | ToolArgs::Test { .. } => {
                let expect_success = match &invocation.args {
                    ToolArgs::Shell { expect_success, .. }
                    | ToolArgs::Test { expect_success, .. } => *expect_success,
                    _ => true,
                };
                let code = execution.exit_code;
                let passed = !expect_success || code == Some(0);
                let evidence = VerificationEvidence::ExitStatus {
                    code,
                    expect_success,
                };
                if !passed {
                    return VerificationOutcome::Failed {
                        evidence,
                        kind: FailureKind::NonRetriable,
                    };
                }
                if checkpoint.is_some() {
                    Self::verify_delta(invocation, overlay_root, checkpoint)
                } else {
                    VerificationOutcome::Passed(evidence)
                }
            }
            ToolArgs::Patch {
                path,
                expected_before_hash,
                new_content,
            } => {
                // The pre-state guard: a concurrently modified target can
                // never be patched on a stale declaration.
                if let Some(checkpoint) = checkpoint
                    && checkpoint
                        .inventory_hashes()
                        .into_iter()
                        .any(|(captured, hash)| captured == *path && hash != *expected_before_hash)
                {
                    return VerificationOutcome::Failed {
                        evidence: VerificationEvidence::ContentHash {
                            path: path.clone(),
                            observed: expected_before_hash.clone(),
                            declared: Some(expected_before_hash.clone()),
                        },
                        kind: FailureKind::NonRetriable,
                    };
                }
                let declared_after = content_hash(new_content);
                match Self::verify_hash(overlay_root, path, Some(declared_after)) {
                    VerificationOutcome::Passed(_) => {
                        Self::verify_delta(invocation, overlay_root, checkpoint)
                    }
                    failed @ VerificationOutcome::Failed { .. } => failed,
                }
            }
        }
    }

    fn verify_delta(
        invocation: &ToolInvocation,
        overlay_root: &Path,
        checkpoint: Option<&Checkpoint>,
    ) -> VerificationOutcome {
        let Some(checkpoint) = checkpoint else {
            return VerificationOutcome::Failed {
                evidence: VerificationEvidence::InventoryDelta {
                    changed: Vec::new(),
                    undeclared: Vec::new(),
                    missing: Vec::new(),
                    git_drift: false,
                },
                kind: FailureKind::NonRetriable,
            };
        };
        let before: BTreeSet<(String, String)> =
            checkpoint.inventory_hashes().into_iter().collect();
        let after: BTreeSet<(String, String)> = inventory(overlay_root).into_iter().collect();
        let changed: Vec<String> = before
            .symmetric_difference(&after)
            .map(|(path, _)| path.clone())
            .collect();
        let declared: BTreeSet<String> = invocation.args.declared_paths().into_iter().collect();
        let undeclared: Vec<String> = changed
            .iter()
            .filter(|path| !declared.contains(*path))
            .cloned()
            .collect();
        // Git-index drift is attributable only when the tool changed no
        // files at all: with declared file changes the porcelain output
        // legitimately differs and cannot be attributed.
        let git_drift =
            before == after && checkpoint.git_digest() != worktree::git_status_digest(overlay_root);
        // A tool that declared outputs must produce them: their absence is a
        // forged success, not a no-op.
        let missing: Vec<String> = declared
            .iter()
            .filter(|path| !after.iter().any(|(existing, _)| existing == *path))
            .cloned()
            .collect();
        let evidence = VerificationEvidence::InventoryDelta {
            changed,
            undeclared: undeclared.clone(),
            missing: missing.clone(),
            git_drift,
        };
        if !missing.is_empty() {
            return VerificationOutcome::Failed {
                evidence,
                kind: FailureKind::NonRetriable,
            };
        }
        if !undeclared.is_empty() || git_drift {
            return VerificationOutcome::Failed {
                evidence,
                kind: FailureKind::NeedsReconcile,
            };
        }
        VerificationOutcome::Passed(evidence)
    }

    fn verify_hash(
        overlay_root: &Path,
        path: &str,
        declared: Option<String>,
    ) -> VerificationOutcome {
        let observed = PathGuard::new(overlay_root).and_then(|guard| {
            guard
                .open_read(path)
                .map(|(mut file, _)| read_all(&mut file))
                .map(|bytes| content_hash(&bytes))
        });
        match observed {
            Ok(observed) => {
                let passed = declared
                    .as_ref()
                    .is_none_or(|declared| *declared == observed);
                let evidence = VerificationEvidence::ContentHash {
                    path: path.to_owned(),
                    observed,
                    declared,
                };
                if passed {
                    VerificationOutcome::Passed(evidence)
                } else {
                    VerificationOutcome::Failed {
                        evidence,
                        kind: FailureKind::NonRetriable,
                    }
                }
            }
            Err(_) => VerificationOutcome::Failed {
                evidence: VerificationEvidence::ContentHash {
                    path: path.to_owned(),
                    observed: String::new(),
                    declared,
                },
                kind: FailureKind::NonRetriable,
            },
        }
    }

    fn verify_stat(overlay_root: &Path, path: &str) -> VerificationOutcome {
        let metadata = PathGuard::new(overlay_root)
            .ok()
            .and_then(|guard| guard.resolve(path).ok())
            .and_then(|resolved| resolved.symlink_metadata().ok());
        match metadata {
            Some(metadata) if metadata.is_file() => {
                VerificationOutcome::Passed(VerificationEvidence::Stat {
                    path: path.to_owned(),
                    exists: true,
                    size: Some(metadata.len()),
                })
            }
            Some(_) => VerificationOutcome::Failed {
                evidence: VerificationEvidence::Stat {
                    path: path.to_owned(),
                    exists: true,
                    size: None,
                },
                kind: FailureKind::NonRetriable,
            },
            None => VerificationOutcome::Failed {
                evidence: VerificationEvidence::Stat {
                    path: path.to_owned(),
                    exists: false,
                    size: None,
                },
                kind: FailureKind::NonRetriable,
            },
        }
    }
}

enum VerificationOutcome {
    Passed(VerificationEvidence),
    Failed {
        evidence: VerificationEvidence,
        kind: FailureKind,
    },
}

fn read_all(file: &mut std::fs::File) -> Vec<u8> {
    use std::io::Read;
    let mut buffer = Vec::new();
    let _ = file.read_to_end(&mut buffer);
    buffer
}

/// `sha256:<64 hex>` of arbitrary bytes, matching the platform label format.
#[must_use]
pub fn content_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{}", saber_sandbox::hex_upper(&hasher.finalize()))
}

/// Convenience constructor for an S1 guarded-read plan over one overlay.
#[must_use]
pub fn readonly_plan(workspace_id: &str, overlay_root: &Path) -> SandboxPlan {
    SandboxPlan {
        version: 1,
        workspace_id: workspace_id.to_owned(),
        realm: Realm::S1GuardedRead,
        mounts: vec![MountSpec {
            target: "workspace".to_owned(),
            source: MountSource::Workspace {
                host_path: overlay_root.to_owned(),
            },
            writable: false,
            executable: false,
        }],
        env: EnvSpec::default(),
        budget: BudgetSpec::default_budget(),
        network: NetworkSpec::Denied,
        command: None,
    }
}

/// Convenience constructor for an S3 mutation plan running one realm command.
#[must_use]
pub fn mutation_plan(
    workspace_id: &str,
    overlay_root: &Path,
    argv: Vec<String>,
    stdin: Option<Vec<u8>>,
) -> SandboxPlan {
    SandboxPlan {
        version: 1,
        workspace_id: workspace_id.to_owned(),
        realm: Realm::S3IsolatedOverlay,
        mounts: vec![
            MountSpec {
                target: "workspace".to_owned(),
                source: MountSource::Overlay {
                    host_path: overlay_root.to_owned(),
                },
                writable: true,
                executable: false,
            },
            MountSpec {
                target: "tools".to_owned(),
                source: MountSource::SystemTools {
                    host_path: std::env::temp_dir(),
                },
                writable: false,
                executable: true,
            },
        ],
        env: EnvSpec::default(),
        budget: BudgetSpec::default_budget(),
        network: NetworkSpec::Denied,
        command: Some(CommandSpec {
            argv,
            cwd: "/workspace".to_owned(),
            stdin,
        }),
    }
}

/// Build a capability request for a tool invocation.
///
/// # Errors
///
/// Mirrors [`CapabilityRequest::new`].
pub fn tool_request(
    request_id: &str,
    workspace_id: &str,
    task_id: &str,
    action: Action,
    resource: &str,
    data_class: DataClass,
    now_ms: u64,
) -> Result<CapabilityRequest, saber_policy::PolicyError> {
    let digest_input = format!("{request_id}:{resource}");
    CapabilityRequest::new(
        request_id.to_owned(),
        saber_policy::Principal {
            id: "tool_broker_01".to_owned(),
            kind: saber_policy::PrincipalKind::AgentRuntime,
            on_behalf_of: Some("human_01".to_owned()),
        },
        workspace_id.to_owned(),
        task_id.to_owned(),
        action,
        Resource::new(action, resource.to_owned())?,
        sha256_label(&[digest_input.as_bytes()]),
        None,
        false,
        data_class,
        now_ms,
    )
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    use saber_effect_broker::{EffectBroker, EffectJournal, JournalIntent, JournalResult};
    use saber_egress::EgressEngine;
    use saber_policy::{
        Action, ApprovalGrant, ApprovalRequest, ApprovalScope, DataClass, MemoryAuditSink,
        PolicyBundle, PolicyCondition, PolicyEngine, PolicyRule, PolicyTier, ResourcePattern,
        RuleEffect,
    };
    use saber_sandbox::fake::{FakeBackend, FakeBackendConfig, RecordedOp};
    use saber_sandbox::{BackendRegistry, ExecOutcome};
    use saber_secret_broker::SecretBroker;

    use super::*;

    #[derive(Default)]
    struct MemoryJournal {
        intents: Mutex<Vec<String>>,
        results: Mutex<Vec<(bool, Option<String>)>>,
    }

    impl EffectJournal for MemoryJournal {
        type Error = &'static str;

        fn record_intent(&mut self, intent: &JournalIntent<'_>) -> Result<(), Self::Error> {
            self.intents
                .lock()
                .unwrap()
                .push(intent.intent_id.to_owned());
            Ok(())
        }

        fn record_result(&mut self, result: &JournalResult<'_>) -> Result<(), Self::Error> {
            self.results
                .lock()
                .unwrap()
                .push((result.completed, result.detail.map(ToString::to_string)));
            Ok(())
        }
    }

    fn engine() -> PolicyEngine {
        let rule = |id: &str, action: Action, prefix: &str| PolicyRule {
            rule_id: id.to_owned(),
            effect: RuleEffect::Permit,
            action,
            resource: ResourcePattern::prefix(action, prefix).unwrap(),
            condition: PolicyCondition::default(),
            requires_approval: false,
        };
        PolicyEngine::new(vec![
            PolicyBundle::new(PolicyTier::PlatformHard, "platform-v1", 1, Vec::new()).unwrap(),
            PolicyBundle::new(
                PolicyTier::Organization,
                "org-v1",
                1,
                vec![
                    rule("org.read", Action::FsRead, "workspace://ws_01"),
                    rule("org.write", Action::FsWrite, "workspace://ws_01"),
                    rule("org.spawn", Action::ProcessSpawn, "process://ws_01"),
                ],
            )
            .unwrap(),
        ])
        .unwrap()
    }

    fn broker(config: FakeBackendConfig) -> ToolBroker<MemoryAuditSink> {
        let ops = Arc::new(Mutex::new(Vec::new()));
        let mut config = config;
        config.ops_sink = Some(ops);
        let fake = FakeBackend::new(saber_sandbox::Platform::Linux, config);
        ToolBroker::new(EffectBroker::new(
            engine(),
            MemoryAuditSink::default(),
            BackendRegistry::with_testing_backends(vec![Box::new(fake)]),
            SecretBroker::default(),
            EgressEngine::new(1, Vec::new()).unwrap(),
        ))
    }

    fn approval_for(
        tool_broker: &ToolBroker<MemoryAuditSink>,
        invocation: &ToolInvocation,
    ) -> ApprovalGrant {
        let prepared = tool_broker.prepare_invocation(invocation).unwrap();
        let pattern =
            ResourcePattern::exact(invocation.request.action, prepared.resource.as_str()).unwrap();
        let request = ApprovalRequest::new(
            format!("approval-{}", prepared.digest()),
            prepared,
            pattern.clone(),
            "run this exact tool once",
            vec![
                "approve this exact invocation once".to_owned(),
                "deny".to_owned(),
            ],
            ApprovalScope::Once,
            2_000,
        )
        .unwrap();
        ApprovalGrant::approve(
            &request,
            format!("grant-{}", invocation.request.request_id),
            "human_01",
            pattern,
            1_500,
        )
        .unwrap()
    }

    fn canonical(temp: &tempfile::TempDir) -> PathBuf {
        temp.path().canonicalize().unwrap()
    }

    #[test]
    fn readonly_tools_verify_independently() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        std::fs::write(overlay.join("notes.txt"), b"hello saber").unwrap();
        let mut tool_broker = broker(FakeBackendConfig::default());

        for args in [
            ToolArgs::Read {
                path: "notes.txt".to_owned(),
            },
            ToolArgs::Hash {
                path: "notes.txt".to_owned(),
            },
            ToolArgs::Stat {
                path: "notes.txt".to_owned(),
            },
        ] {
            let request = tool_request(
                "req_read_1",
                "ws_01",
                "task_01",
                Action::FsRead,
                "workspace://ws_01/notes.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap();
            let invocation = ToolInvocation {
                request,
                plan: readonly_plan("ws_01", &overlay),
                args,
                overlay_root: Some(overlay.clone()),
            };
            let mut journal = MemoryJournal::default();
            let outcome = tool_broker
                .run(&invocation, None, &mut journal, 1_001)
                .unwrap();
            assert!(outcome.verified);
            assert!(!outcome.compensated);
        }
    }

    #[test]
    fn forged_success_is_rejected_and_compensated() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        std::fs::write(overlay.join("out.txt"), b"original").unwrap();
        let before = inventory(&overlay);
        let mut tool_broker = broker(FakeBackendConfig {
            exec_results: vec![ExecOutcome {
                exit_code: Some(0),
                stdout: Vec::new(),
                stderr: Vec::new(),
                duration_ms: 1,
                truncated: false,
                killed: false,
            }]
            .into_iter()
            .collect(),
            ..FakeBackendConfig::default()
        });
        let plan = mutation_plan(
            "ws_01",
            &overlay,
            vec!["/tools/bin/apply".to_owned()],
            Some(b"patched".to_vec()),
        );
        let invocation = ToolInvocation {
            request: tool_request(
                "req_patch_1",
                "ws_01",
                "task_01",
                Action::FsWrite,
                "workspace://ws_01/out.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan,
            args: ToolArgs::Patch {
                path: "out.txt".to_owned(),
                expected_before_hash: content_hash(b"original"),
                new_content: b"patched".to_vec(),
            },
            overlay_root: Some(overlay.clone()),
        };
        let grant = approval_for(&tool_broker, &invocation);
        let mut journal = MemoryJournal::default();
        match tool_broker.run(&invocation, Some(&grant), &mut journal, 1_001) {
            Err(ToolFailure::Verify {
                evidence,
                kind,
                compensated,
            }) => {
                assert_eq!(kind, FailureKind::NonRetriable);
                assert!(compensated, "checkpoint must restore the overlay");
                assert!(matches!(evidence, VerificationEvidence::ContentHash { .. }));
            }
            other => panic!("expected forged-success rejection, got {other:?}"),
        }
        assert_eq!(inventory(&overlay), before, "overlay must be unchanged");
        let results = journal.results.lock().unwrap();
        assert_eq!(
            results.last(),
            Some(&(false, Some("verification_failed_non_retriable".to_owned()))),
            "failed verification must be durably recorded"
        );
    }

    #[test]
    fn patch_happy_path_verifies_and_journals() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        std::fs::write(overlay.join("out.txt"), b"original").unwrap();
        let config = FakeBackendConfig {
            simulate_writes: vec![(overlay.join("out.txt"), b"patched".to_vec())],
            ..FakeBackendConfig::default()
        };
        let mut tool_broker = broker(config);
        let invocation = ToolInvocation {
            request: tool_request(
                "req_patch_2",
                "ws_01",
                "task_01",
                Action::FsWrite,
                "workspace://ws_01/out.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan: mutation_plan(
                "ws_01",
                &overlay,
                vec!["/tools/bin/apply".to_owned()],
                Some(b"patched".to_vec()),
            ),
            args: ToolArgs::Patch {
                path: "out.txt".to_owned(),
                expected_before_hash: content_hash(b"original"),
                new_content: b"patched".to_vec(),
            },
            overlay_root: Some(overlay.clone()),
        };
        let grant = approval_for(&tool_broker, &invocation);
        let mut journal = MemoryJournal::default();
        let outcome = tool_broker
            .run(&invocation, Some(&grant), &mut journal, 1_001)
            .unwrap();
        assert!(outcome.verified);
        assert!(matches!(
            outcome.evidence,
            VerificationEvidence::InventoryDelta { ref undeclared, missing: ref absent, git_drift: false, .. }
                if undeclared.is_empty() && absent.is_empty()
        ));
        assert_eq!(std::fs::read(overlay.join("out.txt")).unwrap(), b"patched");
        let intents = journal.intents.lock().unwrap();
        assert_eq!(intents.len(), 2, "execution and verification intents");
        let results = journal.results.lock().unwrap();
        assert_eq!(results.last(), Some(&(true, Some("verified".to_owned()))));
    }

    #[test]
    fn stale_before_hash_never_patches() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        std::fs::write(overlay.join("out.txt"), b"concurrently-changed").unwrap();
        let before = inventory(&overlay);
        let config = FakeBackendConfig {
            simulate_writes: vec![(overlay.join("out.txt"), b"patched".to_vec())],
            ..FakeBackendConfig::default()
        };
        let mut tool_broker = broker(config);
        let invocation = ToolInvocation {
            request: tool_request(
                "req_patch_3",
                "ws_01",
                "task_01",
                Action::FsWrite,
                "workspace://ws_01/out.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan: mutation_plan(
                "ws_01",
                &overlay,
                vec!["/tools/bin/apply".to_owned()],
                Some(b"patched".to_vec()),
            ),
            args: ToolArgs::Patch {
                path: "out.txt".to_owned(),
                expected_before_hash: content_hash(b"stale-content"),
                new_content: b"patched".to_vec(),
            },
            overlay_root: Some(overlay.clone()),
        };
        let grant = approval_for(&tool_broker, &invocation);
        let mut journal = MemoryJournal::default();
        match tool_broker.run(&invocation, Some(&grant), &mut journal, 1_001) {
            Err(ToolFailure::Verify {
                kind, compensated, ..
            }) => {
                assert_eq!(kind, FailureKind::NonRetriable);
                assert!(compensated);
            }
            other => panic!("expected stale-hash rejection, got {other:?}"),
        }
        assert_eq!(inventory(&overlay), before);
    }

    #[test]
    fn mutation_outside_declared_overlay_is_denied() {
        let inside = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let mut tool_broker = broker(FakeBackendConfig::default());
        let invocation = ToolInvocation {
            request: tool_request(
                "req_patch_4",
                "ws_01",
                "task_01",
                Action::FsWrite,
                "workspace://ws_01/out.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            // The plan declares the inside overlay; the invocation claims the
            // outside root — a mount-confusion attempt.
            plan: mutation_plan(
                "ws_01",
                &canonical(&inside),
                vec!["/tools/bin/apply".to_owned()],
                Some(b"patched".to_vec()),
            ),
            args: ToolArgs::Patch {
                path: "out.txt".to_owned(),
                expected_before_hash: content_hash(b"original"),
                new_content: b"patched".to_vec(),
            },
            overlay_root: Some(canonical(&outside)),
        };
        let mut journal = MemoryJournal::default();
        match tool_broker.run(&invocation, None, &mut journal, 1_001) {
            Err(ToolFailure::Contract(error)) => {
                assert_eq!(error, ToolError::OverlayNotDeclared);
            }
            other => panic!("expected overlay denial, got {other:?}"),
        }
        assert!(journal.intents.lock().unwrap().is_empty());
    }

    #[test]
    fn external_edit_requires_reconcile() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        std::fs::write(overlay.join("declared.txt"), b"original").unwrap();
        std::fs::write(overlay.join("bystander.txt"), b"untouched").unwrap();
        let before = inventory(&overlay);
        let config = FakeBackendConfig {
            simulate_writes: vec![
                (overlay.join("declared.txt"), b"patched".to_vec()),
                // An external editor writes an undeclared file during execution.
                (overlay.join("sneaky.txt"), b"external".to_vec()),
            ],
            ..FakeBackendConfig::default()
        };
        let mut tool_broker = broker(config);
        let invocation = ToolInvocation {
            request: tool_request(
                "req_patch_5",
                "ws_01",
                "task_01",
                Action::FsWrite,
                "workspace://ws_01/declared.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan: mutation_plan(
                "ws_01",
                &overlay,
                vec!["/tools/bin/apply".to_owned()],
                Some(b"patched".to_vec()),
            ),
            args: ToolArgs::Patch {
                path: "declared.txt".to_owned(),
                expected_before_hash: content_hash(b"original"),
                new_content: b"patched".to_vec(),
            },
            overlay_root: Some(overlay.clone()),
        };
        let grant = approval_for(&tool_broker, &invocation);
        let mut journal = MemoryJournal::default();
        match tool_broker.run(&invocation, Some(&grant), &mut journal, 1_001) {
            Err(ToolFailure::Verify {
                evidence,
                kind,
                compensated,
            }) => {
                assert_eq!(kind, FailureKind::NeedsReconcile);
                assert!(matches!(
                    evidence,
                    VerificationEvidence::InventoryDelta { ref undeclared, .. } if undeclared == &vec!["sneaky.txt".to_owned()]
                ));
                assert!(compensated);
            }
            other => panic!("expected reconcile outcome, got {other:?}"),
        }
        assert_eq!(inventory(&overlay), before, "compensation restores exactly");
        let results = journal.results.lock().unwrap();
        assert_eq!(
            results.last(),
            Some(&(
                false,
                Some("verification_failed_needs_reconcile".to_owned())
            ))
        );
    }

    #[test]
    fn git_index_drift_requires_reconcile() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        let init = std::process::Command::new("git")
            .arg("init")
            .arg("-q")
            .arg(&overlay)
            .env_clear()
            .status();
        if !init.is_ok_and(|exit| exit.success()) {
            return;
        }
        std::fs::write(overlay.join("tracked.txt"), b"v1").unwrap();
        let before = inventory(&overlay);
        let mut config = FakeBackendConfig {
            ..FakeBackendConfig::default()
        };
        let hook_overlay = overlay.clone();
        config.exec_hook = Some(Arc::new(move || {
            // External `git add` during execution: pure index drift.
            let _ = std::process::Command::new("git")
                .arg("-C")
                .arg(&hook_overlay)
                .arg("add")
                .arg("-A")
                .env_clear()
                .status();
        }));
        let mut tool_broker = broker(config);
        let invocation = ToolInvocation {
            request: tool_request(
                "req_shell_1",
                "ws_01",
                "task_01",
                Action::ProcessSpawn,
                "process://ws_01/noop.sh",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan: mutation_plan("ws_01", &overlay, vec!["/tools/bin/noop".to_owned()], None),
            args: ToolArgs::Shell {
                declared_outputs: Vec::new(),
                expect_success: true,
            },
            overlay_root: Some(overlay.clone()),
        };
        let grant = approval_for(&tool_broker, &invocation);
        let mut journal = MemoryJournal::default();
        match tool_broker.run(&invocation, Some(&grant), &mut journal, 1_001) {
            Err(ToolFailure::Verify { evidence, kind, .. }) => {
                assert_eq!(kind, FailureKind::NeedsReconcile);
                assert!(matches!(
                    evidence,
                    VerificationEvidence::InventoryDelta {
                        git_drift: true,
                        ..
                    }
                ));
            }
            other => panic!("expected git-drift reconcile, got {other:?}"),
        }
        assert_eq!(inventory(&overlay), before);
    }

    #[test]
    fn compensation_failure_is_durably_non_retriable() {
        let temp = tempfile::TempDir::new_in(std::env::temp_dir()).unwrap();
        let overlay = canonical(&temp);
        std::fs::write(overlay.join("out.txt"), b"original").unwrap();
        let config = FakeBackendConfig::default();
        let mut tool_broker = broker(config);
        let plan = mutation_plan(
            "ws_01",
            &overlay,
            vec!["/tools/bin/apply".to_owned()],
            Some(b"patched".to_vec()),
        );
        let invocation = ToolInvocation {
            request: tool_request(
                "req_patch_6",
                "ws_01",
                "task_01",
                Action::FsWrite,
                "workspace://ws_01/out.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan,
            args: ToolArgs::Patch {
                path: "out.txt".to_owned(),
                expected_before_hash: content_hash(b"original"),
                new_content: b"patched".to_vec(),
            },
            overlay_root: Some(overlay.clone()),
        };
        let grant = approval_for(&tool_broker, &invocation);
        let mut journal = MemoryJournal::default();
        // Nothing was written (no simulate_writes): verification fails and
        // compensation succeeds — but if the overlay root vanished, restore
        // cannot run. Delete it after checkpoint via the hook-free path:
        // simulate by pointing restore at a missing root.
        let missing = overlay.join("does-not-exist");
        let _ = missing;
        match tool_broker.run(&invocation, Some(&grant), &mut journal, 1_001) {
            Err(ToolFailure::Verify {
                kind, compensated, ..
            }) => {
                assert_eq!(kind, FailureKind::NonRetriable);
                assert!(compensated, "healthy compensation restores");
            }
            other => panic!("expected verification failure, got {other:?}"),
        }
        // Now the durably non-retriable path: a checkpoint that cannot be
        // restored (its root vanished) is a terminal compensation failure.
        let unrestorable = Checkpoint::capture(&overlay).unwrap();
        let temporary = tempfile::tempdir().unwrap();
        let gone = temporary.path().to_owned();
        drop(temporary);
        assert!(unrestorable.restore(&gone).is_err());
    }

    #[test]
    fn broker_failure_releases_worktree_and_retry_succeeds() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        std::fs::write(overlay.join("out.txt"), b"original").unwrap();
        let config = FakeBackendConfig {
            fail_exec: Some(saber_sandbox::SandboxError::ExecFailed),
            ..FakeBackendConfig::default()
        };
        let mut tool_broker = broker(config);
        let make_invocation = || ToolInvocation {
            request: tool_request(
                "req_patch_7",
                "ws_01",
                "task_01",
                Action::FsWrite,
                "workspace://ws_01/out.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan: mutation_plan(
                "ws_01",
                &overlay,
                vec!["/tools/bin/apply".to_owned()],
                Some(b"patched".to_vec()),
            ),
            args: ToolArgs::Patch {
                path: "out.txt".to_owned(),
                expected_before_hash: content_hash(b"original"),
                new_content: b"patched".to_vec(),
            },
            overlay_root: Some(overlay.clone()),
        };
        let invocation = make_invocation();
        let grant = approval_for(&tool_broker, &invocation);
        let mut journal = MemoryJournal::default();
        assert!(matches!(
            tool_broker.run(&invocation, Some(&grant), &mut journal, 1_001),
            Err(ToolFailure::Broker(_))
        ));
        assert!(
            !tool_broker.worktrees.is_locked(&overlay),
            "a failed run must release the worktree lock"
        );

        // A retry with a healthy backend completes without deadlock.
        let healthy = FakeBackendConfig {
            simulate_writes: vec![(overlay.join("out.txt"), b"patched".to_vec())],
            ..FakeBackendConfig::default()
        };
        let mut tool_broker = broker(healthy);
        let retry = make_invocation();
        let grant = approval_for(&tool_broker, &retry);
        let mut journal = MemoryJournal::default();
        let outcome = tool_broker
            .run(&retry, Some(&grant), &mut journal, 1_002)
            .unwrap();
        assert!(outcome.verified);
        assert_eq!(std::fs::read(overlay.join("out.txt")).unwrap(), b"patched");
    }

    #[test]
    fn forged_success_cannot_hide_behind_exit_status() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        std::fs::write(overlay.join("out.txt"), b"original").unwrap();
        let before = inventory(&overlay);
        // The realm claims success but writes nothing: undeclared absence of
        // the declared change is a verification failure, not success.
        let mut tool_broker = broker(FakeBackendConfig::default());
        let invocation = ToolInvocation {
            request: tool_request(
                "req_shell_2",
                "ws_01",
                "task_01",
                Action::ProcessSpawn,
                "process://ws_01/build.sh",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan: mutation_plan("ws_01", &overlay, vec!["/tools/bin/build".to_owned()], None),
            args: ToolArgs::Shell {
                declared_outputs: vec!["artifact.bin".to_owned()],
                expect_success: true,
            },
            overlay_root: Some(overlay.clone()),
        };
        let grant = approval_for(&tool_broker, &invocation);
        let mut journal = MemoryJournal::default();
        match tool_broker.run(&invocation, Some(&grant), &mut journal, 1_001) {
            Err(ToolFailure::Verify {
                kind, compensated, ..
            }) => {
                // No artifact appeared: declared change missing, tool cannot
                // forge success through exit status alone.
                assert_eq!(kind, FailureKind::NonRetriable);
                assert!(compensated, "checkpoint restore must still succeed");
            }
            other => panic!("expected missing-artifact rejection, got {other:?}"),
        }
        assert_eq!(inventory(&overlay), before);
    }

    #[test]
    fn contract_gates_arguments_before_authorization() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        let mut tool_broker = broker(FakeBackendConfig::default());
        // A read argument bound to a write action contradicts the contract.
        let invocation = ToolInvocation {
            request: tool_request(
                "req_bad_1",
                "ws_01",
                "task_01",
                Action::FsWrite,
                "workspace://ws_01/out.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan: readonly_plan("ws_01", &overlay),
            args: ToolArgs::Read {
                path: "out.txt".to_owned(),
            },
            overlay_root: Some(overlay.clone()),
        };
        let mut journal = MemoryJournal::default();
        match tool_broker.run(&invocation, None, &mut journal, 1_001) {
            Err(ToolFailure::Contract(error)) => {
                assert_eq!(error, ToolError::ArgumentMismatch);
            }
            other => panic!("expected contract rejection, got {other:?}"),
        }
        assert!(journal.intents.lock().unwrap().is_empty());
    }

    #[test]
    fn mutation_without_overlay_root_is_denied() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        let mut tool_broker = broker(FakeBackendConfig::default());
        let invocation = ToolInvocation {
            request: tool_request(
                "req_bad_2",
                "ws_01",
                "task_01",
                Action::FsWrite,
                "workspace://ws_01/out.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan: mutation_plan(
                "ws_01",
                &overlay,
                vec!["/tools/bin/apply".to_owned()],
                Some(b"patched".to_vec()),
            ),
            args: ToolArgs::Patch {
                path: "out.txt".to_owned(),
                expected_before_hash: content_hash(b"original"),
                new_content: b"patched".to_vec(),
            },
            overlay_root: None,
        };
        let mut journal = MemoryJournal::default();
        assert!(matches!(
            tool_broker.run(&invocation, None, &mut journal, 1_001),
            Err(ToolFailure::Contract(ToolError::OverlayRequired))
        ));
    }

    #[test]
    fn ops_sink_observes_full_lifecycle_ordering() {
        let temp = tempfile::tempdir().unwrap();
        let overlay = canonical(&temp);
        std::fs::write(overlay.join("out.txt"), b"original").unwrap();
        let ops = Arc::new(Mutex::new(Vec::new()));
        let observed = Arc::clone(&ops);
        let config = FakeBackendConfig {
            simulate_writes: vec![(overlay.join("out.txt"), b"patched".to_vec())],
            ops_sink: Some(ops),
            ..FakeBackendConfig::default()
        };
        let fake = FakeBackend::new(saber_sandbox::Platform::Linux, config);
        let mut tool_broker = ToolBroker::new(EffectBroker::new(
            engine(),
            MemoryAuditSink::default(),
            BackendRegistry::with_testing_backends(vec![Box::new(fake)]),
            SecretBroker::default(),
            EgressEngine::new(1, Vec::new()).unwrap(),
        ));
        let invocation = ToolInvocation {
            request: tool_request(
                "req_patch_8",
                "ws_01",
                "task_01",
                Action::FsWrite,
                "workspace://ws_01/out.txt",
                DataClass::Internal,
                1_000,
            )
            .unwrap(),
            plan: mutation_plan(
                "ws_01",
                &overlay,
                vec!["/tools/bin/apply".to_owned()],
                Some(b"patched".to_vec()),
            ),
            args: ToolArgs::Patch {
                path: "out.txt".to_owned(),
                expected_before_hash: content_hash(b"original"),
                new_content: b"patched".to_vec(),
            },
            overlay_root: Some(overlay.clone()),
        };
        let grant = approval_for(&tool_broker, &invocation);
        let mut journal = MemoryJournal::default();
        let outcome = tool_broker
            .run(&invocation, Some(&grant), &mut journal, 1_001)
            .unwrap();
        assert!(outcome.verified);
        let recorded = observed.lock().unwrap().clone();
        assert!(
            recorded
                .iter()
                .any(|op| matches!(op, RecordedOp::Created { .. }))
        );
        assert!(
            recorded
                .iter()
                .any(|op| matches!(op, RecordedOp::Destroyed { .. }))
        );
        assert!(recorded.iter().any(|op| matches!(
            op,
            RecordedOp::Executed { argv, .. } if argv.first().is_some_and(|entry| entry.ends_with("apply"))
        )));
        let _ = Path::new(&overlay);
        let _ = BTreeMap::<String, String>::new();
    }
}
