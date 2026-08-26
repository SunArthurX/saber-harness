//! Reference-only secret custody with short-lived scoped leases.
//!
//! Secrets never enter model context, requests, argv-visible plans, events or
//! audit. Untrusted code addresses them as opaque `credential://broker/<id>`
//! references; the broker issues single-consumption leases bound to one
//! request digest and explicit injection channels, injects material out of
//! band, redacts leased material from any captured output, and revokes and
//! zeroizes material on expiry, revocation or drop (ADR-008, SEC-ISO-003).

use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

/// Upper bound on lease lifetime.
pub const MAX_LEASE_MS: u64 = 900_000;

/// Stable redaction marker that replaces secret bytes in captured output.
pub const REDACTION_MARKER: &[u8] = b"[saber:redacted]";

/// Secret custody failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BrokerError {
    /// The credential reference is unknown.
    UnknownReference,
    /// The reference syntax is malformed.
    InvalidReference,
    /// The requested channel is not declared for this secret.
    ChannelNotAllowed,
    /// The requested purpose is not declared for this secret.
    PurposeMismatch,
    /// The lease request was malformed.
    InvalidLease,
    /// The lease expired.
    Expired,
    /// The lease or reference was revoked.
    Revoked,
    /// A single-consumption lease was used twice.
    Replay,
    /// The presented digest does not match the lease binding.
    DigestMismatch,
    /// The broker is unavailable; effects must fail closed.
    BrokerUnavailable,
}

impl Display for BrokerError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::UnknownReference => "unknown_reference",
            Self::InvalidReference => "invalid_reference",
            Self::ChannelNotAllowed => "channel_not_allowed",
            Self::PurposeMismatch => "purpose_mismatch",
            Self::InvalidLease => "invalid_lease",
            Self::Expired => "expired",
            Self::Revoked => "revoked",
            Self::Replay => "replay",
            Self::DigestMismatch => "digest_mismatch",
            Self::BrokerUnavailable => "broker_unavailable",
        })
    }
}

impl std::error::Error for BrokerError {}

/// One sanctioned injection channel for secret material.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    /// An allowlisted environment variable of the isolated child.
    EnvVar(String),
    /// A file target inside the realm overlay, relative to the overlay root.
    FileTarget(String),
}

/// A registered secret. Material stays behind the broker.
pub struct SecretRecord {
    material: Zeroizing<String>,
    channels: Vec<Channel>,
    purposes: Vec<String>,
    revoked: bool,
}

/// Request to lease one secret for one exact effect.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LeaseRequest {
    /// Opaque reference, `credential://broker/<id>`.
    pub credential_ref: String,
    /// Digest of the exact S05 capability request the lease is bound to.
    pub request_digest: String,
    /// Sanctioned injection channels; a subset of the record's channels.
    pub channels: Vec<Channel>,
    /// Stable purpose that must be declared on the record.
    pub purpose: String,
    /// Absolute lease expiry in Unix milliseconds.
    pub expires_at_ms: u64,
}

/// An issued lease handle. Contains no material.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SecretLease {
    /// Stable lease identifier.
    pub lease_id: String,
    /// Reference label (never material).
    pub credential_ref: String,
    /// Exact request digest binding.
    pub request_digest: String,
    /// Injection channels.
    pub channels: Vec<Channel>,
    /// Absolute expiry.
    pub expires_at_ms: u64,
    /// Whether the single consumption already happened.
    pub consumed: bool,
}

/// Material handed once to the injection point. Zeroized on drop.
pub struct LeaseMaterial {
    /// Owning lease identifier.
    pub lease_id: String,
    material: Zeroizing<String>,
}

impl std::fmt::Debug for LeaseMaterial {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("LeaseMaterial([redacted])")
    }
}

impl LeaseMaterial {
    /// The raw material, only for the injection call site.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.material
    }
}

struct LeaseState {
    lease: SecretLease,
    revoked: bool,
}

/// The broker itself. Construct one per workspace trust cell.
#[derive(Default)]
pub struct SecretBroker {
    records: BTreeMap<String, SecretRecord>,
    leases: BTreeMap<String, LeaseState>,
    counter: u64,
}

