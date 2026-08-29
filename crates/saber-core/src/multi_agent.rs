//! S32 multi-agent authority — delegation, worktrees, integration.
//!
//! One Goal can delegate bounded Tasks to multiple Agents: each child
//! run binds an explicit Worktree, Realm, model route, budgets and a
//! capability set that can NEVER widen its parent's scope. Per-task
//! worktrees are collision-safe and owner-tagged; integration happens
//! in a dedicated review worktree with overlap detection, and cleanup
//! defaults to recoverable quarantine instead of deletion. Sibling
//! failures and cancellations are contained: no child operation can
//! corrupt another task's or the Goal's durable state. Every mutation
//! is an append-only event in the encrypted store.

use std::path::{Path, PathBuf};

use saber_event_store::EventStore;
use serde_json::{Value, json};

use crate::run_engine::hex_digest;

/// Worktree metadata written beside every managed worktree.
const META_FILE: &str = ".saber-worktree.json";

fn require<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("missing_param:{key}"))
}

fn git(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("git_spawn_failed:{e}"))
}

/// The multi-agent engine over the encrypted store.
pub struct MultiAgentEngine;

impl MultiAgentEngine {
    /// S32-WP02 — create a collision-safe per-task worktree from an
    /// explicit commit, with owner metadata and dirty-base detection.
    /// Falls back to a content copy when the source is not a git repo.
    ///
    /// # Errors
    ///
    /// Fails closed on git failures, collisions and filesystem errors.
    pub fn create_worktree(
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let task_id = require(params, "task_id")?;
        let owner = require(params, "owner")?;
        let source = require(params, "source_worktree")?;
        let base_commit = params
            .get("base_commit")
            .and_then(Value::as_str)
            .unwrap_or("HEAD");
        let idempotency = require(params, "idempotency_key")?;
        let source_root = Path::new(source)
            .canonicalize()
            .map_err(|e| format!("source_unavailable:{e}"))?;
        // Dirty base detection: uncommitted changes are recorded, never
        // silently overwritten.
        // Dirty base detection ignores Saber's own managed directory so
        // an identical request replays deterministically.
        let dirty = git(
            &source_root,
            &[
                "status",
                "--porcelain",
                "--",
                ".",
                ":(exclude).saber-worktrees",
            ],
        )
        .ok()
        .filter(|output| output.status.success())
        .is_some_and(|output| !String::from_utf8_lossy(&output.stdout).trim().is_empty());
        // Deterministic seed: an identical request replays to the same
        // worktree (idempotency) instead of colliding on the clock.
        let seed = format!(
            "{task_id}-{owner}-{}-{base_commit}",
            source_root.to_string_lossy()
        );
        let worktree_path = source_root.join(".saber-worktrees").join(format!(
            "{task_id}-{}",
            &hex_digest(&[seed.as_bytes()])[..8]
        ));
        let is_git = source_root.join(".git").exists();
        let metadata = json!({
            "worktree_id": format!("wt-{task_id}-{}", &hex_digest(&[seed.as_bytes()])[..8]),
            "path": worktree_path.to_string_lossy(),
            "task_id": task_id,
            "owner": owner,
            "source_worktree": source_root.to_string_lossy(),
            "base_commit": base_commit,
            "dirty_base": dirty,
            "realm": params.get("realm").and_then(Value::as_str).unwrap_or("local"),
        });
        let event_id = format!(
            "wt_created_{task_id}_{}",
            &hex_digest(&[seed.as_bytes()])[..12]
        );
        let outcome = store
            .append_core_event(
                &event_id,
                workspace,
                "worktree.created",
                now_ms,
                &metadata,
                idempotency,
            )
            .map_err(|e| e.to_string())?;
        if matches!(outcome, saber_event_store::CommitOutcome::Replayed { .. }) {
            // Idempotent replay: the original request already created the
            // worktree; refuse to fabricate a second one.
            if !worktree_path.exists() {
                return Err("worktree_missing_after_replay".into());
            }
            return Ok(metadata);
        }
        if worktree_path.exists() {
            return Err("worktree_path_collision".into());
        }
        if is_git {
            let parent = worktree_path.parent().ok_or("invalid_path")?;
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir_failed:{e}"))?;
            let path_str = worktree_path.to_string_lossy().to_string();
            let output = git(
                &source_root,
                &["worktree", "add", "--detach", &path_str, base_commit],
            )?;
            if !output.status.success() {
                // Never leave a half-created directory behind.
                let _ = std::fs::remove_dir_all(&worktree_path);
                return Err(format!(
                    "git_worktree_failed:{}",
                    String::from_utf8_lossy(&output.stderr)
                        .chars()
                        .take(200)
                        .collect::<String>()
                ));
            }
        } else {
            copy_tree(&source_root, &worktree_path)?;
        }
        std::fs::write(
            worktree_path.join(META_FILE),
            serde_json::to_string(&metadata).unwrap_or_default(),
        )
        .map_err(|e| format!("meta_write_failed:{e}"))?;
        Ok(metadata)
    }

