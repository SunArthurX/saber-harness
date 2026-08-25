//! SQLCipher-backed append-only events and transactional projections.

use std::collections::BTreeMap;
use std::error::Error;
use std::fmt::{Debug, Display, Formatter};
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use saber_core_protocol::RunState;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

mod encrypted_blob;
pub mod key_custody;

const ZERO_HASH: [u8; 32] = [0; 32];
const DATABASE_KEY_LENGTH: usize = 32;
const SCHEMA_VERSION: i64 = 2;

/// Secret database key whose bytes are erased on drop and never exposed through `Debug`.
pub struct DatabaseKey([u8; DATABASE_KEY_LENGTH]);

impl DatabaseKey {
    /// Wrap key bytes supplied by an OS credential store or enterprise KMS adapter.
    #[must_use]
    pub const fn new(bytes: [u8; DATABASE_KEY_LENGTH]) -> Self {
        Self(bytes)
    }

    fn random() -> Result<Self, StoreError> {
        let mut bytes = [0_u8; DATABASE_KEY_LENGTH];
        getrandom::fill(&mut bytes).map_err(|_| StoreError::KeyCustody)?;
        Ok(Self(bytes))
    }

    fn as_bytes(&self) -> &[u8; DATABASE_KEY_LENGTH] {
        &self.0
    }
}

impl Debug for DatabaseKey {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DatabaseKey([REDACTED])")
    }
}

impl Drop for DatabaseKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Boundary implemented by OS Keychain/Credential Manager/Secret Service adapters.
pub trait DatabaseKeyProvider {
    /// Load the per-workspace key without consulting argv, ordinary environment, logs or model context.
    ///
    /// # Errors
    ///
    /// Returns a custody error when the secure store cannot supply the key.
    fn load(&self, workspace_id: &str) -> Result<DatabaseKey, StoreError>;

    /// Load all keys that can recover an interrupted rotation, primary first.
    ///
    /// # Errors
    ///
    /// Returns a custody error when the secure store cannot supply a usable key.
    fn load_candidates(&self, workspace_id: &str) -> Result<Vec<DatabaseKey>, StoreError> {
        self.load(workspace_id).map(|key| vec![key])
    }
}

/// Writable extension used only for provisioning and crash-safe key rotation.
pub trait DatabaseKeyCustodian: DatabaseKeyProvider {
    /// Ensure a per-workspace key exists in native secure storage.
    ///
    /// # Errors
    ///
    /// Returns a custody error if secure storage is locked or unavailable.
    fn provision(&self, workspace_id: &str) -> Result<(), StoreError>;

    /// Persist a replacement as fallback while retaining the current primary key.
    ///
    /// # Errors
    ///
    /// Returns a custody error if the staged pair cannot be persisted durably.
    fn stage_rotation(
        &self,
        workspace_id: &str,
        current: &DatabaseKey,
    ) -> Result<DatabaseKey, StoreError>;

    /// Promote the replacement and remove rotation fallback material.
    ///
    /// # Errors
    ///
    /// Returns a custody error if the new primary cannot be persisted durably.
    fn commit_rotation(&self, workspace_id: &str, current: &DatabaseKey) -> Result<(), StoreError>;
}

/// Stable event-store failures.
#[derive(Debug)]
pub enum StoreError {
    /// `SQLCipher` or SQLite rejected an operation.
    Database(rusqlite::Error),
    /// A payload could not be encoded or decoded.
    Json(serde_json::Error),
    /// A durable blob filesystem operation failed.
    Io(std::io::Error),
    /// Secure key custody failed.
    KeyCustody,
    /// The `SQLCipher` codec was not active.
    CipherUnavailable,
    /// The required file-backed WAL journal mode could not be enabled.
    WalUnavailable,
    /// The encrypted database or authenticated pages failed integrity checks.
    IntegrityCheckFailed,
    /// The on-disk schema is newer than this executable understands.
    UnsupportedSchema,
    /// A command tried to cross the store's workspace boundary.
    WorkspaceMismatch,
    /// Authenticated encryption or secure randomness failed.
    Cryptography,
    /// Blob framing, metadata, authentication or content hash was inconsistent.
    BlobCorrupt,
    /// An outbox result did not match a pending intent.
    OutboxStateConflict,
    /// Replayed facts and the materialized Run projection differed.
    ProjectionMismatch,
    /// A Run transition violated the trusted state machine.
    InvalidTransition,
    /// Succeeded was requested without bound acceptance evidence.
    AcceptanceEvidenceRequired,
    /// An idempotency key was reused for different content.
    IdempotencyConflict,
    /// The append-only hash chain is inconsistent.
    HashChainBroken,
    /// A persisted state value was not recognized.
    InvalidPersistedState,
}

impl Display for StoreError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Database(_) => "database_error",
            Self::Json(_) => "json_error",
            Self::Io(_) => "io_error",
            Self::KeyCustody => "key_custody_error",
            Self::CipherUnavailable => "cipher_unavailable",
            Self::WalUnavailable => "wal_unavailable",
            Self::IntegrityCheckFailed => "integrity_check_failed",
            Self::UnsupportedSchema => "unsupported_schema",
            Self::WorkspaceMismatch => "workspace_mismatch",
            Self::Cryptography => "cryptography_error",
            Self::BlobCorrupt => "blob_corrupt",
            Self::OutboxStateConflict => "outbox_state_conflict",
            Self::ProjectionMismatch => "projection_mismatch",
            Self::InvalidTransition => "invalid_transition",
            Self::AcceptanceEvidenceRequired => "acceptance_evidence_required",
            Self::IdempotencyConflict => "idempotency_conflict",
            Self::HashChainBroken => "hash_chain_broken",
            Self::InvalidPersistedState => "invalid_persisted_state",
        })
    }
}

impl Error for StoreError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Database(value)
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl From<std::io::Error> for StoreError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

/// Whether a mutation was committed for the first time or replayed exactly.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommitOutcome {
    /// A new event and projection were committed.
    Committed {
        /// Identifier of the newly appended event.
        event_id: String,
    },
    /// The same idempotent request had already committed.
    Replayed {
        /// Identifier of the event committed by the original request.
        event_id: String,
    },
}

/// Input for one trusted Run state transition.
pub struct RunTransition<'a> {
    /// Unique event identifier.
    pub event_id: &'a str,
    /// Owning workspace identifier.
    pub workspace_id: &'a str,
    /// Run being transitioned.
    pub run_id: &'a str,
    /// Requested target state.
    pub target: &'a RunState,
    /// Bound verification artifact references, required for success.
    pub acceptance_evidence: &'a [String],
    /// Wall-clock occurrence time in Unix milliseconds.
    pub occurred_at_ms: u64,
    /// Mutation idempotency key.
    pub idempotency_key: &'a str,
}

/// Input for one immutable verification or execution artifact.
pub struct ArtifactCommit<'a> {
    /// Unique event identifier.
    pub event_id: &'a str,
    /// Owning workspace identifier.
    pub workspace_id: &'a str,
    /// Stable artifact identifier.
    pub artifact_id: &'a str,
    /// Run that produced the artifact.
    pub run_id: &'a str,
    /// MIME media type bound into authenticated metadata.
    pub media_type: &'a str,
    /// Data classification bound into authenticated metadata.
    pub classification: &'a str,
    /// Wall-clock occurrence time in Unix milliseconds.
    pub occurred_at_ms: u64,
    /// Mutation idempotency key.
    pub idempotency_key: &'a str,
}

/// Result of committing an artifact and its encrypted blob reference.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactOutcome {
    /// Event commit or exact replay outcome.
    pub commit: CommitOutcome,
    /// Canonical SHA-256 hash of plaintext inside the workspace trust boundary.
    pub content_hash: String,
}

/// Input for a durable external side-effect intent.
pub struct EffectIntent<'a> {
    /// Unique event identifier.
    pub event_id: &'a str,
    /// Owning workspace identifier.
    pub workspace_id: &'a str,
    /// Stable side-effect intent identifier.
    pub intent_id: &'a str,
    /// Tool or external effect kind.
    pub effect_kind: &'a str,
    /// Canonical effect request payload.
    pub payload: &'a Value,
    /// Wall-clock occurrence time in Unix milliseconds.
    pub occurred_at_ms: u64,
    /// Mutation idempotency key.
    pub idempotency_key: &'a str,
}

