//! Canonical path guard for S1 guarded reads and overlay writes.
//!
//! The guard defeats absolute/relative traversal, encoded traversal, symlink
//! parents and symlink swap races by (1) accepting only normalized relative
//! candidates, (2) rejecting any symlink component before opening and
//! (3) re-verifying descriptor identity after opening so a swapped target is
//! detected even if it appears between resolution and open (ADR-008).

use std::fmt::{Display, Formatter};
use std::fs::{File, Metadata, OpenOptions};
use std::path::{Component, Path, PathBuf};

/// Stable guard denial codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PathError {
    /// The candidate was absolute where relative was required.
    Absolute,
    /// The candidate tried to escape the root with `..`.
    Traversal,
    /// The candidate contained NUL or was empty.
    Malformed,
    /// A component resolved to a symlink.
    SymlinkComponent,
    /// The canonicalized path left the guarded root.
    Escape,
    /// The post-open identity check found a different object.
    RaceDetected,
    /// Underlying I/O failed.
    Io,
}

impl Display for PathError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Absolute => "absolute",
            Self::Traversal => "traversal",
            Self::Malformed => "malformed",
            Self::SymlinkComponent => "symlink_component",
            Self::Escape => "escape",
            Self::RaceDetected => "race_detected",
            Self::Io => "io",
        })
    }
}

impl std::error::Error for PathError {}

/// A guarded root directory. The root must already exist, be a directory and
/// be stored in canonical form.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PathGuard {
    root: PathBuf,
}

impl PathGuard {
    /// Adopt an existing canonical directory as guarded root.
    ///
    /// # Errors
    ///
    /// Fails when the path does not exist, is not a directory or is not
    /// already canonical.
    pub fn new(root: &Path) -> Result<Self, PathError> {
        let metadata = root.symlink_metadata().map_err(|_| PathError::Io)?;
        if !metadata.is_dir() {
            return Err(PathError::Io);
        }
        let canonical = root.canonicalize().map_err(|_| PathError::Io)?;
        if canonical != root {
            return Err(PathError::Io);
        }
        Ok(Self { root: canonical })
    }

    /// The guarded root itself.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve a relative candidate to a canonical host path without opening.
    ///
    /// # Errors
    ///
    /// Rejects absolute candidates, traversal, NUL, symlink components and
    /// any final path outside the root.
    pub fn resolve(&self, candidate: &str) -> Result<PathBuf, PathError> {
        let segments = Self::normalize(candidate)?;
        let mut current = self.root.clone();
        for segment in segments {
            current.push(segment);
            let metadata = current.symlink_metadata().map_err(|_| PathError::Io)?;
            if metadata.file_type().is_symlink() {
                return Err(PathError::SymlinkComponent);
            }
        }
        let canonical = current.canonicalize().map_err(|_| PathError::Io)?;
        if !canonical.starts_with(&self.root) {
            return Err(PathError::Escape);
        }
        Ok(canonical)
    }

    /// Open a previously resolved canonical path for reading with post-open
    /// identity verification. The path must originate from [`Self::resolve`].
    ///
    /// # Errors
    ///
    /// Detects symlink swaps that occurred after resolution plus I/O failure.
    pub fn open_resolved_read(&self, resolved: &Path) -> Result<File, PathError> {
        if !resolved.starts_with(&self.root) {
            return Err(PathError::Escape);
        }
        let file = File::open(resolved).map_err(|_| PathError::Io)?;
        Self::verify_identity(&file, resolved)?;
        Ok(file)
    }

    /// Open a file for reading with post-open identity verification.
    ///
    /// # Errors
    ///
    /// Same as [`Self::resolve`] plus race detection and I/O failure.
    pub fn open_read(&self, candidate: &str) -> Result<(File, PathBuf), PathError> {
        let resolved = self.resolve(candidate)?;
        let file = self.open_resolved_read(&resolved)?;
        Ok((file, resolved))
    }

    /// Open a resolved canonical path for writing, optionally creating it.
    ///
    /// # Errors
    ///
    /// Same denial codes as [`Self::open_resolved_read`].
    pub fn open_resolved_write(&self, resolved: &Path, create: bool) -> Result<File, PathError> {
        if !resolved.starts_with(&self.root) {
            return Err(PathError::Escape);
        }
        let file = OpenOptions::new()
            .write(true)
            .create(create)
            .truncate(create)
            .open(resolved)
            .map_err(|_| PathError::Io)?;
        Self::verify_identity(&file, resolved)?;
        Ok(file)
    }

