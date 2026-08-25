//! Native operating-system custody for per-workspace database keys.

use keyring::{Entry, Error as KeyringError};
use zeroize::Zeroize;

use crate::{DatabaseKey, DatabaseKeyCustodian, DatabaseKeyProvider, StoreError};

const RECORD_MAGIC: &[u8; 8] = b"SABERK01";
const KEY_LENGTH: usize = 32;

/// Production key custodian backed by Keychain, Credential Manager or Secret Service.
///
/// The credential payload can temporarily contain both the current key and a staged
/// replacement. This makes database rekeying recoverable if the process stops between
/// changing `SQLCipher` and committing the new key as primary.
#[derive(Clone, Debug)]
pub struct OsKeyringProvider {
    service: String,
}

impl OsKeyringProvider {
    /// Create a custodian under an application-specific credential service name.
    #[must_use]
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    /// Create the standard Saber database-key custodian.
    #[must_use]
    pub fn saber_default() -> Self {
        Self::new("dev.saber-harness.database")
    }

    fn entry(&self, workspace_id: &str) -> Result<Entry, StoreError> {
        if workspace_id.is_empty() {
            return Err(StoreError::KeyCustody);
        }
        Entry::new(&self.service, workspace_id).map_err(|_| StoreError::KeyCustody)
    }

    fn write_record(
        &self,
        workspace_id: &str,
        primary: &DatabaseKey,
        fallback: Option<&DatabaseKey>,
    ) -> Result<(), StoreError> {
        let mut record = Vec::with_capacity(RECORD_MAGIC.len() + KEY_LENGTH * 2 + 1);
        record.extend_from_slice(RECORD_MAGIC);
        record.extend_from_slice(primary.as_bytes());
        record.push(u8::from(fallback.is_some()));
        if let Some(key) = fallback {
            record.extend_from_slice(key.as_bytes());
        }
        let result = self
            .entry(workspace_id)?
            .set_secret(&record)
            .map_err(|_| StoreError::KeyCustody);
        record.zeroize();
        result
    }

    fn decode_record(mut record: Vec<u8>) -> Result<Vec<DatabaseKey>, StoreError> {
        let decoded = if record.len() == KEY_LENGTH {
            let mut raw = [0_u8; KEY_LENGTH];
            raw.copy_from_slice(&record);
            Ok(vec![DatabaseKey::new(raw)])
        } else if record.starts_with(RECORD_MAGIC)
            && matches!(record.len(), 41 | 73)
            && matches!(record[40], 0 | 1)
            && (record[40] == 0) == (record.len() == 41)
        {
            let mut primary = [0_u8; KEY_LENGTH];
            primary.copy_from_slice(&record[8..40]);
            let mut keys = vec![DatabaseKey::new(primary)];
            if record[40] == 1 {
                let mut fallback = [0_u8; KEY_LENGTH];
                fallback.copy_from_slice(&record[41..73]);
                keys.push(DatabaseKey::new(fallback));
            }
            Ok(keys)
        } else {
            Err(StoreError::KeyCustody)
        };
        record.zeroize();
        decoded
    }
}

impl Default for OsKeyringProvider {
    fn default() -> Self {
        Self::saber_default()
    }
}

impl DatabaseKeyProvider for OsKeyringProvider {
    fn load(&self, workspace_id: &str) -> Result<DatabaseKey, StoreError> {
        let mut candidates = self.load_candidates(workspace_id)?;
        if candidates.is_empty() {
            return Err(StoreError::KeyCustody);
        }
        Ok(candidates.remove(0))
    }

    fn load_candidates(&self, workspace_id: &str) -> Result<Vec<DatabaseKey>, StoreError> {
        let record = self
            .entry(workspace_id)?
            .get_secret()
            .map_err(|_| StoreError::KeyCustody)?;
        Self::decode_record(record)
    }
}

impl DatabaseKeyCustodian for OsKeyringProvider {
    fn provision(&self, workspace_id: &str) -> Result<(), StoreError> {
        let entry = self.entry(workspace_id)?;
        match entry.get_secret() {
            Ok(record) => {
                Self::decode_record(record)?;
                Ok(())
            }
            Err(KeyringError::NoEntry) => {
                let key = DatabaseKey::random()?;
                self.write_record(workspace_id, &key, None)
            }
            Err(_) => Err(StoreError::KeyCustody),
        }
    }

    fn stage_rotation(
        &self,
        workspace_id: &str,
        current: &DatabaseKey,
    ) -> Result<DatabaseKey, StoreError> {
        let next = DatabaseKey::random()?;
        self.write_record(workspace_id, current, Some(&next))?;
        Ok(next)
    }

    fn commit_rotation(&self, workspace_id: &str, current: &DatabaseKey) -> Result<(), StoreError> {
        self.write_record(workspace_id, current, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_records_accept_legacy_and_staged_keys() -> Result<(), StoreError> {
        let legacy = vec![3_u8; KEY_LENGTH];
        assert_eq!(OsKeyringProvider::decode_record(legacy)?.len(), 1);

        let primary = DatabaseKey::new([4_u8; KEY_LENGTH]);
        let fallback = DatabaseKey::new([5_u8; KEY_LENGTH]);
        let mut staged = Vec::new();
        staged.extend_from_slice(RECORD_MAGIC);
        staged.extend_from_slice(primary.as_bytes());
        staged.push(1);
        staged.extend_from_slice(fallback.as_bytes());
        let decoded = OsKeyringProvider::decode_record(staged)?;
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].as_bytes(), primary.as_bytes());
        assert_eq!(decoded[1].as_bytes(), fallback.as_bytes());
        Ok(())
    }

    #[test]
    fn malformed_credential_record_fails_closed() {
        assert!(matches!(
            OsKeyringProvider::decode_record(vec![1_u8; 31]),
            Err(StoreError::KeyCustody)
        ));
    }
}