/// Terminal disposition for a durable external side effect.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EffectDisposition {
    /// Verification confirmed the intended effect.
    Completed,
    /// The effect was explicitly abandoned or compensated.
    Abandoned,
}

/// Input for an externally verified side-effect result.
pub struct EffectResult<'a> {
    /// Unique result event identifier.
    pub event_id: &'a str,
    /// Owning workspace identifier.
    pub workspace_id: &'a str,
    /// Intent being resolved.
    pub intent_id: &'a str,
    /// Verified result or compensation evidence.
    pub result: &'a Value,
    /// Terminal outbox disposition.
    pub disposition: EffectDisposition,
    /// Wall-clock occurrence time in Unix milliseconds.
    pub occurred_at_ms: u64,
    /// Mutation idempotency key.
    pub idempotency_key: &'a str,
}

/// Pending side effect surfaced during normal dispatch or crash recovery.
#[derive(Clone, Debug, PartialEq)]
pub struct PendingEffect {
    /// Stable intent identifier used for provider idempotency and reconciliation.
    pub intent_id: String,
    /// Tool or external effect kind.
    pub effect_kind: String,
    /// Canonical request payload.
    pub payload: Value,
    /// Number of recorded dispatch attempts.
    pub attempt_count: u64,
}

/// Result of deterministic startup recovery.
#[derive(Clone, Debug, PartialEq)]
pub struct RecoveryReport {
    /// Whether a divergent Run projection was rebuilt from authoritative events.
    pub projection_repaired: bool,
    /// Pending external effects requiring read-after-write reconciliation.
    pub pending_effects: Vec<PendingEffect>,
}

/// `SQLCipher` connection owning the authoritative local event log and projections.
pub struct EventStore {
    connection: Connection,
    workspace_id: String,
    database_key: DatabaseKey,
    blob_key: DatabaseKey,
    file_backed: bool,
}

impl EventStore {
    /// Provision a native secure-store key, then open and migrate a new or existing store.
    ///
    /// # Errors
    ///
    /// Fails closed when native key custody or encrypted database initialization fails.
    pub fn initialize(
        path: &Path,
        workspace_id: &str,
        custodian: &impl DatabaseKeyCustodian,
    ) -> Result<Self, StoreError> {
        custodian.provision(workspace_id)?;
        Self::open(path, workspace_id, custodian)
    }

    /// Open and migrate an encrypted per-workspace store.
    ///
    /// # Errors
    ///
    /// Fails closed when key custody, `SQLCipher` activation, migration or integrity setup fails.
    pub fn open(
        path: &Path,
        workspace_id: &str,
        provider: &impl DatabaseKeyProvider,
    ) -> Result<Self, StoreError> {
        let candidates = provider.load_candidates(workspace_id)?;
        if candidates.is_empty() {
            return Err(StoreError::KeyCustody);
        }
        let mut last_error = None;
        for key in candidates {
            let connection = Connection::open(path)?;
            match Self::configure(connection, key, workspace_id, true) {
                Ok(store) => return Ok(store),
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.unwrap_or(StoreError::KeyCustody))
    }

    fn configure(
        connection: Connection,
        key: DatabaseKey,
        workspace_id: &str,
        require_wal: bool,
    ) -> Result<Self, StoreError> {
        apply_key_pragma(&connection, "key", &key)?;

        let cipher_version: Option<String> = connection
            .query_row("PRAGMA cipher_version", [], |row| row.get(0))
            .optional()?;
        if cipher_version.as_deref().is_none_or(str::is_empty) {
            return Err(StoreError::CipherUnavailable);
        }

        // A codec version alone does not prove that this key can read an existing file.
        connection.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "secure_delete", "ON")?;
        connection.pragma_update(None, "temp_store", "MEMORY")?;
        connection.busy_timeout(Duration::from_secs(5))?;
        if require_wal {
            let journal_mode: String =
                connection.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
            if !journal_mode.eq_ignore_ascii_case("wal") {
                return Err(StoreError::WalUnavailable);
            }
        }
        migrate(&connection)?;
        let blob_key = load_or_create_blob_key(&connection)?;
        let store = Self {
            connection,
            workspace_id: workspace_id.to_owned(),
            database_key: key,
            blob_key,
            file_backed: require_wal,
        };
        store.verify_database_integrity()?;
        store.verify_hash_chain()?;
        Ok(store)
    }