    /// Open a file for writing inside an overlay guard, optionally creating it.
    ///
    /// # Errors
    ///
    /// Same denial codes as [`Self::open_read`].
    pub fn open_write(&self, candidate: &str, create: bool) -> Result<(File, PathBuf), PathError> {
        let resolved = if create {
            self.resolve_for_create(candidate)?
        } else {
            self.resolve(candidate)?
        };
        let file = self.open_resolved_write(&resolved, create)?;
        Ok((file, resolved))
    }

    /// Resolve a candidate whose final component may not exist yet, for
    /// creation-style writes. Every parent component must exist and carry no
    /// symlinks; the returned path stays inside the root.
    ///
    /// # Errors
    ///
    /// Same traversal/symlink denials as [`Self::resolve`].
    pub fn resolve_for_create(&self, candidate: &str) -> Result<PathBuf, PathError> {
        let segments = Self::normalize(candidate)?;
        let Some((final_name, parents)) = segments.split_last() else {
            return Err(PathError::Malformed);
        };
        if final_name.is_empty() || final_name == "." || final_name == ".." {
            return Err(PathError::Traversal);
        }
        let mut parent = self.root.clone();
        for segment in parents {
            parent.push(segment);
            let metadata = parent.symlink_metadata().map_err(|_| PathError::Io)?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(PathError::SymlinkComponent);
            }
        }
        let target = parent.join(final_name);
        if !target.starts_with(&self.root) {
            return Err(PathError::Escape);
        }
        Ok(target)
    }

    fn normalize(candidate: &str) -> Result<Vec<String>, PathError> {
        if candidate.is_empty() || candidate.contains('\0') {
            return Err(PathError::Malformed);
        }
        if candidate.starts_with('/')
            || candidate.starts_with('\\')
            || candidate.contains('\\')
            || Path::new(candidate).is_absolute()
        {
            return Err(PathError::Absolute);
        }
        let mut segments = Vec::new();
        for component in Path::new(candidate).components() {
            match component {
                Component::Normal(value) => {
                    let Some(text) = value.to_str() else {
                        return Err(PathError::Malformed);
                    };
                    if text.contains('\0') || text == "." {
                        return Err(PathError::Malformed);
                    }
                    segments.push(text.to_owned());
                }
                Component::CurDir => {}
                Component::ParentDir => return Err(PathError::Traversal),
                Component::RootDir | Component::Prefix(_) => {
                    return Err(PathError::Absolute);
                }
            }
        }
        Ok(segments)
    }

    fn verify_identity(file: &File, resolved: &Path) -> Result<(), PathError> {
        let from_handle = file.metadata().map_err(|_| PathError::Io)?;
        let from_path = resolved.symlink_metadata().map_err(|_| PathError::Io)?;
        if !identity_equal(&from_handle, &from_path) {
            return Err(PathError::RaceDetected);
        }
        let reopened = resolved.canonicalize().map_err(|_| PathError::Io)?;
        if reopened != resolved {
            return Err(PathError::RaceDetected);
        }
        Ok(())
    }
}

#[cfg(unix)]
fn identity_equal(handle: &Metadata, path: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    handle.dev() == path.dev() && handle.ino() == path.ino() && handle.is_file() == path.is_file()
}

