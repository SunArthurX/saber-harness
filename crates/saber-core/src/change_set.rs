//! S31 change set authority — snapshot, review, apply, rollback, commit.
//!
//! A governed run's worktree changes become an independently reviewable
//! Change Set: the baseline inventory (every file's content hash, snap-
//! shot at run start) is diffed against the current tree, classified
//! (added/modified/deleted, binary, generated, untracked), and bound to
//! the run, worktree and artifact digests. Apply requires the EXACT
//! expected tree digest (external edits block stale applies), rollback
//! restores the baseline content and PROVES it by hash, and commit runs
//! real git in the worktree only after the user's message and
//! authorship disclosure are recorded. Every step is an append-only
//! event in the encrypted store; a model message alone never produces a
//! completed state.

use std::collections::BTreeMap;
use std::path::Path;

use saber_event_store::EventStore;
use serde_json::{Value, json};

use crate::run_engine::hex_digest;

/// Files that never belong to a change set inventory.
const IGNORED_PATHS: [&str; 3] = [".git", "node_modules", ".saber-snapshots"];

/// Paths that look machine-generated (flagged, still reviewable).
const GENERATED_HINTS: [&str; 4] = ["dist/", "build/", "generated/", ".min."];

/// One inventory entry: content hash and size.
fn inventory_entry(bytes: &[u8]) -> Value {
    json!({ "sha256": hex_digest(&[bytes]), "size": bytes.len() })
}

/// Walk the worktree and hash every file (tracked and untracked alike).
fn inventory(worktree: &Path) -> Result<BTreeMap<String, Value>, String> {
    let mut map = BTreeMap::new();
    let mut stack = vec![worktree.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| format!("walk_failed:{e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("walk_failed:{e}"))?;
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            if path.is_dir() {
                if IGNORED_PATHS.contains(&name.as_str()) {
                    continue;
                }
                stack.push(path);
            } else {
                let relative = path
                    .strip_prefix(worktree)
                    .map_err(|_| "path_outside_worktree".to_string())?
                    .to_string_lossy()
                    .to_string();
                let bytes = std::fs::read(&path).map_err(|e| format!("read_failed:{e}"))?;
                map.insert(relative, inventory_entry(&bytes));
            }
        }
    }
    Ok(map)
}

/// Deterministic tree digest over the sorted inventory.
fn tree_digest(map: &BTreeMap<String, Value>) -> String {
    let canonical = serde_json::to_string(&map).unwrap_or_default();
    hex_digest(&[canonical.as_bytes()])
}

/// Heuristic: does this content look binary (non-textual bytes)?
fn looks_binary(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(1024)];
    sample.contains(&0)
}

fn classify(relative: &str, bytes: &[u8], untracked: bool) -> String {
    let _ = bytes;
    let mut classes = vec!["untracked"];
    if !untracked {
        classes[0] = "tracked";
    }
    if looks_binary(bytes) {
        classes.push("binary");
    }
    if GENERATED_HINTS.iter().any(|hint| relative.contains(hint)) {
        classes.push("generated");
    }
    classes.join("+")
}

/// The change set engine over one governed run's worktree.
pub struct ChangeSetEngine;