    /// Rotate the `SQLCipher` key with a staged secure-store fallback.
    ///
    /// If the process stops between staging and promotion, the next open tries both
    /// candidates. Blob content keys remain independently stored inside `SQLCipher`.
    ///
    /// # Errors
    ///
    /// Returns a custody, database or integrity error while leaving a recoverable key pair.
    pub fn rotate_database_key(
        &mut self,
        custodian: &impl DatabaseKeyCustodian,
    ) -> Result<(), StoreError> {
        let next = custodian.stage_rotation(&self.workspace_id, &self.database_key)?;
        if self.file_backed {
            let (busy, _log_frames, _checkpointed): (i64, i64, i64) =
                self.connection
                    .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })?;
            if busy != 0 {
                return Err(StoreError::WalUnavailable);
            }
            let rollback_mode: String =
                self.connection
                    .query_row("PRAGMA journal_mode=DELETE", [], |row| row.get(0))?;
            if !rollback_mode.eq_ignore_ascii_case("delete") {
                return Err(StoreError::WalUnavailable);
            }
        }
        apply_key_pragma(&self.connection, "rekey", &next)?;
        if self.file_backed {
            let journal_mode: String =
                self.connection
                    .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
            if !journal_mode.eq_ignore_ascii_case("wal") {
                return Err(StoreError::WalUnavailable);
            }
        }
        self.verify_database_integrity()?;
        custodian.commit_rotation(&self.workspace_id, &next)?;
        self.database_key = next;
        Ok(())
    }

    /// Run `SQLCipher` page authentication and SQLite structural integrity checks.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::IntegrityCheckFailed`] if either checker reports a problem.
    pub fn verify_database_integrity(&self) -> Result<(), StoreError> {
        if self.file_backed {
            let mut cipher = self.connection.prepare("PRAGMA cipher_integrity_check")?;
            let cipher_problems = cipher.query_map([], |row| row.get::<_, String>(0))?;
            for problem in cipher_problems {
                if !problem?.eq_ignore_ascii_case("ok") {
                    return Err(StoreError::IntegrityCheckFailed);
                }
            }
        }
        let sqlite: String = self
            .connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        if !sqlite.eq_ignore_ascii_case("ok") {
            return Err(StoreError::IntegrityCheckFailed);
        }
        Ok(())
    }

    fn ensure_workspace(&self, workspace_id: &str) -> Result<(), StoreError> {
        if workspace_id == self.workspace_id {
            Ok(())
        } else {
            Err(StoreError::WorkspaceMismatch)
        }
    }

    fn update_run_checkpoint(
        transaction: &Transaction<'_>,
        sequence: i64,
    ) -> Result<(), StoreError> {
        transaction.execute(
            "INSERT INTO projections(projection_name, version, last_sequence) VALUES ('runs', 1, ?1)
             ON CONFLICT(projection_name) DO UPDATE SET version = excluded.version, last_sequence = excluded.last_sequence",
            [sequence],
        )?;
        Ok(())
    }

    /// Create a queued Run while appending its causal event in the same transaction.
    ///
    /// # Errors
    ///
    /// Returns a database or idempotency error without leaving a partial event.
    pub fn create_run(
        &mut self,
        event_id: &str,
        workspace_id: &str,
        run_id: &str,
        task_id: &str,
        occurred_at_ms: u64,
        idempotency_key: &str,
    ) -> Result<CommitOutcome, StoreError> {
        self.ensure_workspace(workspace_id)?;
        let payload = json!({"run_id": run_id, "task_id": task_id, "state": "queued"});
        let request_hash = digest(&[b"create", run_id.as_bytes(), task_id.as_bytes()]);
        let transaction = self.connection.transaction()?;
        if let Some(outcome) = replay(&transaction, idempotency_key, &request_hash)? {
            return Ok(outcome);
        }
        let sequence = append_event(
            &transaction,
            event_id,
            workspace_id,
            "run.queued",
            occurred_at_ms,
            &payload,
        )?;
        transaction.execute(
            "INSERT INTO runs(run_id, task_id, state, updated_sequence) VALUES (?1, ?2, 'queued', ?3)",
            params![run_id, task_id, sequence],
        )?;
        Self::update_run_checkpoint(&transaction, sequence)?;
        record_idempotency(&transaction, idempotency_key, &request_hash, event_id)?;
        transaction.commit()?;
        Ok(CommitOutcome::Committed {
            event_id: event_id.to_owned(),
        })
    }

    /// Transition a Run and append its event transactionally.
    ///
    /// # Errors
    ///
    /// Rejects illegal or unverified success transitions and conflicting idempotency keys.
    pub fn transition_run(
        &mut self,
        command: &RunTransition<'_>,
    ) -> Result<CommitOutcome, StoreError> {
        self.ensure_workspace(command.workspace_id)?;
        let target_name = state_name(command.target);
        let evidence_json = serde_json::to_string(command.acceptance_evidence)?;
        let request_hash = digest(&[
            b"transition",
            command.run_id.as_bytes(),
            target_name.as_bytes(),
            evidence_json.as_bytes(),
        ]);
        let transaction = self.connection.transaction()?;
        if let Some(outcome) = replay(&transaction, command.idempotency_key, &request_hash)? {
            return Ok(outcome);
        }
        let current_name: String = transaction.query_row(
            "SELECT state FROM runs WHERE run_id = ?1",
            [command.run_id],
            |row| row.get(0),
        )?;
        let current = parse_state(&current_name)?;
        if !valid_transition(&current, command.target) {
            return Err(StoreError::InvalidTransition);
        }
        if matches!(command.target, RunState::Succeeded) && command.acceptance_evidence.is_empty() {
            return Err(StoreError::AcceptanceEvidenceRequired);
        }
        let payload = json!({
            "acceptance_evidence": command.acceptance_evidence,
            "from": current_name,
            "run_id": command.run_id,
            "to": target_name
        });
        let sequence = append_event(
            &transaction,
            command.event_id,
            command.workspace_id,
            "run.state_changed",
            command.occurred_at_ms,
            &payload,
        )?;
        transaction.execute(
            "UPDATE runs SET state = ?1, acceptance_evidence_json = ?2, updated_sequence = ?3 WHERE run_id = ?4",
            params![target_name, evidence_json, sequence, command.run_id],
        )?;
        Self::update_run_checkpoint(&transaction, sequence)?;
        record_idempotency(
            &transaction,
            command.idempotency_key,
            &request_hash,
            command.event_id,
        )?;
        transaction.commit()?;
        Ok(CommitOutcome::Committed {
            event_id: command.event_id.to_owned(),
        })
    }

    /// Encrypt a content-addressed blob, then atomically commit its artifact fact and projection.
    ///
    /// The file is fsynced and atomically published before the SQL transaction. A crash in that
    /// narrow window can leave only an unreachable encrypted object, never a dangling SQL fact.
    ///
    /// # Errors
    ///
    /// Rejects cross-workspace writes, metadata conflicts, blob corruption and non-idempotent replay.
    pub fn commit_artifact(
        &mut self,
        blob_root: &Path,
        command: &ArtifactCommit<'_>,
        plaintext: &[u8],
    ) -> Result<ArtifactOutcome, StoreError> {
        self.ensure_workspace(command.workspace_id)?;
        if command.media_type.is_empty() || command.classification.is_empty() {
            return Err(StoreError::BlobCorrupt);
        }
        let blob = encrypted_blob::write(
            blob_root,
            &self.workspace_id,
            self.blob_key.as_bytes(),
            command.media_type,
            command.classification,
            plaintext,
        )?;
        let request_hash = digest(&[
            b"artifact",
            command.artifact_id.as_bytes(),
            command.run_id.as_bytes(),
            command.media_type.as_bytes(),
            command.classification.as_bytes(),
            blob.content_hash.as_bytes(),
        ]);
        let transaction = self.connection.transaction()?;
        if let Some(commit) = replay(&transaction, command.idempotency_key, &request_hash)? {
            return Ok(ArtifactOutcome {
                commit,
                content_hash: blob.content_hash,
            });
        }
        insert_artifact_fact(&transaction, command, &blob)?;
        record_idempotency(
            &transaction,
            command.idempotency_key,
            &request_hash,
            command.event_id,
        )?;
        transaction.commit()?;
        Ok(ArtifactOutcome {
            commit: CommitOutcome::Committed {
                event_id: command.event_id.to_owned(),
            },
            content_hash: blob.content_hash,
        })
    }

    /// Decrypt and verify an artifact against both SQL metadata and authenticated blob metadata.
    ///
    /// # Errors
    ///
    /// Returns a database, I/O or corruption error; unauthenticated plaintext is never returned.
    pub fn read_artifact(
        &self,
        blob_root: &Path,
        artifact_id: &str,
    ) -> Result<Vec<u8>, StoreError> {
        let metadata: (String, String, i64, String, String, String) = self.connection.query_row(
            "SELECT b.encrypted_path, b.content_hash, b.byte_length, b.media_type, b.classification, b.ciphertext_hash
             FROM artifacts a JOIN blobs b ON b.content_hash = a.content_hash
             WHERE a.artifact_id = ?1",
            [artifact_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )?;
        let byte_length = u64::try_from(metadata.2).map_err(|_| StoreError::BlobCorrupt)?;
        encrypted_blob::read(&encrypted_blob::ReadRequest {
            root: blob_root,
            relative_path: &metadata.0,
            workspace_id: &self.workspace_id,
            key_bytes: self.blob_key.as_bytes(),
            media_type: &metadata.3,
            classification: &metadata.4,
            expected_content_hash: &metadata.1,
            expected_ciphertext_hash: &metadata.5,
            byte_length,
        })
    }

    /// Append an effect intent and its pending outbox projection in one transaction.
    ///
    /// # Errors
    ///
    /// Rejects cross-workspace commands and conflicting idempotency keys.
    pub fn record_effect_intent(
        &mut self,
        command: &EffectIntent<'_>,
    ) -> Result<CommitOutcome, StoreError> {
        self.ensure_workspace(command.workspace_id)?;
        let payload_json = serde_json::to_string(command.payload)?;
        let request_hash = digest(&[
            b"effect-intent",
            command.intent_id.as_bytes(),
            command.effect_kind.as_bytes(),
            payload_json.as_bytes(),
        ]);
        let transaction = self.connection.transaction()?;
        if let Some(outcome) = replay(&transaction, command.idempotency_key, &request_hash)? {
            return Ok(outcome);
        }
        let event_payload = json!({
            "effect_kind": command.effect_kind,
            "intent_id": command.intent_id,
            "payload": command.payload
        });
        append_event(
            &transaction,
            command.event_id,
            command.workspace_id,
            "tool.intent_recorded",
            command.occurred_at_ms,
            &event_payload,
        )?;
        transaction.execute(
            "INSERT INTO outbox(intent_id, event_id, effect_kind, payload_json, state)
             VALUES (?1, ?2, ?3, ?4, 'pending')",
            params![
                command.intent_id,
                command.event_id,
                command.effect_kind,
                payload_json
            ],
        )?;
        record_idempotency(
            &transaction,
            command.idempotency_key,
            &request_hash,
            command.event_id,
        )?;
        transaction.commit()?;
        Ok(CommitOutcome::Committed {
            event_id: command.event_id.to_owned(),
        })
    }

    /// Append verified effect evidence and resolve its outbox row in one transaction.
    ///
    /// # Errors
    ///
    /// Rejects results without a pending intent and conflicting idempotency keys.
    pub fn record_effect_result(
        &mut self,
        command: &EffectResult<'_>,
    ) -> Result<CommitOutcome, StoreError> {
        self.ensure_workspace(command.workspace_id)?;
        let result_json = serde_json::to_string(command.result)?;
        let state = match command.disposition {
            EffectDisposition::Completed => "completed",
            EffectDisposition::Abandoned => "abandoned",
        };
        let request_hash = digest(&[
            b"effect-result",
            command.intent_id.as_bytes(),
            state.as_bytes(),
            result_json.as_bytes(),
        ]);
        let transaction = self.connection.transaction()?;
        if let Some(outcome) = replay(&transaction, command.idempotency_key, &request_hash)? {
            return Ok(outcome);
        }
        let event_payload = json!({
            "disposition": state,
            "intent_id": command.intent_id,
            "result": command.result
        });
        append_event(
            &transaction,
            command.event_id,
            command.workspace_id,
            "tool.result_recorded",
            command.occurred_at_ms,
            &event_payload,
        )?;
        let changed = transaction.execute(
            "UPDATE outbox SET state = ?1, result_event_id = ?2, result_json = ?3
             WHERE intent_id = ?4 AND state = 'pending'",
            params![state, command.event_id, result_json, command.intent_id],
        )?;
        if changed != 1 {
            return Err(StoreError::OutboxStateConflict);
        }
        record_idempotency(
            &transaction,
            command.idempotency_key,
            &request_hash,
            command.event_id,
        )?;
        transaction.commit()?;
        Ok(CommitOutcome::Committed {
            event_id: command.event_id.to_owned(),
        })
    }

    /// List pending effects for read-after-write verification after startup or provider failure.
    ///
    /// # Errors
    ///
    /// Returns a database or JSON error if persisted outbox data is invalid.
    pub fn pending_effects(&self) -> Result<Vec<PendingEffect>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT intent_id, effect_kind, payload_json, attempt_count
             FROM outbox WHERE state = 'pending' ORDER BY rowid",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?;
        let mut pending = Vec::new();
        for row in rows {
            let (intent_id, effect_kind, payload_json, attempt_count) = row?;
            pending.push(PendingEffect {
                intent_id,
                effect_kind,
                payload: serde_json::from_str(&payload_json)?,
                attempt_count: u64::try_from(attempt_count)
                    .map_err(|_| StoreError::InvalidPersistedState)?,
            });
        }
        Ok(pending)
    }

    /// Read the current Run projection.
    ///
    /// # Errors
    ///
    /// Returns a database or persisted-state error.
    pub fn run_state(&self, run_id: &str) -> Result<Option<RunState>, StoreError> {
        let value: Option<String> = self
            .connection
            .query_row(
                "SELECT state FROM runs WHERE run_id = ?1",
                [run_id],
                |row| row.get(0),
            )
            .optional()?;
        value.map(|state| parse_state(&state)).transpose()
    }

    /// Verify that replaying authoritative Run events exactly matches the materialized projection.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::ProjectionMismatch`] for divergence or a decoding error for poison facts.
    pub fn verify_run_projection(&self) -> Result<(), StoreError> {
        let (expected, _) = replayed_runs(&self.connection, &self.workspace_id)?;
        let actual = persisted_runs(&self.connection)?;
        if expected == actual {
            Ok(())
        } else {
            Err(StoreError::ProjectionMismatch)
        }
    }

    /// Rebuild the Run projection transactionally from the append-only event log.
    ///
    /// # Errors
    ///
    /// Fails without replacing the current projection if replay encounters an invalid fact.
    pub fn rebuild_run_projection(&mut self) -> Result<(), StoreError> {
        self.verify_hash_chain()?;
        let (expected, last_sequence) = replayed_runs(&self.connection, &self.workspace_id)?;
        let transaction = self.connection.transaction()?;
        transaction.execute_batch(
            "CREATE TEMP TABLE rebuilt_runs (
               run_id TEXT PRIMARY KEY,
               task_id TEXT NOT NULL,
               state TEXT NOT NULL,
               acceptance_evidence_json TEXT NOT NULL,
               updated_sequence INTEGER NOT NULL
             );",
        )?;
        for (run_id, projection) in expected {
            transaction.execute(
                "INSERT INTO rebuilt_runs(run_id, task_id, state, acceptance_evidence_json, updated_sequence)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    run_id,
                    projection.task_id,
                    projection.state,
                    projection.acceptance_evidence_json,
                    projection.updated_sequence
                ],
            )?;
        }
        transaction.execute(
            "DELETE FROM runs WHERE run_id NOT IN (SELECT run_id FROM rebuilt_runs)",
            [],
        )?;
        transaction.execute_batch(
            "INSERT INTO runs(run_id, task_id, state, acceptance_evidence_json, updated_sequence)
             SELECT run_id, task_id, state, acceptance_evidence_json, updated_sequence
             FROM rebuilt_runs WHERE true
             ON CONFLICT(run_id) DO UPDATE SET
               task_id = excluded.task_id,
               state = excluded.state,
               acceptance_evidence_json = excluded.acceptance_evidence_json,
               updated_sequence = excluded.updated_sequence;
             DROP TABLE rebuilt_runs;",
        )?;
        Self::update_run_checkpoint(&transaction, last_sequence)?;
        transaction.commit()?;
        Ok(())
    }

    /// Verify durable facts, repair projection drift and surface unresolved side effects.
    ///
    /// # Errors
    ///
    /// Fails closed on database, hash-chain or poison-event corruption.
    pub fn recover(&mut self) -> Result<RecoveryReport, StoreError> {
        self.verify_database_integrity()?;
        self.verify_hash_chain()?;
        let projection_repaired = match self.verify_run_projection() {
            Ok(()) => false,
            Err(StoreError::ProjectionMismatch) => true,
            Err(error) => return Err(error),
        };
        if projection_repaired {
            self.rebuild_run_projection()?;
            self.verify_run_projection()?;
        }
        Ok(RecoveryReport {
            projection_repaired,
            pending_effects: self.pending_effects()?,
        })
    }

    /// Verify every event hash and predecessor link from genesis to tail.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::HashChainBroken`] on any mismatch.
    pub fn verify_hash_chain(&self) -> Result<(), StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT event_id, workspace_id, event_type, occurred_at_ms, payload_json, previous_hash, event_hash
             FROM events ORDER BY sequence",
        )?;
        let mut rows = statement.query([])?;
        let mut previous = ZERO_HASH.to_vec();
        while let Some(row) = rows.next()? {
            let stored_previous: Vec<u8> = row.get(5)?;
            if stored_previous != previous {
                return Err(StoreError::HashChainBroken);
            }
            let occurred: i64 = row.get(3)?;
            let calculated = event_digest(
                &previous,
                &row.get::<_, String>(0)?,
                &row.get::<_, String>(1)?,
                &row.get::<_, String>(2)?,
                occurred,
                &row.get::<_, String>(4)?,
            );
            let stored: Vec<u8> = row.get(6)?;
            if stored != calculated {
                return Err(StoreError::HashChainBroken);
            }
            previous = stored;
        }
        Ok(())
    }

    #[cfg(test)]
    fn event_count(&self) -> Result<i64, StoreError> {
        Ok(self
            .connection
            .query_row("SELECT count(*) FROM events", [], |row| row.get(0))?)
    }
}