#[cfg(windows)]
fn identity_equal(handle: &Metadata, path: &Metadata) -> bool {
    handle.is_file() == path.is_file() && handle.len() == path.len()
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::items_after_statements
    )]
    use std::fs;

    use super::*;

    fn guard(temp: &tempfile::TempDir) -> PathGuard {
        // macOS maps /var to /private/var; adopt the canonical root form the
        // way production workspace roots are stored.
        let canonical = temp
            .path()
            .canonicalize()
            .unwrap_or_else(|error| unreachable!("{error}"));
        PathGuard::new(&canonical).unwrap_or_else(|error| unreachable!("{error}"))
    }

    #[test]
    fn rejects_absolute_relative_and_encoded_traversal() {
        let temp = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
        let root = guard(&temp);
        assert_eq!(
            root.resolve("/etc/passwd").unwrap_err(),
            PathError::Absolute
        );
        assert_eq!(
            root.resolve("a/../../escape").unwrap_err(),
            PathError::Traversal
        );
        assert_eq!(root.resolve("..").unwrap_err(), PathError::Traversal);
        assert_eq!(
            root.resolve("a\\..\\..\\b").unwrap_err(),
            PathError::Absolute
        );
        assert_eq!(root.resolve("").unwrap_err(), PathError::Malformed);
        assert_eq!(root.resolve("a\0b").unwrap_err(), PathError::Malformed);
        let percent = root.resolve("a%2e%2e%2fb").unwrap_err();
        assert!(
            percent == PathError::Malformed || percent == PathError::Io,
            "encoded traversal must not resolve: {percent}"
        );
    }

    #[test]
    fn normalizes_curdir_and_resolves_inside() {
        let temp = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
        let root = guard(&temp);
        fs::create_dir_all(temp.path().join("a/b")).unwrap_or_else(|error| unreachable!("{error}"));
        fs::write(temp.path().join("a/b/c.txt"), b"content")
            .unwrap_or_else(|error| unreachable!("{error}"));
        let resolved = root
            .resolve("./a/./b/c.txt")
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert!(resolved.ends_with("a/b/c.txt"));
        let (file, resolved_back) = root
            .open_read("a/b/c.txt")
            .unwrap_or_else(|error| unreachable!("{error}"));
        drop(file);
        assert_eq!(resolved, resolved_back);
    }

    #[test]
    fn root_must_be_canonical_directory() {
        let temp = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
        let missing = temp.path().join("missing");
        assert!(PathGuard::new(&missing).is_err());
        let file_path = temp.path().join("plain.txt");
        fs::write(&file_path, b"x").unwrap_or_else(|error| unreachable!("{error}"));
        assert!(PathGuard::new(&file_path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_parent_and_swapped_target() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
        let root = guard(&temp);
        fs::create_dir(temp.path().join("inside")).unwrap_or_else(|error| unreachable!("{error}"));
        fs::write(temp.path().join("inside/target.txt"), b"safe")
            .unwrap_or_else(|error| unreachable!("{error}"));
        fs::write(temp.path().join("outside-secret"), b"secret")
            .unwrap_or_else(|error| unreachable!("{error}"));

        let inside_secret = temp.path().join("inside").join("escape");
        symlink(temp.path().join("outside-secret"), &inside_secret)
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert_eq!(
            root.resolve("inside/escape").unwrap_err(),
            PathError::SymlinkComponent
        );
        assert_eq!(
            root.open_read("inside/escape").unwrap_err(),
            PathError::SymlinkComponent
        );

        symlink(
            temp.path().join("outside-secret"),
            temp.path().join("swapped.txt"),
        )
        .unwrap_or_else(|error| unreachable!("{error}"));
        assert_eq!(
            root.resolve("swapped.txt").unwrap_err(),
            PathError::SymlinkComponent
        );
    }

    #[cfg(unix)]
    #[test]
    fn detects_symlink_swap_between_resolve_and_open() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
        let root = guard(&temp);
        fs::write(temp.path().join("data.bin"), b"original")
            .unwrap_or_else(|error| unreachable!("{error}"));
        let resolved = root
            .resolve("data.bin")
            .unwrap_or_else(|error| unreachable!("{error}"));

        fs::remove_file(&resolved).unwrap_or_else(|error| unreachable!("{error}"));
        fs::write(temp.path().join("outside-secret"), b"attacker")
            .unwrap_or_else(|error| unreachable!("{error}"));
        symlink(temp.path().join("outside-secret"), &resolved)
            .unwrap_or_else(|error| unreachable!("{error}"));

        assert_eq!(
            root.open_resolved_read(&resolved).unwrap_err(),
            PathError::RaceDetected
        );
        assert!(
            root.open_read("data.bin").is_err(),
            "full path must also fail after the swap"
        );
    }

    #[test]
    fn write_stays_inside_overlay_root() {
        let temp = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
        let root = guard(&temp);
        let (file, resolved) = root
            .open_write("created.txt", true)
            .unwrap_or_else(|error| unreachable!("{error}"));
        drop(file);
        assert!(resolved.starts_with(root.root()));
        assert!(resolved.ends_with("created.txt"));
    }
}
