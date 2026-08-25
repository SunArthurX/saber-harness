//! SQLCipher-backed append-only events and transactional projections.

use std::error::Error;
use std::fmt::{Debug, Display, Formatter};
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use saber_core_protocol::RunState;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

const ZERO_HASH: [u8; 32] = [0; 32];

/// Secret database key whose bytes are erased on drop and never exposed through `Debug`.
pub struct DatabaseKey(Vec<u8>);

impl DatabaseKey {
    /// Wrap key bytes supplied by an OS credential store or enterprise KMS adapter.
    #[must_use]
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
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
}

/// Stable event-store failures.
#[derive(Debug)]
pub enum StoreError {
    /// `SQLCipher` or SQLite rejected an operation.
    Database(rusqlite::Error),
    /// A payload could not be encoded or decoded.
    Json(serde_json::Error),
    /// Secure key custody failed.
    KeyCustody,
    /// The `SQLCipher` codec was not active.
    CipherUnavailable,
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
            Self::KeyCustody => "key_custody_error",
            Self::CipherUnavailable => "cipher_unavailable",
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

/// `SQLCipher` connection owning the authoritative local event log and projections.
pub struct EventStore {
    connection: Connection,
}

impl EventStore {
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
        let key = provider.load(workspace_id)?;
        let connection = Connection::open(path)?;
        Self::configure(connection, &key)
    }

    fn configure(connection: Connection, key: &DatabaseKey) -> Result<Self, StoreError> {
        let mut encoded = String::with_capacity(key.0.len() * 2 + 3);
        encoded.push_str("x'");
        for byte in &key.0 {
            use std::fmt::Write as _;
            write!(encoded, "{byte:02x}").map_err(|_| StoreError::KeyCustody)?;
        }
        encoded.push('\'');
        let key_result = connection.pragma_update(None, "key", &encoded);
        encoded.zeroize();
        key_result?;

        let cipher_version: Option<String> = connection
            .query_row("PRAGMA cipher_version", [], |row| row.get(0))
            .optional()?;
        if cipher_version.as_deref().is_none_or(str::is_empty) {
            return Err(StoreError::CipherUnavailable);
        }
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "secure_delete", "ON")?;
        connection.pragma_update(None, "temp_store", "MEMORY")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
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
             COMMIT;",
        )?;
        Ok(Self { connection })
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
    use super::*;

    struct TestKeys;

    impl DatabaseKeyProvider for TestKeys {
        fn load(&self, _workspace_id: &str) -> Result<DatabaseKey, StoreError> {
            Ok(DatabaseKey::new(vec![7; 32]))
        }
    }

    fn store() -> Result<EventStore, StoreError> {
        let key = TestKeys.load("ws_01")?;
        EventStore::configure(Connection::open_in_memory()?, &key)
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
}