fn apply_key_pragma(
    connection: &Connection,
    pragma: &str,
    key: &DatabaseKey,
) -> Result<(), StoreError> {
    let mut encoded = String::with_capacity(DATABASE_KEY_LENGTH * 2 + 3);
    encoded.push_str("x'");
    for byte in key.as_bytes() {
        use std::fmt::Write as _;
        write!(encoded, "{byte:02x}").map_err(|_| StoreError::KeyCustody)?;
    }
    encoded.push('\'');
    let result = connection.pragma_update(None, pragma, &encoded);
    encoded.zeroize();
    result.map_err(StoreError::Database)
}

fn migrate(connection: &Connection) -> Result<(), StoreError> {
    let mut version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(StoreError::UnsupportedSchema);
    }
    if version == 0 {
        migrate_to_v1(connection)?;
        version = 1;
    }
    if version == 1 {
        migrate_to_v2(connection)?;
    }
    Ok(())
}

fn migrate_to_v1(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(
        "BEGIN IMMEDIATE;
             CREATE TABLE IF NOT EXISTS events (
               sequence INTEGER PRIMARY KEY AUTOINCREMENT,
               event_id TEXT NOT NULL UNIQUE,
               workspace_id TEXT NOT NULL,
               event_type TEXT NOT NULL,
               occurred_at_ms INTEGER NOT NULL,
               payload_json TEXT NOT NULL,
               previous_hash BLOB NOT NULL CHECK(length(previous_hash) = 32),
               event_hash BLOB NOT NULL UNIQUE CHECK(length(event_hash) = 32)
             );
             CREATE TABLE IF NOT EXISTS runs (
               run_id TEXT PRIMARY KEY,
               task_id TEXT NOT NULL,
               state TEXT NOT NULL,
               acceptance_evidence_json TEXT NOT NULL DEFAULT '[]',
               updated_sequence INTEGER NOT NULL REFERENCES events(sequence)
             );
             CREATE TABLE IF NOT EXISTS projections (
               projection_name TEXT PRIMARY KEY,
               version INTEGER NOT NULL,
               last_sequence INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS outbox (
               intent_id TEXT PRIMARY KEY,
               event_id TEXT NOT NULL REFERENCES events(event_id),
               effect_kind TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               state TEXT NOT NULL CHECK(state IN ('pending','completed','abandoned'))
             );
             CREATE TABLE IF NOT EXISTS idempotency_keys (
               idempotency_key TEXT PRIMARY KEY,
               request_hash BLOB NOT NULL CHECK(length(request_hash) = 32),
               event_id TEXT NOT NULL REFERENCES events(event_id)
             );
             CREATE TABLE IF NOT EXISTS artifacts (
               artifact_id TEXT PRIMARY KEY,
               run_id TEXT NOT NULL REFERENCES runs(run_id),
               media_type TEXT NOT NULL,
               content_hash TEXT NOT NULL,
               created_sequence INTEGER NOT NULL REFERENCES events(sequence)
             );
             CREATE TABLE IF NOT EXISTS blobs (
               content_hash TEXT PRIMARY KEY,
               encrypted_path TEXT NOT NULL,
               byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
               created_sequence INTEGER NOT NULL REFERENCES events(sequence)
             );
             PRAGMA user_version = 1;
             COMMIT;",
    )?;
    Ok(())
}

fn migrate_to_v2(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(
        "BEGIN IMMEDIATE;
             ALTER TABLE artifacts ADD COLUMN classification TEXT NOT NULL DEFAULT 'internal';
             ALTER TABLE blobs ADD COLUMN media_type TEXT NOT NULL DEFAULT 'application/octet-stream';
             ALTER TABLE blobs ADD COLUMN classification TEXT NOT NULL DEFAULT 'internal';
             ALTER TABLE blobs ADD COLUMN key_epoch INTEGER NOT NULL DEFAULT 1 CHECK(key_epoch > 0);
             ALTER TABLE blobs ADD COLUMN ciphertext_hash TEXT NOT NULL DEFAULT '';
             ALTER TABLE outbox ADD COLUMN result_event_id TEXT REFERENCES events(event_id);
             ALTER TABLE outbox ADD COLUMN result_json TEXT;
             ALTER TABLE outbox ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0);
             CREATE TABLE store_metadata (
               metadata_key TEXT PRIMARY KEY,
               value BLOB NOT NULL
             );
             PRAGMA user_version = 2;
             COMMIT;",
    )?;
    Ok(())
}

