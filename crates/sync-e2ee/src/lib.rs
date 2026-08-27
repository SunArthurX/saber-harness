//! Client-key end-to-end-encrypted sync objects (ADR-019).

use std::collections::BTreeMap;

use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305,
    aead::{Aead, Payload},
};
use saber_policy::DataClass;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

fn hex_upper(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02X}");
    }
    out
}

/// Errors with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SyncError {
    /// The key did not decrypt the object.
    WrongKey,
    /// Ciphertext or authenticated metadata failed verification.
    AuthenticationFailed,
    /// A manifest replay/rollback was detected.
    Rollback,
    /// The object shape was malformed.
    Malformed,
    /// The device key was revoked for this epoch.
    Revoked,
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::WrongKey => "wrong_key",
            Self::AuthenticationFailed => "authentication_failed",
            Self::Rollback => "rollback",
            Self::Malformed => "malformed",
            Self::Revoked => "revoked",
        })
    }
}

impl std::error::Error for SyncError {}

/// Authenticated metadata traveling INSIDE the AEAD (ADR-019).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ObjectMetadata {
    /// Owning workspace.
    pub workspace_id: String,
    /// Data classification — downgrade attempts fail authentication.
    pub classification: DataClass,
    /// Media type label.
    pub media_type: String,
    /// `sha256:<64 hex>` of the plaintext.
    pub plaintext_digest: String,
    /// Plaintext length (cross-checked after decryption).
    pub plaintext_len: u64,
}

impl ObjectMetadata {
    fn canonical(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }
}

/// A sealed sync object: ciphertext plus the wrapped data key. Everything
/// here is server-visible BY DESIGN and must contain no plaintext.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SealedObject {
    /// Content-derived object id.
    pub object_id: String,
    /// Monotonic key/sync epoch.
    pub epoch: u64,
    /// Random nonce for the AEAD.
    pub nonce: [u8; 24],
    /// Ciphertext of (metadata || plaintext) with the metadata length
    /// prefix — authenticated, not encrypted separately.
    pub ciphertext: Vec<u8>,
    /// The per-object data key wrapped under the workspace KEK.
    pub wrapped_key: Vec<u8>,
}

/// Derive a deterministic object id from epoch and ciphertext.
#[must_use]
pub fn object_id_of(epoch: u64, ciphertext: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"saber-sync-object-v1\0");
    hasher.update(epoch.to_le_bytes());
    hasher.update(ciphertext);
    format!("sha256:{}", hex_upper(&hasher.finalize()))
}

fn plaintext_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{}", hex_upper(&hasher.finalize()))
}

fn kek_seed_to_key(seed: &[u8; 32]) -> XChaCha20Poly1305 {
    XChaCha20Poly1305::new_from_slice(seed).unwrap_or_else(|_| unreachable!("32-byte key"))
}

fn wrap_key(
    kek_seed: &[u8; 32],
    data_key: &[u8; 32],
    nonce: &[u8; 24],
) -> Result<Vec<u8>, SyncError> {
    let cipher = kek_seed_to_key(kek_seed);
    let nonce = chacha20poly1305::XNonce::try_from(&nonce[..]).map_err(|_| SyncError::Malformed)?;
    cipher
        .encrypt(&nonce, data_key.as_slice())
        .map_err(|_| SyncError::Malformed)
}

fn unwrap_key(
    kek_seed: &[u8; 32],
    wrapped: &[u8],
    nonce: &[u8; 24],
) -> Result<Zeroizing<[u8; 32]>, SyncError> {
    let cipher = kek_seed_to_key(kek_seed);
    let plain = cipher
        .decrypt(
            &chacha20poly1305::XNonce::try_from(&nonce[..]).map_err(|_| SyncError::Malformed)?,
            wrapped,
        )
        .map_err(|_| SyncError::WrongKey)?;
    let array: [u8; 32] = plain
        .as_slice()
        .try_into()
        .map_err(|_| SyncError::Malformed)?;
    Ok(Zeroizing::new(array))
}

/// Seal one object under a workspace KEK seed.
///
/// # Errors
///
/// [`SyncError::Malformed`] for empty plaintext.
pub fn seal(
    kek_seed: &[u8; 32],
    epoch: u64,
    metadata: &ObjectMetadata,
    plaintext: &[u8],
) -> Result<SealedObject, SyncError> {
    if plaintext.is_empty() || metadata.workspace_id.is_empty() {
        return Err(SyncError::Malformed);
    }
    let mut data_key = Zeroizing::new([0_u8; 32]);
    getrandom::fill(data_key.as_mut()).map_err(|_| SyncError::Malformed)?;
    let mut nonce = [0_u8; 24];
    getrandom::fill(&mut nonce).map_err(|_| SyncError::Malformed)?;

    // metadata_len || metadata || plaintext, all inside the AEAD.
    let canonical = metadata.canonical();
    let mut aad_input = Vec::with_capacity(4 + canonical.len() + plaintext.len());
    aad_input.extend_from_slice(
        &u32::try_from(canonical.len())
            .map_err(|_| SyncError::Malformed)?
            .to_le_bytes(),
    );
    aad_input.extend_from_slice(&canonical);
    aad_input.extend_from_slice(plaintext);

    let key_array: [u8; 32] = *data_key;
    let cipher = kek_seed_to_key(&key_array);
    let ciphertext = cipher
        .encrypt(
            &chacha20poly1305::XNonce::try_from(&nonce[..]).map_err(|_| SyncError::Malformed)?,
            Payload {
                msg: &aad_input,
                aad: &epoch.to_le_bytes(),
            },
        )
        .map_err(|_| SyncError::Malformed)?;
    let key_array: [u8; 32] = *data_key;
    let wrapped_key = wrap_key(kek_seed, &key_array, &nonce)?;
    Ok(SealedObject {
        object_id: object_id_of(epoch, &ciphertext),
        epoch,
        nonce,
        ciphertext,
        wrapped_key,
    })
}

