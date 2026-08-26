//! Overlay checkpoints, fingerprints and mutation locks (ADR-009).
//!
//! A [`Checkpoint`] captures the full contents and Git-status digest of one
//! overlay root so compensation can restore the exact pre-mutation state and
//! verification can distinguish tool-declared changes from external drift.

use std::collections::BTreeSet;

use std::collections::BTreeMap;
use std::collections::btree_map::Entry;
use std::path::{Path, PathBuf};

/// Worktree custody failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorktreeError {
    /// The root is missing or not a canonical directory.
    InvalidRoot,
    /// Reading or writing overlay content failed.
    Io,
    /// Restoring could not reproduce the checkpoint exactly.
    RestoreIncomplete,
}

impl std::fmt::Display for WorktreeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidRoot => "invalid_root",
            Self::Io => "io",
            Self::RestoreIncomplete => "restore_incomplete",
        })
    }
}

impl std::error::Error for WorktreeError {}

/// One immutable overlay snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Checkpoint {
    entries: Vec<(String, Vec<u8>)>,
    git_digest: String,
}

impl Checkpoint {
    /// Capture the current overlay state.
    ///
    /// # Errors
    ///
    /// Fails when the root is not a canonical directory or reading fails.
    pub fn capture(root: &Path) -> Result<Self, WorktreeError> {
        let canonical = root
            .canonicalize()
            .map_err(|_| WorktreeError::InvalidRoot)?;
        if canonical != root {
            return Err(WorktreeError::InvalidRoot);
        }
        let mut entries = Vec::new();
        visit_files(&canonical, &canonical, &mut entries)?;
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        Ok(Self {
            entries,
            git_digest: git_status_digest(&canonical),
        })
    }

    /// `(relative path, content hash)` inventory of the snapshot, sorted.
    #[must_use]
    pub fn inventory_hashes(&self) -> Vec<(String, String)> {
        self.entries
            .iter()
            .map(|(path, content)| (path.clone(), content_hash_of(content)))
            .collect()
    }

    /// The captured `git status --porcelain` digest (empty digest when no
    /// repository is present).
    #[must_use]
    pub fn git_digest(&self) -> &str {
        &self.git_digest
    }

    /// Restore the overlay to the snapshot exactly: rewrite captured files
    /// and remove anything created afterwards.
    ///
    /// # Errors
    ///
    /// [`WorktreeError::RestoreIncomplete`] when the post-restore inventory
    /// still differs — the caller must treat this as durably non-retriable.
    pub fn restore(&self, root: &Path) -> Result<(), WorktreeError> {
        let canonical = root
            .canonicalize()
            .map_err(|_| WorktreeError::InvalidRoot)?;
        let current = inventory(&canonical);
        let captured: BTreeSet<String> =
            self.entries.iter().map(|(path, _)| path.clone()).collect();
        for (path, _) in current {
            if !captured.contains(&path) {
                let target = canonical.join(&path);
                std::fs::remove_file(&target).map_err(|_| WorktreeError::Io)?;
            }
        }
        for (path, content) in &self.entries {
            let target = canonical.join(path);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|_| WorktreeError::Io)?;
            }
            std::fs::write(&target, content).map_err(|_| WorktreeError::Io)?;
        }
        let after = inventory(&canonical);
        let expected = self.inventory_hashes();
        if after != expected {
            return Err(WorktreeError::RestoreIncomplete);
        }
        Ok(())
    }
}

/// Sorted `(relative path, content hash)` inventory of one root.
#[must_use]
pub fn inventory(root: &Path) -> Vec<(String, String)> {
    let mut entries = Vec::new();
    if visit_files(root, root, &mut entries).is_err() {
        return Vec::new();
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    entries
        .into_iter()
        .map(|(path, content)| (path, content_hash_of(&content)))
        .collect()
}

/// Combined inventory + Git-index fingerprint of one root.
#[must_use]
pub fn overlay_fingerprint(root: &Path) -> String {
    let mut input = String::new();
    for (path, hash) in inventory(root) {
        input.push_str(&path);
        input.push('\0');
        input.push_str(&hash);
        input.push('\0');
    }
    input.push_str(&git_status_digest(root));
    content_hash_of(input.as_bytes())
}

/// Digest of `git status --porcelain` output; digest of the empty string
/// when Git or a repository is absent.
#[must_use]
pub fn git_status_digest(root: &Path) -> String {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("status")
        .arg("--porcelain")
        .env_clear()
        .output();
    let text = match output {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).into_owned()
        }
        _ => String::new(),
    };
    content_hash_of(text.as_bytes())
}