fn load_or_create_blob_key(connection: &Connection) -> Result<DatabaseKey, StoreError> {
    let existing: Option<Vec<u8>> = connection
        .query_row(
            "SELECT value FROM store_metadata WHERE metadata_key = 'blob_master_key_v1'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(mut bytes) = existing {
        if bytes.len() != DATABASE_KEY_LENGTH {
            bytes.zeroize();
            return Err(StoreError::BlobCorrupt);
        }
        let mut key = [0_u8; DATABASE_KEY_LENGTH];
        key.copy_from_slice(&bytes);
        bytes.zeroize();
        return Ok(DatabaseKey::new(key));
    }
    let key = DatabaseKey::random().map_err(|_| StoreError::Cryptography)?;
    connection.execute(
        "INSERT INTO store_metadata(metadata_key, value) VALUES ('blob_master_key_v1', ?1)",
        [key.as_bytes().as_slice()],
    )?;
    Ok(key)
}

fn insert_artifact_fact(
    transaction: &Transaction<'_>,
    command: &ArtifactCommit<'_>,
    blob: &encrypted_blob::BlobMetadata,
) -> Result<(), StoreError> {
    let payload = json!({
        "artifact_id": command.artifact_id,
        "byte_length": blob.byte_length,
        "classification": command.classification,
        "content_hash": blob.content_hash,
        "media_type": command.media_type,
        "run_id": command.run_id
    });
    let sequence = append_event(
        transaction,
        command.event_id,
        command.workspace_id,
        "artifact.committed",
        command.occurred_at_ms,
        &payload,
    )?;
    let expected_length = i64::try_from(blob.byte_length).map_err(|_| StoreError::BlobCorrupt)?;
    transaction.execute(
        "INSERT INTO blobs(content_hash, encrypted_path, byte_length, created_sequence, media_type, classification, key_epoch, ciphertext_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
         ON CONFLICT(content_hash) DO NOTHING",
        params![
            blob.content_hash,
            blob.relative_path,
            expected_length,
            sequence,
            command.media_type,
            command.classification,
            blob.ciphertext_hash
        ],
    )?;
    let persisted: (String, i64, String, String, String) = transaction.query_row(
        "SELECT encrypted_path, byte_length, media_type, classification, ciphertext_hash
         FROM blobs WHERE content_hash = ?1",
        [&blob.content_hash],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )?;
    if persisted
        != (
            blob.relative_path.clone(),
            expected_length,
            command.media_type.to_owned(),
            command.classification.to_owned(),
            blob.ciphertext_hash.clone(),
        )
    {
        return Err(StoreError::BlobCorrupt);
    }
    transaction.execute(
        "INSERT INTO artifacts(artifact_id, run_id, media_type, content_hash, created_sequence, classification)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            command.artifact_id,
            command.run_id,
            command.media_type,
            blob.content_hash,
            sequence,
            command.classification
        ],
    )?;
    Ok(())
}