impl SecretBroker {
    /// Register secret material out of band.
    ///
    /// # Errors
    ///
    /// Rejects malformed references, empty material, empty channel/purpose
    /// declarations and duplicate references.
    pub fn register(
        &mut self,
        credential_ref: &str,
        material: &str,
        channels: Vec<Channel>,
        purposes: Vec<String>,
    ) -> Result<(), BrokerError> {
        let reference = credential_ref.to_owned();
        if !reference.starts_with("credential://broker/")
            || reference.len() == "credential://broker/".len()
            || reference.chars().any(char::is_whitespace)
        {
            return Err(BrokerError::InvalidReference);
        }
        if material.is_empty() || channels.is_empty() || purposes.is_empty() {
            return Err(BrokerError::InvalidLease);
        }
        if self.records.contains_key(&reference) {
            return Err(BrokerError::InvalidReference);
        }
        self.records.insert(
            reference,
            SecretRecord {
                material: Zeroizing::new(material.to_owned()),
                channels,
                purposes,
                revoked: false,
            },
        );
        Ok(())
    }

    /// Issue a scoped, short-lived, single-consumption lease.
    ///
    /// # Errors
    ///
    /// Rejects unknown/revoked references, unlisted channels or purposes,
    /// missing digest syntax, and expiry outside `(now, now + MAX_LEASE_MS]`.
    pub fn issue(
        &mut self,
        request: &LeaseRequest,
        now_ms: u64,
    ) -> Result<SecretLease, BrokerError> {
        let record = self
            .records
            .get(&request.credential_ref)
            .ok_or(BrokerError::UnknownReference)?;
        if record.revoked {
            return Err(BrokerError::Revoked);
        }
        if !request.request_digest.starts_with("sha256:") || request.request_digest.len() != 71 {
            return Err(BrokerError::InvalidLease);
        }
        if request.expires_at_ms <= now_ms || request.expires_at_ms > now_ms + MAX_LEASE_MS {
            return Err(BrokerError::InvalidLease);
        }
        if request.channels.is_empty() {
            return Err(BrokerError::InvalidLease);
        }
        for channel in &request.channels {
            if !record.channels.contains(channel) {
                return Err(BrokerError::ChannelNotAllowed);
            }
        }
        if !record.purposes.contains(&request.purpose) {
            return Err(BrokerError::PurposeMismatch);
        }
        self.counter += 1;
        let lease = SecretLease {
            lease_id: format!("lease-{:08}", self.counter),
            credential_ref: request.credential_ref.clone(),
            request_digest: request.request_digest.clone(),
            channels: request.channels.clone(),
            expires_at_ms: request.expires_at_ms,
            consumed: false,
        };
        self.leases.insert(
            lease.lease_id.clone(),
            LeaseState {
                lease: lease.clone(),
                revoked: false,
            },
        );
        Ok(lease)
    }

    /// Consume a lease once and receive material for injection.
    ///
    /// # Errors
    ///
    /// Rejects unknown, expired, revoked or replayed leases and digest
    /// mismatches; a mismatch additionally revokes the lease.
    pub fn consume(
        &mut self,
        lease_id: &str,
        expected_request_digest: &str,
        now_ms: u64,
    ) -> Result<LeaseMaterial, BrokerError> {
        let state = self
            .leases
            .get_mut(lease_id)
            .ok_or(BrokerError::InvalidLease)?;
        if state.revoked {
            return Err(BrokerError::Revoked);
        }
        if state.lease.expires_at_ms <= now_ms {
            state.revoked = true;
            return Err(BrokerError::Expired);
        }
        if state.lease.consumed {
            return Err(BrokerError::Replay);
        }
        if state.lease.request_digest != expected_request_digest {
            state.revoked = true;
            return Err(BrokerError::DigestMismatch);
        }
        state.lease.consumed = true;
        let reference = state.lease.credential_ref.clone();
        let material = self
            .records
            .get(&reference)
            .map(|record| record.material.clone())
            .ok_or(BrokerError::UnknownReference)?;
        Ok(LeaseMaterial {
            lease_id: lease_id.to_owned(),
            material,
        })
    }

    /// Revoke one lease.
    ///
    /// # Errors
    ///
    /// Unknown lease.
    pub fn revoke(&mut self, lease_id: &str) -> Result<(), BrokerError> {
        let state = self
            .leases
            .get_mut(lease_id)
            .ok_or(BrokerError::InvalidLease)?;
        state.revoked = true;
        Ok(())
    }

    /// Revoke every lease of one credential reference.
    pub fn revoke_reference(&mut self, credential_ref: &str) {
        for state in self.leases.values_mut() {
            if state.lease.credential_ref == credential_ref {
                state.revoked = true;
            }
        }
        if let Some(record) = self.records.get_mut(credential_ref) {
            record.revoked = true;
        }
    }