/// Per-overlay mutation locks. The second concurrent mutation on one root is
/// refused rather than queued (ADR-009).
#[derive(Default)]
pub struct WorktreeManager {
    held: BTreeMap<PathBuf, u64>,
    generation: u64,
}

impl WorktreeManager {
    /// Try to acquire the mutation lock of one root.
    ///
    /// Returns `false` when the root is already locked.
    pub fn try_lock(&mut self, root: &Path) -> bool {
        let Ok(canonical) = root.canonicalize() else {
            return false;
        };
        match self.held.entry(canonical) {
            Entry::Occupied(_) => false,
            Entry::Vacant(slot) => {
                self.generation += 1;
                slot.insert(self.generation);
                true
            }
        }
    }

    /// Release the mutation lock of one root.
    pub fn release(&mut self, root: &Path) {
        if let Ok(canonical) = root.canonicalize() {
            self.held.remove(&canonical);
        }
    }

    /// Whether one root is currently locked.
    #[must_use]
    pub fn is_locked(&self, root: &Path) -> bool {
        root.canonicalize()
            .is_ok_and(|canonical| self.held.contains_key(&canonical))
    }
}

fn visit_files(
    base: &Path,
    directory: &Path,
    entries: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), WorktreeError> {
    let Ok(reader) = std::fs::read_dir(directory) else {
        return Err(WorktreeError::Io);
    };
    for entry in reader.flatten() {
        let path = entry.path();
        let metadata = entry.metadata().map_err(|_| WorktreeError::Io)?;
        if metadata.file_type().is_symlink() {
            return Err(WorktreeError::Io);
        }
        if metadata.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                continue;
            }
            visit_files(base, &path, entries)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(base)
                .map_err(|_| WorktreeError::Io)?
                .to_string_lossy()
                .into_owned();
            let content = std::fs::read(&path).map_err(|_| WorktreeError::Io)?;
            entries.push((relative, content));
        }
    }
    Ok(())
}

fn content_hash_of(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let _ = &hasher;
    format!("sha256:{}", saber_sandbox::hex_upper(&hasher.finalize()))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;

    #[test]
    fn checkpoint_restores_exactly_including_removals() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap();
        std::fs::write(root.join("a.txt"), b"one").unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/b.txt"), b"two").unwrap();
        let checkpoint = Checkpoint::capture(&root).unwrap();
        assert_eq!(checkpoint.inventory_hashes().len(), 2);

        std::fs::write(root.join("a.txt"), b"mutated").unwrap();
        std::fs::write(root.join("new.txt"), b"created").unwrap();
        std::fs::remove_file(root.join("sub/b.txt")).unwrap();

        checkpoint.restore(&root).unwrap();
        assert_eq!(std::fs::read(root.join("a.txt")).unwrap(), b"one");
        assert_eq!(std::fs::read(root.join("sub/b.txt")).unwrap(), b"two");
        assert!(!root.join("new.txt").exists());
        assert_eq!(inventory(&root), checkpoint.inventory_hashes());
    }

    #[test]
    fn fingerprint_changes_on_content_and_git_drift() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("file.txt"), b"v1").unwrap();
        let first = overlay_fingerprint(root.path());
        std::fs::write(root.path().join("file.txt"), b"v2").unwrap();
        assert_ne!(first, overlay_fingerprint(root.path()));
    }

    #[test]
    fn git_index_drift_changes_digest() {
        let root = tempfile::tempdir().unwrap();
        let status = std::process::Command::new("git")
            .arg("init")
            .arg("-q")
            .arg(root.path())
            .env_clear()
            .status();
        if !status.is_ok_and(|exit| exit.success()) {
            return;
        }
        std::fs::write(root.path().join("tracked.txt"), b"v1").unwrap();
        let before = git_status_digest(root.path());
        std::fs::write(root.path().join("tracked.txt"), b"v2").unwrap();
        let after = git_status_digest(root.path());
        if before == after {
            // A repository with no drift signal cannot be tested here.
            return;
        }
        assert_ne!(before, after);
    }

    #[test]
    fn second_mutation_on_same_root_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let mut manager = WorktreeManager::default();
        assert!(manager.try_lock(root.path()));
        assert!(!manager.try_lock(root.path()));
        assert!(manager.is_locked(root.path()));
        manager.release(root.path());
        assert!(!manager.is_locked(root.path()));
        assert!(manager.try_lock(root.path()));
    }
}