fn append_event(
    transaction: &Transaction<'_>,
    event_id: &str,
    workspace_id: &str,
    event_type: &str,
    occurred_at_ms: u64,
    payload: &Value,
) -> Result<i64, StoreError> {
    let payload_json = serde_json::to_string(payload)?;
    let previous: Vec<u8> = transaction
        .query_row(
            "SELECT event_hash FROM events ORDER BY sequence DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| ZERO_HASH.to_vec());
    let occurred = i64::try_from(occurred_at_ms).map_err(|_| StoreError::InvalidTransition)?;
    let hash = event_digest(
        &previous,
        event_id,
        workspace_id,
        event_type,
        occurred,
        &payload_json,
    );
    transaction.execute(
        "INSERT INTO events(event_id, workspace_id, event_type, occurred_at_ms, payload_json, previous_hash, event_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![event_id, workspace_id, event_type, occurred, payload_json, previous, hash],
    )?;
    Ok(transaction.last_insert_rowid())
}

fn replay(
    transaction: &Transaction<'_>,
    key: &str,
    request_hash: &[u8],
) -> Result<Option<CommitOutcome>, StoreError> {
    let previous: Option<(Vec<u8>, String)> = transaction
        .query_row(
            "SELECT request_hash, event_id FROM idempotency_keys WHERE idempotency_key = ?1",
            [key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match previous {
        Some((hash, event_id)) if hash == request_hash => {
            Ok(Some(CommitOutcome::Replayed { event_id }))
        }
        Some(_) => Err(StoreError::IdempotencyConflict),
        None => Ok(None),
    }
}

fn record_idempotency(
    transaction: &Transaction<'_>,
    key: &str,
    request_hash: &[u8],
    event_id: &str,
) -> Result<(), StoreError> {
    transaction.execute(
        "INSERT INTO idempotency_keys(idempotency_key, request_hash, event_id) VALUES (?1, ?2, ?3)",
        params![key, request_hash, event_id],
    )?;
    Ok(())
}

fn digest(parts: &[&[u8]]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    hasher.finalize().to_vec()
}

fn event_digest(
    previous: &[u8],
    event_id: &str,
    workspace_id: &str,
    event_type: &str,
    occurred_at_ms: i64,
    payload_json: &str,
) -> Vec<u8> {
    digest(&[
        previous,
        event_id.as_bytes(),
        workspace_id.as_bytes(),
        event_type.as_bytes(),
        &occurred_at_ms.to_be_bytes(),
        payload_json.as_bytes(),
    ])
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RunProjection {
    task_id: String,
    state: String,
    acceptance_evidence_json: String,
    updated_sequence: i64,
}

fn replayed_runs(
    connection: &Connection,
    workspace_id: &str,
) -> Result<(BTreeMap<String, RunProjection>, i64), StoreError> {
    let mut statement = connection.prepare(
        "SELECT sequence, workspace_id, event_type, payload_json FROM events ORDER BY sequence",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let mut projections = BTreeMap::new();
    let mut last_sequence = 0;
    for row in rows {
        let (sequence, event_workspace, event_type, payload_json) = row?;
        last_sequence = sequence;
        if event_workspace != workspace_id {
            return Err(StoreError::ProjectionMismatch);
        }
        let payload: Value = serde_json::from_str(&payload_json)?;
        match event_type.as_str() {
            "run.queued" => {
                let run_id = required_string(&payload, "run_id")?;
                let task_id = required_string(&payload, "task_id")?;
                if required_string(&payload, "state")? != "queued"
                    || projections
                        .insert(
                            run_id,
                            RunProjection {
                                task_id,
                                state: "queued".to_owned(),
                                acceptance_evidence_json: "[]".to_owned(),
                                updated_sequence: sequence,
                            },
                        )
                        .is_some()
                {
                    return Err(StoreError::ProjectionMismatch);
                }
            }
            "run.state_changed" => {
                let run_id = required_string(&payload, "run_id")?;
                let from = required_string(&payload, "from")?;
                let target = required_string(&payload, "to")?;
                let evidence = required_string_array(&payload, "acceptance_evidence")?;
                let projection = projections
                    .get_mut(&run_id)
                    .ok_or(StoreError::ProjectionMismatch)?;
                let current = parse_state(&projection.state)?;
                let target_state = parse_state(&target)?;
                if projection.state != from
                    || !valid_transition(&current, &target_state)
                    || (matches!(target_state, RunState::Succeeded) && evidence.is_empty())
                {
                    return Err(StoreError::ProjectionMismatch);
                }
                projection.state = target;
                projection.acceptance_evidence_json = serde_json::to_string(&evidence)?;
                projection.updated_sequence = sequence;
            }
            _ => {}
        }
    }
    Ok((projections, last_sequence))
}

fn persisted_runs(connection: &Connection) -> Result<BTreeMap<String, RunProjection>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT run_id, task_id, state, acceptance_evidence_json, updated_sequence
         FROM runs ORDER BY run_id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            RunProjection {
                task_id: row.get(1)?,
                state: row.get(2)?,
                acceptance_evidence_json: row.get(3)?,
                updated_sequence: row.get(4)?,
            },
        ))
    })?;
    let mut projections = BTreeMap::new();
    for row in rows {
        let (run_id, projection) = row?;
        if projections.insert(run_id, projection).is_some() {
            return Err(StoreError::ProjectionMismatch);
        }
    }
    Ok(projections)
}

fn required_string(payload: &Value, field: &str) -> Result<String, StoreError> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or(StoreError::ProjectionMismatch)
}

fn required_string_array(payload: &Value, field: &str) -> Result<Vec<String>, StoreError> {
    payload
        .get(field)
        .and_then(Value::as_array)
        .ok_or(StoreError::ProjectionMismatch)?
        .iter()
        .map(|value| {
            value
                .as_str()
                .filter(|text| !text.is_empty())
                .map(str::to_owned)
                .ok_or(StoreError::ProjectionMismatch)
        })
        .collect()
}

fn state_name(state: &RunState) -> &'static str {
    match state {
        RunState::Queued => "queued",
        RunState::Running => "running",
        RunState::Blocked => "blocked",
        RunState::Succeeded => "succeeded",
        RunState::Failed => "failed",
        RunState::Cancelled => "cancelled",
    }
}

fn parse_state(value: &str) -> Result<RunState, StoreError> {
    match value {
        "queued" => Ok(RunState::Queued),
        "running" => Ok(RunState::Running),
        "blocked" => Ok(RunState::Blocked),
        "succeeded" => Ok(RunState::Succeeded),
        "failed" => Ok(RunState::Failed),
        "cancelled" => Ok(RunState::Cancelled),
        _ => Err(StoreError::InvalidPersistedState),
    }
}