    /// Expire-and-revoke sweep for crash recovery.
    ///
    /// # Errors
    ///
    /// Broker unavailability is reserved for future durable custody.
    pub fn sweep(&mut self, now_ms: u64) -> Result<Vec<String>, BrokerError> {
        let mut expired = Vec::new();
        for (lease_id, state) in &mut self.leases {
            if state.lease.expires_at_ms <= now_ms && !state.revoked {
                state.revoked = true;
                expired.push(lease_id.clone());
            }
        }
        Ok(expired)
    }

    /// Replace every occurrence of any registered secret material in
    /// `output` with [`REDACTION_MARKER`] and return the replacement count.
    #[must_use]
    pub fn redact(&self, output: &mut Vec<u8>) -> usize {
        let mut count = 0;
        for record in self.records.values() {
            let needle = record.material.as_bytes();
            if needle.is_empty() {
                continue;
            }
            let mut start = 0;
            while let Some(found) = find_subsequence(&output[start..], needle) {
                let at = start + found;
                output.splice(at..at + needle.len(), REDACTION_MARKER.iter().copied());
                count += 1;
                start = at + REDACTION_MARKER.len();
                if start >= output.len() {
                    break;
                }
            }
        }
        count
    }

    /// Whether a reference exists and is not revoked.
    #[must_use]
    pub fn reference_available(&self, credential_ref: &str) -> bool {
        self.records
            .get(credential_ref)
            .is_some_and(|record| !record.revoked)
    }
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::items_after_statements
    )]
    use super::*;

    const SECRET: &str = "sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    fn broker() -> SecretBroker {
        let mut broker = SecretBroker::default();
        broker
            .register(
                "credential://broker/deploy-key",
                SECRET,
                vec![
                    Channel::EnvVar("DEPLOY_TOKEN".to_owned()),
                    Channel::FileTarget("secrets/deploy".to_owned()),
                ],
                vec!["deploy".to_owned()],
            )
            .unwrap_or_else(|error| unreachable!("{error}"));
        broker
    }

    fn lease_request(expires_at_ms: u64) -> LeaseRequest {
        LeaseRequest {
            credential_ref: "credential://broker/deploy-key".to_owned(),
            request_digest: "sha256:".to_owned() + &"a".repeat(64),
            channels: vec![Channel::EnvVar("DEPLOY_TOKEN".to_owned())],
            purpose: "deploy".to_owned(),
            expires_at_ms,
        }
    }

    #[test]
    fn references_are_opaque_and_validated() {
        assert_eq!(
            broker().register(
                "deploy-key",
                "x",
                vec![Channel::EnvVar("A".to_owned())],
                vec!["deploy".to_owned()],
            ),
            Err(BrokerError::InvalidReference)
        );
        assert_eq!(
            broker().register(
                "credential://broker/",
                "x",
                vec![Channel::EnvVar("A".to_owned())],
                vec!["deploy".to_owned()],
            ),
            Err(BrokerError::InvalidReference)
        );
        assert!(broker().reference_available("credential://broker/deploy-key"));
        assert!(!broker().reference_available("credential://broker/missing"));
    }

    #[test]
    fn leases_enforce_scope_purpose_and_ttl() {
        let mut broker = broker();
        assert_eq!(
            broker
                .issue(
                    &LeaseRequest {
                        channels: vec![Channel::EnvVar("NOT_DECLARED".to_owned())],
                        ..lease_request(60_000)
                    },
                    0
                )
                .unwrap_err(),
            BrokerError::ChannelNotAllowed
        );
        assert_eq!(
            broker
                .issue(
                    &LeaseRequest {
                        purpose: "exfiltrate".to_owned(),
                        ..lease_request(60_000)
                    },
                    0
                )
                .unwrap_err(),
            BrokerError::PurposeMismatch
        );
        assert_eq!(
            broker.issue(&lease_request(0), 0).unwrap_err(),
            BrokerError::InvalidLease
        );
        assert_eq!(
            broker
                .issue(&lease_request(MAX_LEASE_MS + 1), 0)
                .unwrap_err(),
            BrokerError::InvalidLease
        );
        assert_eq!(
            broker
                .issue(
                    &LeaseRequest {
                        request_digest: "not-a-digest".to_owned(),
                        ..lease_request(60_000)
                    },
                    0
                )
                .unwrap_err(),
            BrokerError::InvalidLease
        );
    }

    #[test]
    fn consumption_is_single_shot_digest_bound_and_revocable() {
        let digest = format!("sha256:{}", "b".repeat(64));
        let mut broker = broker();
        let request = LeaseRequest {
            request_digest: digest.clone(),
            ..lease_request(60_000)
        };
        let lease = broker
            .issue(&request, 0)
            .unwrap_or_else(|error| unreachable!("{error}"));
        let material = broker
            .consume(&lease.lease_id, &digest, 1)
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert_eq!(material.expose(), SECRET);
        assert_eq!(
            broker.consume(&lease.lease_id, &digest, 2).unwrap_err(),
            BrokerError::Replay
        );
        let second = broker
            .issue(
                &LeaseRequest {
                    request_digest: format!("sha256:{}", "c".repeat(64)),
                    ..lease_request(60_000)
                },
                0,
            )
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert_eq!(
            broker.consume(&second.lease_id, &digest, 1).unwrap_err(),
            BrokerError::DigestMismatch
        );
        assert_eq!(
            broker.consume(&second.lease_id, &digest, 1).unwrap_err(),
            BrokerError::Revoked
        );
    }

    #[test]
    fn expiry_sweep_revokes_and_blocks_after_crash_window() {
        let digest = format!("sha256:{}", "d".repeat(64));
        let mut broker = broker();
        let request = LeaseRequest {
            request_digest: digest.clone(),
            ..lease_request(1_000)
        };
        let lease = broker
            .issue(&request, 0)
            .unwrap_or_else(|error| unreachable!("{error}"));
        // The crash-recovery sweep revokes lease A terminally.
        assert_eq!(
            broker
                .sweep(1_000)
                .unwrap_or_else(|error| unreachable!("{error}")),
            vec![lease.lease_id.clone()]
        );
        assert_eq!(
            broker.consume(&lease.lease_id, &digest, 1_001).unwrap_err(),
            BrokerError::Revoked
        );
        // Pure expiry without a sweep denies lease B with `expired`.
        let lease_b = broker
            .issue(&request, 0)
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert_eq!(
            broker
                .consume(&lease_b.lease_id, &digest, 1_001)
                .unwrap_err(),
            BrokerError::Expired
        );
        // Expiry denial itself revokes defensively: the lease cannot be
        // replayed even inside its nominal window.
        assert_eq!(
            broker
                .consume(&lease_b.lease_id, &digest, 1_000)
                .unwrap_err(),
            BrokerError::Revoked
        );
        broker.revoke_reference("credential://broker/deploy-key");
        assert!(!broker.reference_available("credential://broker/deploy-key"));
    }

    #[test]
    fn redaction_masks_material_in_stdout_stderr_and_files() {
        let broker = broker();
        let mut stdout = format!("deploying with {SECRET} now").into_bytes();
        let count = broker.redact(&mut stdout);
        assert_eq!(count, 1);
        assert!(!stdout.windows(SECRET.len()).any(|w| w == SECRET.as_bytes()));
        assert!(
            stdout
                .windows(REDACTION_MARKER.len())
                .any(|w| w == REDACTION_MARKER)
        );

        let mut repeated = format!("{SECRET} and {SECRET}").into_bytes();
        assert_eq!(broker.redact(&mut repeated), 2);

        let temp = tempfile::tempdir().unwrap_or_else(|error| unreachable!("{error}"));
        let artifact = temp.path().join("out.txt");
        std::fs::write(&artifact, format!("token={SECRET}"))
            .unwrap_or_else(|error| unreachable!("{error}"));
        let mut bytes = std::fs::read(&artifact).unwrap_or_else(|error| unreachable!("{error}"));
        let redactions = broker.redact(&mut bytes);
        assert!(redactions >= 1);
        assert!(!bytes.windows(SECRET.len()).any(|w| w == SECRET.as_bytes()));
    }

    #[test]
    fn lease_material_never_renders_in_debug() {
        let digest = format!("sha256:{}", "e".repeat(64));
        let mut broker = broker();
        let lease = broker
            .issue(
                &LeaseRequest {
                    request_digest: digest.clone(),
                    ..lease_request(60_000)
                },
                0,
            )
            .unwrap_or_else(|error| unreachable!("{error}"));
        let material = broker
            .consume(&lease.lease_id, &digest, 1)
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert!(!format!("{material:?}").contains(SECRET));
        assert!(!format!("{lease:?}").contains(SECRET));
    }
}