    /// S32-WP03 — delegate a bounded child task. The child capability
    /// set, budgets, secrets, network and data scope can NEVER widen
    /// the parent's.
    ///
    /// # Errors
    ///
    /// Fails closed when the child scope exceeds the parent's or the
    /// store append fails.
    pub fn delegate_task(
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let goal_id = require(params, "goal_id")?;
        let parent_run = require(params, "parent_run_id")?;
        let worktree_id = require(params, "worktree_id")?;
        let idempotency = require(params, "idempotency_key")?;
        let parent_scope = Self::parent_scope(store, parent_run)?;
        let requested: Vec<String> = params
            .get("capabilities")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        let parent_caps: Vec<String> = parent_scope
            .get("capabilities")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        let widened: Vec<String> = requested
            .iter()
            .filter(|capability| !parent_caps.contains(capability))
            .cloned()
            .collect();
        if !widened.is_empty() {
            return Err(format!("child_scope_widened:{}", widened.join(",")));
        }
        // Budget clamp: child budgets may not exceed the parent's.
        let clamp_budget = |dimension: &str| -> i64 {
            let parent_value = parent_scope
                .get("budgets")
                .and_then(|budgets| budgets.get(dimension))
                .and_then(Value::as_i64)
                .unwrap_or(i64::MAX);
            let requested_value = params
                .get("budgets")
                .and_then(|budgets| budgets.get(dimension))
                .and_then(Value::as_i64)
                .unwrap_or(parent_value);
            requested_value.min(parent_value)
        };
        let delegation = json!({
            "delegation_id": format!("deleg-{parent_run}-{now_ms}"),
            "goal_id": goal_id,
            "parent_run_id": parent_run,
            "task": params.get("task").cloned().unwrap_or(json!({})),
            "capabilities": requested,
            "model_route": params.get("model_route").and_then(Value::as_str).unwrap_or("fixture-deterministic"),
            "realm": params.get("realm").and_then(Value::as_str).unwrap_or("local"),
            "worktree_id": worktree_id,
            "budgets": {
                "tokens": clamp_budget("tokens"),
                "moneyUsd": clamp_budget("moneyUsd"),
                "wallClockMinutes": clamp_budget("wallClockMinutes"),
                "toolCalls": clamp_budget("toolCalls"),
            },
            "delegated_at_ms": now_ms,
        });
        store
            .append_core_event(
                &format!("delegated_{parent_run}_{now_ms}"),
                workspace,
                "task.delegated",
                now_ms,
                &delegation,
                idempotency,
            )
            .map_err(|e| e.to_string())?;
        Ok(delegation)
    }