fn valid_transition(current: &RunState, target: &RunState) -> bool {
    matches!(
        (current, target),
        (RunState::Queued, RunState::Running | RunState::Cancelled)
            | (
                RunState::Running,
                RunState::Blocked | RunState::Succeeded | RunState::Failed | RunState::Cancelled
            )
            | (
                RunState::Blocked,
                RunState::Running | RunState::Failed | RunState::Cancelled
            )
    )
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, Instant};

    use super::*;
    use rusqlite::TransactionBehavior;

    struct TestKeys;

    impl DatabaseKeyProvider for TestKeys {
        fn load(&self, _workspace_id: &str) -> Result<DatabaseKey, StoreError> {
            Ok(DatabaseKey::new([7; DATABASE_KEY_LENGTH]))
        }
    }

    struct StaticKeys([u8; DATABASE_KEY_LENGTH]);

    impl DatabaseKeyProvider for StaticKeys {
        fn load(&self, _workspace_id: &str) -> Result<DatabaseKey, StoreError> {
            Ok(DatabaseKey::new(self.0))
        }
    }

    struct MemoryCustodian {
        primary: RefCell<[u8; DATABASE_KEY_LENGTH]>,
        fallback: RefCell<Option<[u8; DATABASE_KEY_LENGTH]>>,
        fail_commit: Cell<bool>,
    }

    impl MemoryCustodian {
        fn new(primary: [u8; DATABASE_KEY_LENGTH]) -> Self {
            Self {
                primary: RefCell::new(primary),
                fallback: RefCell::new(None),
                fail_commit: Cell::new(false),
            }
        }
    }

    impl DatabaseKeyProvider for MemoryCustodian {
        fn load(&self, _workspace_id: &str) -> Result<DatabaseKey, StoreError> {
            Ok(DatabaseKey::new(*self.primary.borrow()))
        }

        fn load_candidates(&self, _workspace_id: &str) -> Result<Vec<DatabaseKey>, StoreError> {
            let mut keys = vec![DatabaseKey::new(*self.primary.borrow())];
            if let Some(fallback) = *self.fallback.borrow() {
                keys.push(DatabaseKey::new(fallback));
            }
            Ok(keys)
        }
    }

    impl DatabaseKeyCustodian for MemoryCustodian {
        fn provision(&self, _workspace_id: &str) -> Result<(), StoreError> {
            Ok(())
        }

        fn stage_rotation(
            &self,
            _workspace_id: &str,
            current: &DatabaseKey,
        ) -> Result<DatabaseKey, StoreError> {
            if current.as_bytes() != &*self.primary.borrow() {
                return Err(StoreError::KeyCustody);
            }
            let next = [9_u8; DATABASE_KEY_LENGTH];
            *self.fallback.borrow_mut() = Some(next);
            Ok(DatabaseKey::new(next))
        }

        fn commit_rotation(
            &self,
            _workspace_id: &str,
            current: &DatabaseKey,
        ) -> Result<(), StoreError> {
            if self.fail_commit.get() {
                return Err(StoreError::KeyCustody);
            }
            *self.primary.borrow_mut() = *current.as_bytes();
            *self.fallback.borrow_mut() = None;
            Ok(())
        }
    }

    fn store() -> Result<EventStore, StoreError> {
        let key = TestKeys.load("ws_01")?;
        EventStore::configure(Connection::open_in_memory()?, key, "ws_01", false)
    }

    #[test]
    fn run_state_requires_legal_and_verified_transitions() -> Result<(), StoreError> {
        let mut store = store()?;
        store.create_run("event_1", "ws_01", "run_1", "task_1", 1, "idem_1")?;
        assert!(matches!(store.run_state("run_1")?, Some(RunState::Queued)));
        assert!(matches!(
            store.transition_run(&RunTransition {
                event_id: "event_2",
                workspace_id: "ws_01",
                run_id: "run_1",
                target: &RunState::Succeeded,
                acceptance_evidence: &[],
                occurred_at_ms: 2,
                idempotency_key: "idem_2",
            }),
            Err(StoreError::InvalidTransition)
        ));
        store.transition_run(&RunTransition {
            event_id: "event_3",
            workspace_id: "ws_01",
            run_id: "run_1",
            target: &RunState::Running,
            acceptance_evidence: &[],
            occurred_at_ms: 3,
            idempotency_key: "idem_3",
        })?;
        assert!(matches!(
            store.transition_run(&RunTransition {
                event_id: "event_4",
                workspace_id: "ws_01",
                run_id: "run_1",
                target: &RunState::Succeeded,
                acceptance_evidence: &[],
                occurred_at_ms: 4,
                idempotency_key: "idem_4",
            }),
            Err(StoreError::AcceptanceEvidenceRequired)
        ));
        store.transition_run(&RunTransition {
            event_id: "event_5",
            workspace_id: "ws_01",
            run_id: "run_1",
            target: &RunState::Succeeded,
            acceptance_evidence: &["artifact://acceptance".to_owned()],
            occurred_at_ms: 5,
            idempotency_key: "idem_5",
        })?;
        assert!(matches!(
            store.run_state("run_1")?,
            Some(RunState::Succeeded)
        ));
        Ok(())
    }

    #[test]
    fn idempotency_replays_exactly_and_conflicts_fail_closed() -> Result<(), StoreError> {
        let mut store = store()?;
        let first = store.create_run("event_1", "ws_01", "run_1", "task_1", 1, "same")?;
        let replayed = store.create_run("event_other", "ws_01", "run_1", "task_1", 2, "same")?;
        assert!(matches!(first, CommitOutcome::Committed { .. }));
        assert_eq!(
            replayed,
            CommitOutcome::Replayed {
                event_id: "event_1".to_owned()
            }
        );
        assert!(matches!(
            store.create_run("event_2", "ws_01", "run_2", "task_2", 2, "same"),
            Err(StoreError::IdempotencyConflict)
        ));
        assert_eq!(store.event_count()?, 1);
        Ok(())
    }

    #[test]
    fn projection_failure_rolls_back_event_and_hash_chain_verifies() -> Result<(), StoreError> {
        let mut store = store()?;
        store.create_run("event_1", "ws_01", "run_1", "task_1", 1, "idem_1")?;
        assert!(
            store
                .create_run("event_2", "ws_01", "run_1", "task_1", 2, "idem_2")
                .is_err()
        );
        assert_eq!(store.event_count()?, 1);
        store.verify_hash_chain()?;
        Ok(())
    }

    #[test]
    fn file_store_is_encrypted_wal_and_rejects_wrong_key() -> Result<(), StoreError> {
        let directory = tempfile::tempdir().map_err(|_| StoreError::KeyCustody)?;
        let path = directory.path().join("facts.db");
        let keys = StaticKeys([7; DATABASE_KEY_LENGTH]);
        let mut store = EventStore::open(&path, "ws_01", &keys)?;
        store.create_run("event_1", "ws_01", "run_1", "task_1", 1, "idem_1")?;
        let mode: String = store
            .connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
        assert!(mode.eq_ignore_ascii_case("wal"));
        let version: i64 = store
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;
        assert_eq!(version, SCHEMA_VERSION);
        drop(store);

        let bytes = std::fs::read(&path).map_err(|_| StoreError::IntegrityCheckFailed)?;
        assert!(!bytes.starts_with(b"SQLite format 3"));
        let wrong = StaticKeys([8; DATABASE_KEY_LENGTH]);
        assert!(EventStore::open(&path, "ws_01", &wrong).is_err());

        let reopened = EventStore::open(&path, "ws_01", &keys)?;
        assert!(matches!(
            reopened.run_state("run_1")?,
            Some(RunState::Queued)
        ));
        reopened.verify_database_integrity()?;
        Ok(())
    }

    #[test]
    fn interrupted_key_rotation_reopens_with_staged_fallback() -> Result<(), StoreError> {
        let directory = tempfile::tempdir().map_err(|_| StoreError::KeyCustody)?;
        let path = directory.path().join("facts.db");
        let custodian = MemoryCustodian::new([7; DATABASE_KEY_LENGTH]);
        let mut store = EventStore::initialize(&path, "ws_01", &custodian)?;
        store.create_run("event_1", "ws_01", "run_1", "task_1", 1, "idem_1")?;
        custodian.fail_commit.set(true);
        let rotation = store.rotate_database_key(&custodian);
        assert!(
            matches!(rotation, Err(StoreError::KeyCustody)),
            "unexpected rotation result: {rotation:?}"
        );
        drop(store);

        let old = StaticKeys([7; DATABASE_KEY_LENGTH]);
        assert!(EventStore::open(&path, "ws_01", &old).is_err());
        let recovered = EventStore::open(&path, "ws_01", &custodian)?;
        assert!(matches!(
            recovered.run_state("run_1")?,
            Some(RunState::Queued)
        ));
        Ok(())
    }

    #[test]
    fn future_schema_and_cross_workspace_commands_fail_closed() -> Result<(), StoreError> {
        let mut store = store()?;
        assert!(matches!(
            store.create_run("event_1", "ws_other", "run_1", "task_1", 1, "idem_1"),
            Err(StoreError::WorkspaceMismatch)
        ));

        let directory = tempfile::tempdir().map_err(|_| StoreError::KeyCustody)?;
        let path = directory.path().join("future.db");
        let keys = StaticKeys([7; DATABASE_KEY_LENGTH]);
        let future = EventStore::open(&path, "ws_01", &keys)?;
        future
            .connection
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)?;
        drop(future);
        assert!(matches!(
            EventStore::open(&path, "ws_01", &keys),
            Err(StoreError::UnsupportedSchema)
        ));
        Ok(())
    }

    #[test]
    fn artifact_blob_is_authenticated_encrypted_and_idempotent() -> Result<(), StoreError> {
        let mut store = store()?;
        store.create_run("event_1", "ws_01", "run_1", "task_1", 1, "idem_1")?;
        let directory = tempfile::tempdir()?;
        let command = ArtifactCommit {
            event_id: "event_2",
            workspace_id: "ws_01",
            artifact_id: "artifact_1",
            run_id: "run_1",
            media_type: "text/plain",
            classification: "confidential",
            occurred_at_ms: 2,
            idempotency_key: "idem_2",
        };
        let plaintext = b"verification passed: 42 assertions";
        let committed = store.commit_artifact(directory.path(), &command, plaintext)?;
        assert!(matches!(committed.commit, CommitOutcome::Committed { .. }));
        assert_eq!(
            store.read_artifact(directory.path(), "artifact_1")?,
            plaintext
        );

        let replayed = store.commit_artifact(directory.path(), &command, plaintext)?;
        assert!(matches!(replayed.commit, CommitOutcome::Replayed { .. }));
        assert_eq!(replayed.content_hash, committed.content_hash);
        assert_eq!(store.event_count()?, 2);

        let relative: String = store.connection.query_row(
            "SELECT encrypted_path FROM blobs WHERE content_hash = ?1",
            [&committed.content_hash],
            |row| row.get(0),
        )?;
        let path = directory.path().join(relative);
        let mut encrypted = std::fs::read(&path)?;
        assert!(
            !encrypted
                .windows(plaintext.len())
                .any(|window| window == plaintext)
        );
        let tail = encrypted.last_mut().ok_or(StoreError::BlobCorrupt)?;
        *tail ^= 1;
        std::fs::write(path, encrypted)?;
        assert!(matches!(
            store.read_artifact(directory.path(), "artifact_1"),
            Err(StoreError::BlobCorrupt)
        ));
        Ok(())
    }

    #[test]
    fn outbox_intent_result_and_reconciliation_are_transactional() -> Result<(), StoreError> {
        let mut store = store()?;
        let intent = EffectIntent {
            event_id: "event_1",
            workspace_id: "ws_01",
            intent_id: "intent_1",
            effect_kind: "git.push",
            payload: &json!({"remote": "origin", "ref": "refs/heads/topic"}),
            occurred_at_ms: 1,
            idempotency_key: "idem_1",
        };
        assert!(matches!(
            store.record_effect_intent(&intent)?,
            CommitOutcome::Committed { .. }
        ));
        assert!(matches!(
            store.record_effect_intent(&intent)?,
            CommitOutcome::Replayed { .. }
        ));
        assert_eq!(store.pending_effects()?.len(), 1);

        let result = EffectResult {
            event_id: "event_2",
            workspace_id: "ws_01",
            intent_id: "intent_1",
            result: &json!({"verified_remote_sha": "abc123"}),
            disposition: EffectDisposition::Completed,
            occurred_at_ms: 2,
            idempotency_key: "idem_2",
        };
        assert!(matches!(
            store.record_effect_result(&result)?,
            CommitOutcome::Committed { .. }
        ));
        assert!(matches!(
            store.record_effect_result(&result)?,
            CommitOutcome::Replayed { .. }
        ));
        assert!(store.pending_effects()?.is_empty());
        assert_eq!(store.event_count()?, 2);

        let missing = EffectResult {
            event_id: "event_3",
            workspace_id: "ws_01",
            intent_id: "intent_missing",
            result: &json!({"status": "unknown"}),
            disposition: EffectDisposition::Abandoned,
            occurred_at_ms: 3,
            idempotency_key: "idem_3",
        };
        assert!(matches!(
            store.record_effect_result(&missing),
            Err(StoreError::OutboxStateConflict)
        ));
        assert_eq!(store.event_count()?, 2);
        Ok(())
    }

    #[test]
    fn recovery_rebuilds_projection_and_surfaces_pending_effects() -> Result<(), StoreError> {
        let mut store = store()?;
        store.create_run("event_1", "ws_01", "run_1", "task_1", 1, "idem_1")?;
        store.transition_run(&RunTransition {
            event_id: "event_2",
            workspace_id: "ws_01",
            run_id: "run_1",
            target: &RunState::Running,
            acceptance_evidence: &[],
            occurred_at_ms: 2,
            idempotency_key: "idem_2",
        })?;
        store.record_effect_intent(&EffectIntent {
            event_id: "event_3",
            workspace_id: "ws_01",
            intent_id: "intent_1",
            effect_kind: "deploy",
            payload: &json!({"target": "staging"}),
            occurred_at_ms: 3,
            idempotency_key: "idem_3",
        })?;
        store.connection.execute(
            "UPDATE runs SET state = 'blocked' WHERE run_id = 'run_1'",
            [],
        )?;
        assert!(matches!(
            store.verify_run_projection(),
            Err(StoreError::ProjectionMismatch)
        ));
        let report = store.recover()?;
        assert!(report.projection_repaired);
        assert_eq!(report.pending_effects.len(), 1);
        assert_eq!(report.pending_effects[0].intent_id, "intent_1");
        assert!(matches!(store.run_state("run_1")?, Some(RunState::Running)));
        store.verify_run_projection()?;
        Ok(())
    }

    #[test]
    fn version_one_database_migrates_without_losing_facts() -> Result<(), StoreError> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("legacy.db");
        let key = DatabaseKey::new([7; DATABASE_KEY_LENGTH]);
        let mut legacy = Connection::open(&path)?;
        apply_key_pragma(&legacy, "key", &key)?;
        migrate_to_v1(&legacy)?;
        let transaction = legacy.transaction()?;
        let sequence = append_event(
            &transaction,
            "event_1",
            "ws_01",
            "run.queued",
            1,
            &json!({"run_id": "run_1", "task_id": "task_1", "state": "queued"}),
        )?;
        transaction.execute(
            "INSERT INTO runs(run_id, task_id, state, updated_sequence)
             VALUES ('run_1', 'task_1', 'queued', ?1)",
            [sequence],
        )?;
        transaction.commit()?;
        drop(legacy);

        let keys = StaticKeys([7; DATABASE_KEY_LENGTH]);
        let migrated = EventStore::open(&path, "ws_01", &keys)?;
        let version: i64 = migrated
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;
        assert_eq!(version, SCHEMA_VERSION);
        assert!(matches!(
            migrated.run_state("run_1")?,
            Some(RunState::Queued)
        ));
        let blob_key_count: i64 = migrated.connection.query_row(
            "SELECT count(*) FROM store_metadata WHERE metadata_key = 'blob_master_key_v1'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(blob_key_count, 1);
        Ok(())
    }

    #[test]
    fn database_busy_rolls_back_without_partial_event() -> Result<(), StoreError> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("busy.db");
        let keys = StaticKeys([7; DATABASE_KEY_LENGTH]);
        let mut locker = EventStore::open(&path, "ws_01", &keys)?;
        let mut contender = EventStore::open(&path, "ws_01", &keys)?;
        contender
            .connection
            .busy_timeout(Duration::from_millis(20))?;
        let lock = locker
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let outcome = contender.create_run(
            "event_busy",
            "ws_01",
            "run_busy",
            "task_busy",
            1,
            "idem_busy",
        );
        assert!(matches!(outcome, Err(StoreError::Database(_))));
        drop(lock);
        assert_eq!(contender.event_count()?, 0);
        contender.verify_hash_chain()?;
        Ok(())
    }

    #[test]
    fn disk_full_rolls_back_without_partial_event() -> Result<(), StoreError> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("full.db");
        let keys = StaticKeys([7; DATABASE_KEY_LENGTH]);
        let mut store = EventStore::open(&path, "ws_01", &keys)?;
        store
            .connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        let pages: i64 = store
            .connection
            .query_row("PRAGMA page_count", [], |row| row.get(0))?;
        store
            .connection
            .pragma_update(None, "max_page_count", pages)?;
        let transaction = store.connection.transaction()?;
        let oversized = "x".repeat(2 * 1024 * 1024);
        let append = append_event(
            &transaction,
            "event_full",
            "ws_01",
            "fault.disk_full",
            1,
            &json!({"payload": oversized}),
        );
        assert!(matches!(append, Err(StoreError::Database(_))));
        drop(transaction);
        assert_eq!(store.event_count()?, 0);
        store.verify_hash_chain()?;
        Ok(())
    }

    #[test]
    fn process_termination_discards_uncommitted_tail() -> Result<(), StoreError> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("kill.db");
        let ready = directory.path().join("ready");
        let keys = StaticKeys([7; DATABASE_KEY_LENGTH]);
        let mut store = EventStore::open(&path, "ws_01", &keys)?;
        store.create_run("event_1", "ws_01", "run_1", "task_1", 1, "idem_1")?;
        drop(store);

        let executable = std::env::current_exe()?;
        let mut child = Command::new(executable)
            .args([
                "--exact",
                "tests::kill_worker_holds_uncommitted_transaction",
                "--nocapture",
            ])
            .env("SABER_FAULT_CHILD", "1")
            .env("SABER_FAULT_DB", &path)
            .env("SABER_FAULT_READY", &ready)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        let deadline = Instant::now() + Duration::from_secs(10);
        while !ready.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        if !ready.exists() {
            let _ = child.kill();
            return Err(StoreError::IntegrityCheckFailed);
        }
        child.kill()?;
        let _status = child.wait()?;

        let mut recovered = EventStore::open(&path, "ws_01", &keys)?;
        assert_eq!(recovered.event_count()?, 2);
        let report = recovered.recover()?;
        assert!(!report.projection_repaired);
        assert_eq!(report.pending_effects.len(), 1);
        assert_eq!(report.pending_effects[0].intent_id, "intent_after_restart");
        Ok(())
    }

    #[test]
    fn kill_worker_holds_uncommitted_transaction() -> Result<(), StoreError> {
        if std::env::var_os("SABER_FAULT_CHILD").is_none() {
            return Ok(());
        }
        let path = std::env::var_os("SABER_FAULT_DB").ok_or(StoreError::KeyCustody)?;
        let ready = std::env::var_os("SABER_FAULT_READY").ok_or(StoreError::KeyCustody)?;
        let keys = StaticKeys([7; DATABASE_KEY_LENGTH]);
        let mut store = EventStore::open(Path::new(&path), "ws_01", &keys)?;
        store.record_effect_intent(&EffectIntent {
            event_id: "event_intent",
            workspace_id: "ws_01",
            intent_id: "intent_after_restart",
            effect_kind: "remote.write",
            payload: &json!({"provider_idempotency_key": "intent_after_restart"}),
            occurred_at_ms: 2,
            idempotency_key: "idem_intent",
        })?;
        let transaction = store.connection.transaction()?;
        append_event(
            &transaction,
            "event_uncommitted",
            "ws_01",
            "fault.uncommitted",
            3,
            &json!({"phase": "after-event-before-projection"}),
        )?;
        std::fs::write(ready, b"ready")?;
        loop {
            thread::park_timeout(Duration::from_secs(60));
        }
    }
}
