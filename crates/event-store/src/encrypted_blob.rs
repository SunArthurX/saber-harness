//! Authenticated, content-addressed blob file operations.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chacha20poly1305::aead::{Aead, Generate, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use sha2::{Digest, Sha256};

use crate::StoreError;

const MAGIC: &[u8; 8] = b"SABLOB01";
const NONCE_LENGTH: usize = 24;

pub(crate) struct BlobMetadata {
    pub(crate) content_hash: String,
    pub(crate) ciphertext_hash: String,
    pub(crate) relative_path: String,
    pub(crate) byte_length: u64,
}

pub(crate) fn content_hash(plaintext: &[u8]) -> String {
    hex(&Sha256::digest(plaintext))
}

pub(crate) fn write(
    root: &Path,
    workspace_id: &str,
    key_bytes: &[u8; 32],
    media_type: &str,
    classification: &str,
    plaintext: &[u8],
) -> Result<BlobMetadata, StoreError> {
    let content_hash = content_hash(plaintext);
    let relative_path = format!("{}/{}.saberblob", &content_hash[..2], content_hash);
    let target = root.join(&relative_path);
    let byte_length = u64::try_from(plaintext.len()).map_err(|_| StoreError::BlobCorrupt)?;
    if target.exists() {
        let encoded = fs::read(&target)?;
        let decoded = decrypt(
            &encoded,
            workspace_id,
            key_bytes,
            media_type,
            classification,
            &content_hash,
            byte_length,
        )?;
        if decoded != plaintext {
            return Err(StoreError::BlobCorrupt);
        }
        return Ok(BlobMetadata {
            ciphertext_hash: hex(&Sha256::digest(&encoded)),
            content_hash,
            relative_path,
            byte_length,
        });
    }

    let parent = target.parent().ok_or(StoreError::BlobCorrupt)?;
    fs::create_dir_all(parent)?;
    let key = Key::from(*key_bytes);
    let cipher = XChaCha20Poly1305::new(&key);
    let nonce = XNonce::generate();
    let aad = aad(
        workspace_id,
        media_type,
        classification,
        &content_hash,
        byte_length,
    );
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| StoreError::Cryptography)?;
    let mut encoded = Vec::with_capacity(MAGIC.len() + NONCE_LENGTH + ciphertext.len());
    encoded.extend_from_slice(MAGIC);
    encoded.extend_from_slice(&nonce);
    encoded.extend_from_slice(&ciphertext);
    let ciphertext_hash = hex(&Sha256::digest(&encoded));

    let mut temporary = tempfile::Builder::new()
        .prefix(".saber-blob-")
        .tempfile_in(parent)?;
    temporary.write_all(&encoded)?;
    temporary.as_file().sync_all()?;
    match temporary.persist_noclobber(&target) {
        Ok(_) => {}
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
            let existing = fs::read(&target)?;
            let decoded = decrypt(
                &existing,
                workspace_id,
                key_bytes,
                media_type,
                classification,
                &content_hash,
                byte_length,
            )?;
            if decoded != plaintext {
                return Err(StoreError::BlobCorrupt);
            }
        }
        Err(error) => return Err(StoreError::Io(error.error)),
    }
    Ok(BlobMetadata {
        content_hash,
        ciphertext_hash,
        relative_path,
        byte_length,
    })
}

pub(crate) struct ReadRequest<'a> {
    pub(crate) root: &'a Path,
    pub(crate) relative_path: &'a str,
    pub(crate) workspace_id: &'a str,
    pub(crate) key_bytes: &'a [u8; 32],
    pub(crate) media_type: &'a str,
    pub(crate) classification: &'a str,
    pub(crate) expected_content_hash: &'a str,
    pub(crate) expected_ciphertext_hash: &'a str,
    pub(crate) byte_length: u64,
}

pub(crate) fn read(request: &ReadRequest<'_>) -> Result<Vec<u8>, StoreError> {
    let relative = PathBuf::from(request.relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(StoreError::BlobCorrupt);
    }
    let encoded = fs::read(request.root.join(relative))?;
    if hex(&Sha256::digest(&encoded)) != request.expected_ciphertext_hash {
        return Err(StoreError::BlobCorrupt);
    }
    let plaintext = decrypt(
        &encoded,
        request.workspace_id,
        request.key_bytes,
        request.media_type,
        request.classification,
        request.expected_content_hash,
        request.byte_length,
    )?;
    if content_hash(&plaintext) != request.expected_content_hash {
        return Err(StoreError::BlobCorrupt);
    }
    Ok(plaintext)
}

fn decrypt(
    encoded: &[u8],
    workspace_id: &str,
    key_bytes: &[u8; 32],
    media_type: &str,
    classification: &str,
    content_hash: &str,
    byte_length: u64,
) -> Result<Vec<u8>, StoreError> {
    if encoded.len() < MAGIC.len() + NONCE_LENGTH + 16 || !encoded.starts_with(MAGIC) {
        return Err(StoreError::BlobCorrupt);
    }
    let nonce = XNonce::try_from(&encoded[MAGIC.len()..MAGIC.len() + NONCE_LENGTH])
        .map_err(|_| StoreError::BlobCorrupt)?;
    let key = Key::from(*key_bytes);
    let cipher = XChaCha20Poly1305::new(&key);
    let aad = aad(
        workspace_id,
        media_type,
        classification,
        content_hash,
        byte_length,
    );
    let plaintext = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &encoded[MAGIC.len() + NONCE_LENGTH..],
                aad: &aad,
            },
        )
        .map_err(|_| StoreError::BlobCorrupt)?;
    if u64::try_from(plaintext.len()).map_err(|_| StoreError::BlobCorrupt)? != byte_length {
        return Err(StoreError::BlobCorrupt);
    }
    Ok(plaintext)
}

fn aad(
    workspace_id: &str,
    media_type: &str,
    classification: &str,
    content_hash: &str,
    byte_length: u64,
) -> Vec<u8> {
    let mut encoded = Vec::new();
    for part in [
        workspace_id.as_bytes(),
        media_type.as_bytes(),
        classification.as_bytes(),
        content_hash.as_bytes(),
        &byte_length.to_be_bytes(),
    ] {
        encoded.extend_from_slice(&(part.len() as u64).to_be_bytes());
        encoded.extend_from_slice(part);
    }
    encoded
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(encoded, "{byte:02x}");
    }
    encoded
}