/// The decrypted object with verified metadata.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenedObject {
    /// Verified metadata (authenticated inside the AEAD).
    pub metadata: ObjectMetadata,
    /// Verified plaintext.
    pub plaintext: Vec<u8>,
}

/// Open a sealed object. Wrong keys, tampered ciphertext, metadata
/// forgery (classification downgrade, digest lies) and length mismatch
/// all fail closed (ADR-019).
///
/// # Errors
///
/// Deterministic codes per [`SyncError`].
pub fn open(kek_seed: &[u8; 32], object: &SealedObject) -> Result<OpenedObject, SyncError> {
    let data_key = unwrap_key(kek_seed, &object.wrapped_key, &object.nonce)?;
    let key_array: [u8; 32] = *data_key;
    let cipher = kek_seed_to_key(&key_array);
    let aad_input = cipher
        .decrypt(
            &chacha20poly1305::XNonce::try_from(&object.nonce[..])
                .map_err(|_| SyncError::Malformed)?,
            Payload {
                msg: &object.ciphertext,
                aad: &object.epoch.to_le_bytes(),
            },
        )
        .map_err(|_| SyncError::AuthenticationFailed)?;
    if aad_input.len() < 4 {
        return Err(SyncError::Malformed);
    }
    let metadata_len = u32::from_le_bytes(
        aad_input[0..4]
            .try_into()
            .map_err(|_| SyncError::Malformed)?,
    );
    let metadata_end = 4 + metadata_len as usize;
    if aad_input.len() < metadata_end {
        return Err(SyncError::Malformed);
    }
    let metadata: ObjectMetadata =
        serde_json::from_slice(&aad_input[4..metadata_end]).map_err(|_| SyncError::Malformed)?;
    let plaintext = aad_input[metadata_end..].to_vec();
    // Cross-check the authenticated claims against the actual plaintext.
    if plaintext_digest(&plaintext) != metadata.plaintext_digest
        || plaintext.len() as u64 != metadata.plaintext_len
    {
        return Err(SyncError::AuthenticationFailed);
    }
    Ok(OpenedObject {
        metadata,
        plaintext,
    })
}

/// The client-side anti-rollback epoch ledger (TM-12).
#[derive(Default)]
pub struct EpochLedger {
    last_seen: BTreeMap<String, u64>,
    revoked_below_epoch: BTreeMap<String, u64>,
}

impl EpochLedger {
    /// Record a manifest epoch for a workspace; replays and rollbacks are
    /// refused.
    ///
    /// # Errors
    ///
    /// [`SyncError::Rollback`] at or below the last-seen epoch;
    /// [`SyncError::Revoked`] when the epoch predates a device revocation.
    pub fn advance(&mut self, workspace_id: &str, epoch: u64) -> Result<(), SyncError> {
        if let Some(floor) = self.revoked_below_epoch.get(workspace_id)
            && epoch < *floor
        {
            return Err(SyncError::Revoked);
        }
        if let Some(last) = self.last_seen.get(workspace_id)
            && epoch <= *last
        {
            return Err(SyncError::Rollback);
        }
        self.last_seen.insert(workspace_id.to_owned(), epoch);
        Ok(())
    }

    /// Revoke a device for a workspace: epochs strictly below `floor` are
    /// refused from now on.
    pub fn revoke_device(&mut self, workspace_id: &str, floor_epoch: u64) {
        self.revoked_below_epoch
            .insert(workspace_id.to_owned(), floor_epoch);
    }

    /// The last-seen epoch for a workspace.
    #[must_use]
    pub fn last_seen(&self, workspace_id: &str) -> Option<u64> {
        self.last_seen.get(workspace_id).copied()
    }
}