impl ChangeSetEngine {
    /// Snapshot the baseline at run start: content copies plus a manifest.
    /// Returns the manifest for the run's binding event.
    /// # Errors
    ///
    /// Fails when the worktree walk or a content copy fails.
    pub fn snapshot_baseline(
        store_dir: &Path,
        run_id: &str,
        worktree: &str,
    ) -> Result<Value, String> {
        let root = Path::new(worktree)
            .canonicalize()
            .map_err(|e| format!("worktree_unavailable:{e}"))?;
        let snapshot_dir = store_dir.join("snapshots").join(run_id);
        let manifest = inventory(&root)?;
        for (relative, entry) in &manifest {
            let source = root.join(relative);
            let target = snapshot_dir.join(relative);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("snapshot_mkdir_failed:{e}"))?;
            }
            std::fs::copy(&source, &target).map_err(|e| format!("snapshot_copy_failed:{e}"))?;
            let _ = entry;
        }
        let manifest_value = serde_json::to_value(&manifest).map_err(|e| format!("json:{e}"))?;
        Ok(json!({
            "run_id": run_id,
            "manifest": manifest_value,
            "tree_digest": tree_digest(&manifest),
            "file_count": manifest.len(),
        }))
    }

    /// Prepare a change set: diff the current tree against the baseline.
    /// # Errors
    ///
    /// Fails closed on unknown runs, missing baselines, walk failures and store errors.
    pub fn prepare(
        store: &mut EventStore,
        _store_dir: &Path,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let run_id = require(params, "run_id")?;
        let idempotency = require(params, "idempotency_key")?;
        let worktree = Self::bound_worktree(store, run_id)?;
        let baseline = Self::baseline_manifest(store, run_id)?;
        let root = Path::new(&worktree)
            .canonicalize()
            .map_err(|e| format!("worktree_unavailable:{e}"))?;
        let current = inventory(&root)?;
        let mut files = Vec::new();
        let mut external_edits = Vec::new();
        for (relative, entry) in &current {
            let base = baseline.get(relative);
            let bytes =
                std::fs::read(root.join(relative)).map_err(|e| format!("read_failed:{e}"))?;
            let change = match base {
                None => "added",
                Some(base_entry) if base_entry.get("sha256") != entry.get("sha256") => "modified",
                Some(_) => "unchanged",
            };
            if change == "unchanged" {
                continue;
            }
            // External/manual edit detection: the file changed but the run
            // never recorded an effect touching it.
            if change == "modified" && !Self::run_touched(store, run_id, relative)? {
                external_edits.push(relative.clone());
            }
            files.push(json!({
                "path": relative,
                "change": change,
                "classification": classify(relative, &bytes, true),
                "baseline": base.cloned().unwrap_or(Value::Null),
                "current": entry,
            }));
        }
        for (relative, entry) in &baseline {
            if !current.contains_key(relative) {
                files.push(json!({
                    "path": relative,
                    "change": "deleted",
                    "classification": "deleted",
                    "baseline": entry,
                    "current": Value::Null,
                }));
            }
        }
        let digest = tree_digest(&current);
        let changeset = json!({
            "changeset_id": format!("cs-{run_id}-{now_ms}"),
            "run_id": run_id,
            "worktree": worktree,
            "baseline_tree_digest": baseline_digest(&baseline),
            "tree_digest": digest,
            "files": files,
            "external_edits": external_edits,
            "prepared_at_ms": now_ms,
        });
        store
            .append_core_event(
                &format!("cs_prepared_{run_id}_{now_ms}"),
                workspace,
                "changeset.prepared",
                now_ms,
                &changeset,
                idempotency,
            )
            .map_err(|e| e.to_string())?;
        Ok(changeset)
    }

    /// Apply the reviewed change set. The expected tree digest must match
    /// the CURRENT tree exactly — any drift blocks the apply.
    /// # Errors
    ///
    /// Fails closed when the expected tree digest does not match the current tree (stale apply) or the store append fails.
    pub fn apply(
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let run_id = require(params, "run_id")?;
        let idempotency = require(params, "idempotency_key")?;
        let expected = require(params, "expected_tree_digest")?;
        let worktree = Self::bound_worktree(store, run_id)?;
        let root = Path::new(&worktree)
            .canonicalize()
            .map_err(|e| format!("worktree_unavailable:{e}"))?;
        let current = inventory(&root)?;
        let actual = tree_digest(&current);
        if actual != expected {
            return Err(format!("stale_apply_blocked:{actual}"));
        }
        let accepted = params
            .get("accepted_paths")
            .and_then(Value::as_array)
            .cloned();
        let outcome = json!({
            "run_id": run_id,
            "applied_tree_digest": actual,
            "accepted_paths": accepted.unwrap_or_default(),
            "applied_at_ms": now_ms,
        });
        store
            .append_core_event(
                &format!("cs_applied_{run_id}_{now_ms}"),
                workspace,
                "changeset.applied",
                now_ms,
                &outcome,
                idempotency,
            )
            .map_err(|e| e.to_string())?;
        Ok(outcome)
    }

    /// Rollback: restore the baseline content and PROVE it by hashes.
    /// # Errors
    ///
    /// Fails closed when restoration cannot be proven by hashes or the store append fails.
    pub fn rollback(
        store: &mut EventStore,
        store_dir: &Path,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let run_id = require(params, "run_id")?;
        let idempotency = require(params, "idempotency_key")?;
        let worktree = Self::bound_worktree(store, run_id)?;
        let baseline = Self::baseline_manifest(store, run_id)?;
        let root = Path::new(&worktree)
            .canonicalize()
            .map_err(|e| format!("worktree_unavailable:{e}"))?;
        let snapshot_dir = store_dir.join("snapshots").join(run_id);
        // Restore every baseline file, remove everything not in it.
        for relative in baseline.keys() {
            let source = snapshot_dir.join(relative);
            let target = root.join(relative);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("restore_mkdir_failed:{e}"))?;
            }
            std::fs::copy(&source, &target).map_err(|e| format!("restore_failed:{e}"))?;
        }
        let current = inventory(&root)?;
        for relative in current.keys() {
            if !baseline.contains_key(relative) {
                std::fs::remove_file(root.join(relative))
                    .map_err(|e| format!("remove_failed:{e}"))?;
            }
        }
        // The proof: every hash must equal the baseline manifest.
        let after = inventory(&root)?;
        let mut mismatches = Vec::new();
        for (relative, entry) in &baseline {
            if after.get(relative) != Some(entry) {
                mismatches.push(relative.clone());
            }
        }
        for relative in after.keys() {
            if !baseline.contains_key(relative) {
                mismatches.push(format!("{relative}:unexpected"));
            }
        }
        let restored = mismatches.is_empty();
        let proof = json!({
            "run_id": run_id,
            "restored": restored,
            "baseline_file_count": baseline.len(),
            "restored_file_count": after.len(),
            "restored_tree_digest": tree_digest(&after),
            "mismatches": mismatches,
            "rolled_back_at_ms": now_ms,
        });
        store
            .append_core_event(
                &format!("cs_rolled_back_{run_id}_{now_ms}"),
                workspace,
                "changeset.rolled_back",
                now_ms,
                &proof,
                idempotency,
            )
            .map_err(|e| e.to_string())?;
        if !restored {
            return Err("rollback_proof_failed".into());
        }
        Ok(proof)
    }

    /// Commit: real git commit in the worktree, after the message and
    /// authorship disclosure are durably recorded.
    /// # Errors
    ///
    /// Fails closed for non-git worktrees, git failures and store errors.
    pub fn commit(
        store: &mut EventStore,
        workspace: &str,
        params: &Value,
        now_ms: u64,
    ) -> Result<Value, String> {
        let run_id = require(params, "run_id")?;
        let idempotency = require(params, "idempotency_key")?;
        let message = require(params, "message")?;
        let disclosure = params
            .get("authorship_disclosure")
            .and_then(Value::as_str)
            .unwrap_or("agent-assisted");
        let worktree = Self::bound_worktree(store, run_id)?;
        let root = Path::new(&worktree)
            .canonicalize()
            .map_err(|e| format!("worktree_unavailable:{e}"))?;
        if !root.join(".git").exists() {
            return Err("worktree_not_a_git_repository".into());
        }
        let current = inventory(&root)?;
        let disclosure_record = json!({
            "run_id": run_id,
            "message": message,
            "authorship_disclosure": disclosure,
            "signing": params.get("signing").and_then(Value::as_str).unwrap_or("none"),
            "tree_digest": tree_digest(&current),
        });
        store
            .append_core_event(
                &format!("cs_commit_disclosed_{run_id}_{now_ms}"),
                workspace,
                "changeset.commit_disclosed",
                now_ms,
                &disclosure_record,
                &format!("{idempotency}-disclosure"),
            )
            .map_err(|e| e.to_string())?;
        for argv in [
            vec!["git".to_string(), "add".into(), "-A".into()],
            vec![
                "git".to_string(),
                "commit".into(),
                "-m".into(),
                format!("{message}\n\nAuthorship: {disclosure}\nRun: {run_id}"),
            ],
        ] {
            let status = std::process::Command::new(&argv[0])
                .args(&argv[1..])
                .current_dir(&root)
                .output()
                .map_err(|e| format!("git_spawn_failed:{e}"))?;
            if !status.status.success() {
                return Err(format!(
                    "git_failed:{}",
                    String::from_utf8_lossy(&status.stderr)
                        .chars()
                        .take(200)
                        .collect::<String>()
                ));
            }
        }
        let head = std::process::Command::new("git")
            .arg("rev-parse")
            .arg("HEAD")
            .current_dir(&root)
            .output()
            .map_err(|e| format!("git_spawn_failed:{e}"))?;
        let commit_sha = String::from_utf8_lossy(&head.stdout).trim().to_string();
        let outcome = json!({
            "run_id": run_id,
            "commit": commit_sha,
            "message": message,
            "authorship_disclosure": disclosure,
        });
        store
            .append_core_event(
                &format!("cs_committed_{run_id}_{now_ms}"),
                workspace,
                "changeset.committed",
                now_ms,
                &outcome,
                idempotency,
            )
            .map_err(|e| e.to_string())?;
        Ok(outcome)
    }

    fn bound_worktree(store: &EventStore, run_id: &str) -> Result<String, String> {
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
                if event.event_type != "run.binding_recorded" {
                    continue;
                }
                let Ok(payload) = serde_json::from_str::<Value>(&event.payload_json) else {
                    continue;
                };
                if payload.get("run_id").and_then(Value::as_str) == Some(run_id) {
                    return payload
                        .get("worktree")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                        .ok_or("binding_missing_worktree".into());
                }
            }
            cursor = next;
        }
        Err("unknown_run".into())
    }

    fn baseline_manifest(
        store: &EventStore,
        run_id: &str,
    ) -> Result<BTreeMap<String, Value>, String> {
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
                if event.event_type != "run.baseline_snapshot" {
                    continue;
                }
                let Ok(payload) = serde_json::from_str::<Value>(&event.payload_json) else {
                    continue;
                };
                if payload.get("run_id").and_then(Value::as_str) == Some(run_id) {
                    let manifest = payload.get("manifest").ok_or("baseline_missing_manifest")?;
                    let map: BTreeMap<String, Value> = serde_json::from_value(manifest.clone())
                        .map_err(|e| format!("json:{e}"))?;
                    return Ok(map);
                }
            }
            cursor = next;
        }
        Err("baseline_missing".into())
    }

    /// Did the run journal record an effect touching this path?
    fn run_touched(store: &EventStore, run_id: &str, relative: &str) -> Result<bool, String> {
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
                if event.event_type != "run.waiting_approval" {
                    continue;
                }
                let Ok(payload) = serde_json::from_str::<Value>(&event.payload_json) else {
                    continue;
                };
                let Some(card) = payload.get("card") else {
                    continue;
                };
                if card.get("run_id").and_then(Value::as_str) != Some(run_id) {
                    continue;
                }
                if card.get("resource").and_then(Value::as_str) == Some(relative) {
                    return Ok(true);
                }
            }
            cursor = next;
        }
        Ok(false)
    }
}

fn baseline_digest(baseline: &BTreeMap<String, Value>) -> String {
    tree_digest(baseline)
}

fn require<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("missing_param:{key}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_and_generated_classification() {
        assert!(looks_binary(b"abc\x00def"));
        assert!(!looks_binary(b"plain text\n"));
        assert!(classify("dist/app.js", b"var x=1", true).contains("generated"));
        assert!(classify("img.png", &[0, 159, 0, 1], true).contains("binary"));
        assert!(classify("src/main.rs", b"fn main(){}", true).contains("untracked"));
    }
}