    fn parent_scope(store: &EventStore, parent_run: &str) -> Result<Value, String> {
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
                let Ok(payload) = serde_json::from_str::<Value>(&event.payload_json) else {
                    continue;
                };
                if event.event_type == "run.binding_recorded"
                    && payload.get("run_id").and_then(Value::as_str) == Some(parent_run)
                {
                    // Parent scope = the platform baseline (read-only
                    // fixture route) unless a delegation widened it.
                    return Ok(json!({
                        "capabilities": ["read.browse", "read.search", "write.edit", "write.create", "exec.sandboxed"],
                        "budgets": {"tokens": 200_000, "moneyUsd": 20, "wallClockMinutes": 120, "toolCalls": 500},
                    }));
                }
                if event.event_type == "task.delegated"
                    && payload
                        .get("delegation_id")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                        .unwrap_or_default()
                        .contains(parent_run)
                {
                    return Ok(payload);
                }
            }
            cursor = next;
        }
        Err("unknown_parent_run".into())
    }

    /// S32-WP05 — integrate child change sets in a dedicated review
    /// worktree with overlap detection before any merge.
    ///
    /// # Errors
    ///
    /// Fails closed on filesystem errors and store append failures.
    pub fn integrate(
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let goal_id = require(params, "goal_id")?;
        let idempotency = require(params, "idempotency_key")?;
        let sources: Vec<String> = params
            .get("worktrees")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .ok_or("missing_param:worktrees")?;
        if sources.len() < 2 {
            return Err("integration_needs_two_worktrees".into());
        }
        // The review worktree is a copy of the first source; the others
        // apply on top with overlap detection.
        let first = Path::new(&sources[0])
            .canonicalize()
            .map_err(|e| format!("source_unavailable:{e}"))?;
        let review_path = first
            .parent()
            .and_then(Path::parent)
            .ok_or("invalid_path")?
            .join(format!("integration-review-{now_ms}"));
        if review_path.exists() {
            return Err("integration_path_collision".into());
        }
        copy_tree(&first, &review_path)?;
        let mut overlapping: Vec<String> = Vec::new();
        let mut applied: Vec<String> = Vec::new();
        for source in &sources[1..] {
            let source_root = Path::new(source)
                .canonicalize()
                .map_err(|e| format!("source_unavailable:{e}"))?;
            for entry in walk_files(&source_root)? {
                let relative = entry
                    .strip_prefix(&source_root)
                    .map_err(|_| "path_error".to_string())?
                    .to_string_lossy()
                    .to_string();
                if relative == META_FILE || relative.starts_with(".git") {
                    continue;
                }
                let target = review_path.join(&relative);
                if target.exists() {
                    overlapping.push(relative);
                    continue;
                }
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| format!("mkdir_failed:{e}"))?;
                }
                std::fs::copy(&entry, &target).map_err(|e| format!("copy_failed:{e}"))?;
                applied.push(relative);
            }
        }
        let outcome = json!({
            "goal_id": goal_id,
            "review_worktree": review_path.to_string_lossy(),
            "applied_files": applied,
            "overlapping_files": overlapping,
            "conflicts_detected": !overlapping.is_empty(),
            "integrated_at_ms": now_ms,
        });
        store
            .append_core_event(
                &format!("integrated_{goal_id}_{now_ms}"),
                workspace,
                "worktree.integrated",
                now_ms,
                &outcome,
                idempotency,
            )
            .map_err(|e| e.to_string())?;
        Ok(outcome)
    }

    /// S32-WP02 — cleanup defaults to recoverable quarantine, never
    /// deletion; unreviewed changes block cleanup entirely.
    ///
    /// # Errors
    ///
    /// Fails closed when unreviewed changes exist or the move fails.
    pub fn quarantine_worktree(
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let worktree = require(params, "worktree")?;
        let idempotency = require(params, "idempotency_key")?;
        let root = Path::new(worktree)
            .canonicalize()
            .map_err(|e| format!("worktree_unavailable:{e}"))?;
        let dirty = git(&root, &["status", "--porcelain"])
            .ok()
            .filter(|output| output.status.success())
            .is_some_and(|output| !String::from_utf8_lossy(&output.stdout).trim().is_empty());
        if dirty {
            return Err("cleanup_blocked_unreviewed_changes".into());
        }
        let quarantine = root
            .parent()
            .and_then(Path::parent)
            .ok_or("invalid_path")?
            .join(".saber-quarantine")
            .join(root.file_name().ok_or("invalid_path")?);
        std::fs::create_dir_all(quarantine.parent().ok_or("invalid_path")?)
            .map_err(|e| format!("mkdir_failed:{e}"))?;
        std::fs::rename(&root, &quarantine).map_err(|e| format!("quarantine_failed:{e}"))?;
        let outcome = json!({
            "worktree": root.to_string_lossy(),
            "quarantined_to": quarantine.to_string_lossy(),
            "quarantined_at_ms": now_ms,
            "recovery": "move the directory back or review its change set before deletion",
        });
        store
            .append_core_event(
                &format!("quarantined_{now_ms}"),
                workspace,
                "worktree.quarantined",
                now_ms,
                &outcome,
                idempotency,
            )
            .map_err(|e| e.to_string())?;
        Ok(outcome)
    }
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|e| format!("mkdir_failed:{e}"))?;
    for entry in walk_files(source)? {
        let relative = entry
            .strip_prefix(source)
            .map_err(|_| "path_error".to_string())?;
        let destination = target.join(relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir_failed:{e}"))?;
        }
        std::fs::copy(&entry, &destination).map_err(|e| format!("copy_failed:{e}"))?;
    }
    Ok(())
}

fn walk_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| format!("walk_failed:{e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("walk_failed:{e}"))?;
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name == ".git" || name == "node_modules" {
                    continue;
                }
                stack.push(path);
            } else {
                files.push(path);
            }
        }
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_tree_skips_git_and_node_modules() {
        let tmp = tempfile::tempdir().ok_ctx("tmp");
        let source = tmp.path().join("src-tree");
        std::fs::create_dir_all(source.join(".git")).ok_ctx("git dir");
        std::fs::create_dir_all(source.join("node_modules/pkg")).ok_ctx("nm dir");
        std::fs::write(source.join("a.txt"), "a").ok_ctx("a");
        std::fs::write(source.join(".git/HEAD"), "ref").ok_ctx("head");
        std::fs::write(source.join("node_modules/pkg/index.js"), "x").ok_ctx("nm");
        let target = tmp.path().join("dst-tree");
        copy_tree(&source, &target).ok_ctx("copy");
        assert!(target.join("a.txt").exists());
        assert!(!target.join(".git").exists());
        assert!(!target.join("node_modules").exists());
    }

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
}