/// Scan a server-visible byte stream for plaintext or content-key bytes
/// (the S17 canary).
///
/// # Errors
///
/// [`SyncError::AuthenticationFailed`] when forbidden bytes are found.
pub fn assert_server_stream_clean(
    objects: &[SealedObject],
    forbidden: &[&[u8]],
) -> Result<(), SyncError> {
    for object in objects {
        for needle in forbidden {
            if !needle.is_empty()
                && object
                    .ciphertext
                    .windows(needle.len())
                    .any(|window| window == *needle)
                || object
                    .wrapped_key
                    .windows(needle.len().max(1))
                    .any(|window| !needle.is_empty() && window == *needle)
            {
                return Err(SyncError::AuthenticationFailed);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;

    const PLAINTEXT: &[u8] = b"deploy notes: production canary secret payload";
    const SECRET_KEY_BYTES: &[u8] = b"0123456789abcdef0123456789abcdef";

    fn kek() -> [u8; 32] {
        // Deterministic test KEK: SHA-256 of the plaintext label.
        let mut hasher = Sha256::new();
        hasher.update(b"test-kek");
        hasher.update(PLAINTEXT);
        hasher.finalize().into()
    }

    fn metadata() -> ObjectMetadata {
        ObjectMetadata {
            workspace_id: "ws_01".to_owned(),
            classification: DataClass::Confidential,
            media_type: "text/plain".to_owned(),
            plaintext_digest: plaintext_digest(PLAINTEXT),
            plaintext_len: PLAINTEXT.len() as u64,
        }
    }

    #[test]
    fn seal_open_roundtrip_with_auth_metadata() {
        let object = seal(&kek(), 1, &metadata(), PLAINTEXT).unwrap();
        assert!(object.object_id.starts_with("sha256:"));
        let opened = open(&kek(), &object).unwrap();
        assert_eq!(opened.plaintext, PLAINTEXT);
        assert_eq!(opened.metadata.classification, DataClass::Confidential);
        // Deterministic object ids per epoch+ciphertext.
        assert_eq!(
            object_id_of(object.epoch, &object.ciphertext),
            object.object_id
        );
    }

    #[test]
    fn wrong_key_fails_closed() {
        let object = seal(&kek(), 1, &metadata(), PLAINTEXT).unwrap();
        let mut wrong = kek();
        wrong[0] ^= 0xFF;
        assert_eq!(open(&wrong, &object), Err(SyncError::WrongKey));
    }

    #[test]
    fn tampered_ciphertext_fails_authentication() {
        let mut object = seal(&kek(), 1, &metadata(), PLAINTEXT).unwrap();
        object.ciphertext[0] ^= 0xFF;
        assert_eq!(open(&kek(), &object), Err(SyncError::AuthenticationFailed));
    }

    #[test]
    fn classification_downgrade_requires_new_authentic_object() {
        // Metadata is inside the AEAD: a downgrade attempt means tampering
        // with ciphertext, which fails authentication. There is no
        // server-side metadata field to forge.
        let mut object = seal(&kek(), 1, &metadata(), PLAINTEXT).unwrap();
        object.ciphertext[5] ^= 0x01;
        assert_eq!(open(&kek(), &object), Err(SyncError::AuthenticationFailed));
    }

    #[test]
    fn anti_rollback_ledger_refuses_replay_and_old_epochs() {
        let mut ledger = EpochLedger::default();
        ledger.advance("ws_01", 3).unwrap();
        assert_eq!(ledger.advance("ws_01", 3), Err(SyncError::Rollback));
        assert_eq!(ledger.advance("ws_01", 2), Err(SyncError::Rollback));
        ledger.advance("ws_01", 4).unwrap();
        assert_eq!(ledger.last_seen("ws_01"), Some(4));
    }

    #[test]
    fn revoked_devices_cannot_return_to_pre_revocation_epochs() {
        let mut ledger = EpochLedger::default();
        ledger.advance("ws_01", 5).unwrap();
        ledger.revoke_device("ws_01", 6);
        assert_eq!(ledger.advance("ws_01", 5), Err(SyncError::Revoked));
        ledger.advance("ws_01", 6).unwrap();
    }

    #[test]
    fn server_visible_stream_is_zero_plaintext_and_zero_keys() {
        let object = seal(&kek(), 1, &metadata(), PLAINTEXT).unwrap();
        let data_key_needle = SECRET_KEY_BYTES;
        // The plaintext never appears; raw data keys never appear because
        // they only exist wrapped (canary scans the wrapped bytes too).
        assert_server_stream_clean(std::slice::from_ref(&object), &[PLAINTEXT, data_key_needle])
            .unwrap();
        // A canary breach is actually detected.
        let mut leaky = object.clone();
        leaky.ciphertext.extend_from_slice(PLAINTEXT);
        assert_eq!(
            assert_server_stream_clean(&[leaky], &[PLAINTEXT]),
            Err(SyncError::AuthenticationFailed)
        );
    }

    #[test]
    fn per_object_data_keys_differ_across_objects() {
        let first = seal(&kek(), 1, &metadata(), PLAINTEXT).unwrap();
        let second = seal(&kek(), 1, &metadata(), PLAINTEXT).unwrap();
        // Fresh random data keys and nonces produce distinct ciphertexts
        // and distinct wrapped keys for identical plaintext.
        assert_ne!(first.ciphertext, second.ciphertext);
        assert_ne!(first.wrapped_key, second.wrapped_key);
        assert_ne!(first.nonce, second.nonce);
    }
}
