//! Default-deny egress policy enforcement point.
//!
//! Every outbound connection request binds purpose, destination, policy
//! snapshot, data classification and taint set. Enforcement rejects unmatched
//! purposes and hosts, private/loopback/link-local/reserved ranges in every
//! IP-literal encoding, localhost synonyms, cloud metadata endpoints, DNS
//! rebinding (resolved addresses are re-validated and pinned), cross-host
//! redirect chains, classifications above the rule ceiling and
//! secret-tainted payloads. The decision logic is pure so it is exhaustively
//! testable without sockets; transports may only connect using a PEP-issued
//! authorization bound to the validated destination (ADR-008, SEC-ISO-004).

use std::fmt::{Display, Formatter};
use std::net::IpAddr;

use saber_policy::DataClass;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Taint kinds that can attach to outbound payloads.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaintKind {
    /// Payload contains secret-adjacent material.
    Secret,
    /// Payload contains credential material.
    Credential,
    /// Payload contains personally identifying information.
    Pii,
    /// Payload derived from untrusted imported sources.
    UntrustedSource,
}

/// Redirect policy of one rule.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RedirectPolicy {
    /// Every redirect is denied.
    Deny,
    /// Only same-host redirects may be re-authorized.
    SameHost,
}

/// One allowed destination shape.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DestinationPattern {
    /// Exact lowercase hostname, optionally covering subdomains.
    Domain {
        /// Hostname without scheme, port or trailing dot.
        host: String,
        /// Whether `*.host` also matches.
        subdomains: bool,
    },
    /// An explicit IP literal allowlist entry.
    IpLiteral {
        /// The literal address.
        address: String,
    },
}

/// One typed egress rule. Absence of a matching rule is denial.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct EgressRule {
    /// Stable purpose code, for example `model-provider`.
    pub purpose: String,
    /// Allowed destination shapes.
    pub destinations: Vec<DestinationPattern>,
    /// Allowed URL schemes.
    pub schemes: Vec<String>,
    /// Maximum data classification this rule permits.
    pub max_data_class: DataClass,
    /// Redirect behavior.
    pub redirect: RedirectPolicy,
    /// Whether destination IP literals are permitted at all.
    pub allow_ip_literals: bool,
}

/// Egress policy failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EgressError {
    /// The policy itself is malformed.
    InvalidPolicy,
    /// The request was malformed.
    InvalidRequest,
}

impl Display for EgressError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidPolicy => "invalid_policy",
            Self::InvalidRequest => "invalid_request",
        })
    }
}

impl std::error::Error for EgressError {}

/// One egress request entering the PEP.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct EgressRequest {
    /// Stable purpose code that must match a rule.
    pub purpose: String,
    /// URL scheme, for example `https`.
    pub scheme: String,
    /// Destination host exactly as requested (name or literal).
    pub host: String,
    /// Destination port.
    pub port: u16,
    /// Highest data classification in the payload.
    pub data_class: DataClass,
    /// Taints attached to the payload.
    pub taints: Vec<TaintKind>,
    /// Broker reference when the request carries credentials.
    pub credential_ref: Option<String>,
    /// Planned payload size in bytes.
    pub payload_len: u64,
}

/// Stable denial/allow reasons.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EgressReason {
    /// No rule matched the purpose.
    DefaultDeny,
    /// The scheme is not allowed by the matching rule.
    SchemeDenied,
    /// The host is not allowed by the matching rule.
    HostDenied,
    /// IP literals are not allowed by the matching rule.
    IpLiteralDenied,
    /// The address sits in a blocked range.
    PrivateRangeDenied,
    /// The host names a cloud metadata endpoint.
    MetadataEndpointDenied,
    /// The payload classification exceeds the rule ceiling.
    DataClassExceeded,
    /// The payload carries secret or credential taint.
    TaintedPayload,
    /// A redirect violated the redirect policy.
    RedirectDenied,
    /// A resolved address failed re-validation (DNS rebinding shape).
    ResolutionDenied,
    /// The authorization does not cover this destination.
    AuthorizationMismatch,
    /// Allowed.
    Allow,
}

impl EgressReason {
    /// Stable persisted value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DefaultDeny => "default_deny",
            Self::SchemeDenied => "scheme_denied",
            Self::HostDenied => "host_denied",
            Self::IpLiteralDenied => "ip_literal_denied",
            Self::PrivateRangeDenied => "private_range_denied",
            Self::MetadataEndpointDenied => "metadata_endpoint_denied",
            Self::DataClassExceeded => "data_class_exceeded",
            Self::TaintedPayload => "tainted_payload",
            Self::RedirectDenied => "redirect_denied",
            Self::ResolutionDenied => "resolution_denied",
            Self::AuthorizationMismatch => "authorization_mismatch",
            Self::Allow => "allow",
        }
    }
}

/// Deterministic egress decision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EgressDecision {
    /// Content-derived decision identifier.
    pub decision_id: String,
    /// Decision reason; `allow` means permitted.
    pub reason: EgressReason,
    /// Authorization issued on allow; binds host and validated addresses.
    pub authorization: Option<EgressAuthorization>,
}

/// A PEP-issued connection authorization.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EgressAuthorization {
    /// Stable authorization identifier.
    pub authorization_id: String,
    /// Purpose the authorization is bound to.
    pub purpose: String,
    /// Exact host the authorization covers.
    pub host: String,
    /// Exact port.
    pub port: u16,
    /// The only addresses a transport may connect to; empty while the host
    /// is unresolved (resolution must then be validated first).
    pub allowed_addresses: Vec<IpAddr>,
}

/// The egress policy enforcement point.
pub struct EgressEngine {
    rules: Vec<EgressRule>,
    snapshot_id: String,
    sequence: u64,
}

impl EgressEngine {
    /// Construct and validate a policy snapshot.
    ///
    /// # Errors
    ///
    /// Rejects duplicate purposes, empty destinations, invalid hostnames and
    /// non-literal IP entries.
    pub fn new(sequence: u64, mut rules: Vec<EgressRule>) -> Result<Self, EgressError> {
        rules.sort_by(|left, right| left.purpose.cmp(&right.purpose));
        let mut purposes = std::collections::BTreeSet::new();
        for rule in &rules {
            if !valid_purpose(&rule.purpose)
                || !purposes.insert(rule.purpose.clone())
                || rule.destinations.is_empty()
                || rule.schemes.is_empty()
                || rule.schemes.iter().any(|scheme| {
                    scheme.is_empty()
                        || !scheme
                            .bytes()
                            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                })
            {
                return Err(EgressError::InvalidPolicy);
            }
            for destination in &rule.destinations {
                match destination {
                    DestinationPattern::Domain { host, .. } => {
                        if !valid_host(host) {
                            return Err(EgressError::InvalidPolicy);
                        }
                    }
                    DestinationPattern::IpLiteral { address } => {
                        if address.parse::<IpAddr>().is_err() {
                            return Err(EgressError::InvalidPolicy);
                        }
                    }
                }
            }
        }
        let encoded = serde_json::to_vec(&rules).map_err(|_| EgressError::InvalidPolicy)?;
        let mut hasher = Sha256::new();
        hasher.update(b"saber-egress-v1\0");
        hasher.update(sequence.to_le_bytes());
        hasher.update(encoded);
        let snapshot_id = format!("sha256:{}", hex_upper(&hasher.finalize()));
        Ok(Self {
            rules,
            snapshot_id,
            sequence,
        })
    }

    /// Policy snapshot digest.
    #[must_use]
    pub fn snapshot_id(&self) -> &str {
        &self.snapshot_id
    }

    /// Monotonic sequence of this snapshot.
    #[must_use]
    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    /// Authorize one egress request.
    #[must_use]
    pub fn authorize(&self, request: &EgressRequest) -> EgressDecision {
        let Some(rule) = self
            .rules
            .iter()
            .find(|rule| rule.purpose == request.purpose)
        else {
            return self.decide(request, EgressReason::DefaultDeny, None);
        };
        if !rule.schemes.contains(&request.scheme) {
            return self.decide(request, EgressReason::SchemeDenied, None);
        }
        if request
            .taints
            .iter()
            .any(|taint| matches!(taint, TaintKind::Secret | TaintKind::Credential))
        {
            return self.decide(request, EgressReason::TaintedPayload, None);
        }
        if request.data_class > rule.max_data_class {
            return self.decide(request, EgressReason::DataClassExceeded, None);
        }
        if is_metadata_host(&request.host) {
            return self.decide(request, EgressReason::MetadataEndpointDenied, None);
        }
        let host = canonical_host(&request.host);
        if let Some(literal) = parse_ip_literal(&host) {
            if !rule.allow_ip_literals {
                return self.decide(request, EgressReason::IpLiteralDenied, None);
            }
            if !rule.destination_allows_literal(&literal) {
                return self.decide(request, EgressReason::HostDenied, None);
            }
            if is_blocked_address(&literal) {
                return self.decide(request, EgressReason::PrivateRangeDenied, None);
            }
            return self.allow(request, vec![literal]);
        }
        let matched = rule
            .destinations
            .iter()
            .any(|destination| match destination {
                DestinationPattern::Domain {
                    host: allowed,
                    subdomains,
                } => domain_matches(&host, allowed, *subdomains),
                DestinationPattern::IpLiteral { .. } => false,
            });
        if !matched {
            return self.decide(request, EgressReason::HostDenied, None);
        }
        self.allow(request, Vec::new())
    }

    /// Validate DNS resolution results for an authorization to prevent
    /// rebinding: every address must pass blocked-range checks and the
    /// result becomes the pinned set.
    ///
    /// # Errors
    ///
    /// Returns an [`EgressDecision`] with
    /// [`EgressReason::ResolutionDenied`] when the authorization does not
    /// cover the host, resolution is empty, or any address is blocked.
    #[allow(clippy::result_large_err)]
    pub fn validate_resolution(
        &self,
        authorization: &EgressAuthorization,
        host: &str,
        addresses: &[IpAddr],
    ) -> Result<EgressAuthorization, EgressDecision> {
        let denied = || {
            let mut hasher = Sha256::new();
            hasher.update(self.snapshot_id.as_bytes());
            hasher.update(host.as_bytes());
            EgressDecision {
                decision_id: format!("sha256:{}", hex_upper(&hasher.finalize())),
                reason: EgressReason::ResolutionDenied,
                authorization: None,
            }
        };
        if authorization.host != canonical_host(host) || addresses.is_empty() {
            return Err(denied());
        }
        if addresses.iter().any(is_blocked_address) {
            return Err(denied());
        }
        let mut pinned = authorization.clone();
        pinned.allowed_addresses = addresses.to_vec();
        Ok(pinned)
    }

    /// Decide whether a redirect target may reuse an authorization.
    #[must_use]
    pub fn authorize_redirect(
        &self,
        authorization: &EgressAuthorization,
        next: &EgressRequest,
    ) -> EgressDecision {
        let Some(rule) = self
            .rules
            .iter()
            .find(|rule| rule.purpose == authorization.purpose)
        else {
            return self.decide(next, EgressReason::RedirectDenied, None);
        };
        let same_host = canonical_host(&next.host) == authorization.host;
        match rule.redirect {
            RedirectPolicy::Deny => self.decide(next, EgressReason::RedirectDenied, None),
            RedirectPolicy::SameHost => {
                if !same_host {
                    return self.decide(next, EgressReason::RedirectDenied, None);
                }
                self.authorize(next)
            }
        }
    }

    /// Verify that a connection attempt matches its pinned authorization.
    #[must_use]
    pub fn verify_connection(
        &self,
        authorization: &EgressAuthorization,
        host: &str,
        port: u16,
        address: IpAddr,
    ) -> EgressDecision {
        let matched = authorization.host == canonical_host(host)
            && authorization.port == port
            && (authorization.allowed_addresses.is_empty()
                || authorization.allowed_addresses.contains(&address));
        if !matched || is_blocked_address(&address) {
            self.decide(
                &EgressRequest {
                    purpose: authorization.purpose.clone(),
                    scheme: "https".to_owned(),
                    host: host.to_owned(),
                    port,
                    data_class: DataClass::Public,
                    taints: Vec::new(),
                    credential_ref: None,
                    payload_len: 0,
                },
                EgressReason::AuthorizationMismatch,
                None,
            )
        } else {
            self.allow(
                &EgressRequest {
                    purpose: authorization.purpose.clone(),
                    scheme: "https".to_owned(),
                    host: host.to_owned(),
                    port,
                    data_class: DataClass::Public,
                    taints: Vec::new(),
                    credential_ref: None,
                    payload_len: 0,
                },
                vec![address],
            )
        }
    }

    fn allow(&self, request: &EgressRequest, addresses: Vec<IpAddr>) -> EgressDecision {
        let authorization = EgressAuthorization {
            authorization_id: String::new(),
            purpose: request.purpose.clone(),
            host: canonical_host(&request.host),
            port: request.port,
            allowed_addresses: addresses,
        };
        let mut hasher = Sha256::new();
        hasher.update(self.snapshot_id.as_bytes());
        hasher.update(request.purpose.as_bytes());
        hasher.update(authorization.host.as_bytes());
        hasher.update(request.port.to_le_bytes());
        for address in &authorization.allowed_addresses {
            hasher.update(address.to_string().as_bytes());
        }
        let authorization_id = format!("sha256:{}", hex_upper(&hasher.finalize()));
        let authorization = EgressAuthorization {
            authorization_id,
            ..authorization
        };
        EgressDecision {
            decision_id: authorization.authorization_id.clone(),
            reason: EgressReason::Allow,
            authorization: Some(authorization),
        }
    }

    fn decide(
        &self,
        request: &EgressRequest,
        reason: EgressReason,
        authorization: Option<EgressAuthorization>,
    ) -> EgressDecision {
        let mut hasher = Sha256::new();
        hasher.update(self.snapshot_id.as_bytes());
        hasher.update(request.purpose.as_bytes());
        hasher.update(request.host.as_bytes());
        hasher.update(request.port.to_le_bytes());
        hasher.update([reason as u8]);
        EgressDecision {
            decision_id: format!("sha256:{}", hex_upper(&hasher.finalize())),
            reason,
            authorization,
        }
    }
}

impl EgressRule {
    fn destination_allows_literal(&self, literal: &IpAddr) -> bool {
        self.destinations
            .iter()
            .any(|destination| match destination {
                DestinationPattern::IpLiteral { address } => address
                    .parse::<IpAddr>()
                    .is_ok_and(|allowed| &allowed == literal),
                DestinationPattern::Domain { .. } => false,
            })
    }
}

/// Canonicalize a requested host: lowercase, no trailing dot, no userinfo.
#[must_use]
pub fn canonical_host(host: &str) -> String {
    let trimmed = host.trim();
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    let without_userinfo = without_scheme
        .split('@')
        .next_back()
        .unwrap_or(without_scheme);
    let without_port = without_userinfo
        .split(':')
        .next()
        .unwrap_or(without_userinfo);
    let lowered = without_port.to_ascii_lowercase();
    lowered.strip_suffix('.').unwrap_or(&lowered).to_owned()
}

/// Parse an IP literal including historical integer encodings
/// (`2130706433`, `0x7f000001`, `0177.0.0.1`).
#[must_use]
pub fn parse_ip_literal(input: &str) -> Option<IpAddr> {
    let candidate = input.trim();
    if candidate.is_empty() {
        return None;
    }
    if !candidate.contains(':')
        && let Some(address) = parse_ipv4_literal(candidate)
    {
        return Some(IpAddr::V4(address));
    }
    let bracketed = candidate
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .unwrap_or(candidate);
    if bracketed.contains('%') {
        return None;
    }
    bracketed
        .parse::<IpAddr>()
        .ok()
        .map(|address| match address {
            IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(IpAddr::V6(v6), IpAddr::V4),
            IpAddr::V4(v4) => IpAddr::V4(v4),
        })
}

fn parse_ipv4_literal(input: &str) -> Option<std::net::Ipv4Addr> {
    let parts: Vec<&str> = input.split('.').collect();
    if parts.len() > 4 {
        return None;
    }
    let mut octets = [0_u8; 4];
    let last_index = parts.len() - 1;
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() {
            return None;
        }
        if index == last_index && parts.len() < 4 {
            let value = parse_ip_number(part)?;
            let bytes = value.to_be_bytes();
            let skip = parts.len() - 1;
            for (offset, byte) in bytes.iter().skip(skip).enumerate() {
                octets[index + offset] = *byte;
            }
            break;
        }
        octets[index] = u8::try_from(parse_ip_number(part)?).ok()?;
    }
    Some(std::net::Ipv4Addr::from(octets))
}

fn parse_ip_number(part: &str) -> Option<u32> {
    if let Some(hex) = part.strip_prefix("0x").or_else(|| part.strip_prefix("0X")) {
        return u32::from_str_radix(hex, 16).ok();
    }
    if part.len() > 1 && part.starts_with('0') {
        return u32::from_str_radix(&part[1..], 8).ok();
    }
    part.parse::<u32>().ok()
}

/// Whether an address sits in a range the PEP always blocks.
#[must_use]
pub fn is_blocked_address(address: &IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_documentation()
                || v4.octets()[0] == 100 && v4.octets()[1] & 0xC0 == 64
                || matches!(v4.octets()[0], 0 | 10 | 127 | 169 | 192 | 198 | 203 | 240)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_multicast()
                || v6.is_unspecified()
                || v6.segments()[0] & 0xFE00 == 0xFC00
                || v6.segments()[0] & 0xFFC0 == 0xFE80
                || v6.segments()[0] == 0x0064
                || v6.segments()[0] & 0xFFF8 == 0x20
        }
    }
}

/// Known cloud-metadata host names.
const METADATA_HOSTS: &[&str] = &[
    "metadata.google.internal",
    "metadata",
    "instance-data",
    "169.254.169.254",
    "fd00:ec2::254",
    "100.100.100.200",
];

/// Whether a host names a known cloud metadata endpoint.
#[must_use]
pub fn is_metadata_host(host: &str) -> bool {
    let canonical = canonical_host(host);
    METADATA_HOSTS.contains(&canonical.as_str()) || canonical.ends_with(".metadata.google.internal")
}

fn domain_matches(host: &str, allowed: &str, subdomains: bool) -> bool {
    if host == allowed {
        return true;
    }
    subdomains && host.ends_with(&format!(".{allowed}"))
}

fn valid_purpose(purpose: &str) -> bool {
    !purpose.is_empty()
        && purpose.len() <= 64
        && purpose
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.contains("://")
        && !host.contains('/')
        && !host.contains('\\')
        && !host.contains(' ')
        && host.parse::<IpAddr>().is_err()
}

fn hex_upper(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02X}");
    }
    out
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

    fn engine() -> EgressEngine {
        EgressEngine::new(
            1,
            vec![EgressRule {
                purpose: "model-provider".to_owned(),
                destinations: vec![
                    DestinationPattern::Domain {
                        host: "api.model.example".to_owned(),
                        subdomains: true,
                    },
                    DestinationPattern::Domain {
                        host: "registry.npmjs.org".to_owned(),
                        subdomains: false,
                    },
                ],
                schemes: vec!["https".to_owned()],
                max_data_class: DataClass::Internal,
                redirect: RedirectPolicy::SameHost,
                allow_ip_literals: false,
            }],
        )
        .unwrap_or_else(|error| unreachable!("{error}"))
    }

    fn request(host: &str) -> EgressRequest {
        EgressRequest {
            purpose: "model-provider".to_owned(),
            scheme: "https".to_owned(),
            host: host.to_owned(),
            port: 443,
            data_class: DataClass::Internal,
            taints: Vec::new(),
            credential_ref: None,
            payload_len: 128,
        }
    }

    #[test]
    fn default_deny_without_matching_purpose_or_host() {
        let policy = engine();
        let mut unknown = request("api.model.example");
        unknown.purpose = "exfiltrate".to_owned();
        assert_eq!(policy.authorize(&unknown).reason, EgressReason::DefaultDeny);
        assert_eq!(
            policy.authorize(&request("evil.example")).reason,
            EgressReason::HostDenied
        );
        assert_eq!(
            policy
                .authorize(&request("not-registry.npmjs.org.evil.io"))
                .reason,
            EgressReason::HostDenied
        );
        assert_eq!(
            policy.authorize(&request("eu.api.model.example")).reason,
            EgressReason::Allow
        );
        let mut registry = request("registry.npmjs.org");
        registry.purpose = "model-provider".to_owned();
        assert_eq!(registry_extra(&policy), EgressReason::Allow);
    }

    fn registry_extra(policy: &EgressEngine) -> EgressReason {
        let mut npm = request("registry.npmjs.org");
        npm.purpose = "model-provider".to_owned();
        policy.authorize(&npm).reason
    }

    #[test]
    fn schemes_classification_and_taint_are_enforced() {
        let policy = engine();
        let mut http = request("api.model.example");
        http.scheme = "http".to_owned();
        assert_eq!(policy.authorize(&http).reason, EgressReason::SchemeDenied);
        let mut confidential = request("api.model.example");
        confidential.data_class = DataClass::Confidential;
        assert_eq!(
            policy.authorize(&confidential).reason,
            EgressReason::DataClassExceeded
        );
        let mut tainted = request("api.model.example");
        tainted.taints = vec![TaintKind::Secret];
        assert_eq!(
            policy.authorize(&tainted).reason,
            EgressReason::TaintedPayload
        );
        let mut untrusted = request("api.model.example");
        untrusted.taints = vec![TaintKind::UntrustedSource];
        assert_eq!(policy.authorize(&untrusted).reason, EgressReason::Allow);
    }

    #[test]
    fn ip_literals_and_alternate_encodings_are_blocked() {
        let policy = engine();
        for literal in [
            "127.0.0.1",
            "2130706433",
            "0x7f000001",
            "0177.0.0.1",
            "127.1",
            "10.0.0.5",
            "192.168.1.10",
            "169.254.169.254",
            "0.0.0.0",
            "[::1]",
            "[fe80::1]",
            "[fd12::1]",
            "[::ffff:127.0.0.1]",
        ] {
            assert_ne!(
                policy.authorize(&request(literal)).reason,
                EgressReason::Allow,
                "{literal} must not be allowed"
            );
        }
        assert_eq!(
            policy.authorize(&request("169.254.169.254")).reason,
            EgressReason::MetadataEndpointDenied
        );
        assert_eq!(
            policy
                .authorize(&request("metadata.google.internal"))
                .reason,
            EgressReason::MetadataEndpointDenied
        );
    }

    #[test]
    fn parsing_recognizes_every_literal_encoding() {
        assert_eq!(
            parse_ip_literal("2130706433").map(|value| value.to_string()),
            Some("127.0.0.1".to_owned())
        );
        assert_eq!(
            parse_ip_literal("0x7f.0.0.1").map(|value| value.to_string()),
            Some("127.0.0.1".to_owned())
        );
        assert_eq!(
            parse_ip_literal("0177.0.0.1").map(|value| value.to_string()),
            Some("127.0.0.1".to_owned())
        );
        assert_eq!(
            parse_ip_literal("127.1").map(|value| value.to_string()),
            Some("127.0.0.1".to_owned())
        );
        assert_eq!(
            parse_ip_literal("[::ffff:127.0.0.1]").map(|value| value.to_string()),
            Some("127.0.0.1".to_owned())
        );
        assert!(parse_ip_literal("api.model.example").is_none());
        assert!(parse_ip_literal("[fe80::1%25eth0]").is_none());
    }

    #[test]
    fn blocked_ranges_cover_private_linklocal_and_metadata() {
        for text in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fe80::1",
            "fc00::1",
            "fd00:ec2::254",
        ] {
            let address = text
                .parse::<IpAddr>()
                .unwrap_or_else(|error| unreachable!("{error}"));
            assert!(is_blocked_address(&address), "{text} must be blocked");
        }
        let public = "93.184.216.34"
            .parse::<IpAddr>()
            .unwrap_or_else(|error| unreachable!("{error}"));
        assert!(!is_blocked_address(&public));
    }

    #[test]
    fn dns_rebinding_requires_pinned_revalidation() {
        let policy = engine();
        let decision = policy.authorize(&request("api.model.example"));
        let authorization = decision
            .authorization
            .clone()
            .unwrap_or_else(|| unreachable!("allow must carry authorization"));
        let good = ["93.184.216.34"
            .parse::<IpAddr>()
            .unwrap_or_else(|error| unreachable!("{error}"))];
        let pinned = policy
            .validate_resolution(&authorization, "api.model.example", &good)
            .unwrap_or_else(|error| unreachable!("rebinding check failed: {error:?}"));
        assert_eq!(pinned.allowed_addresses, good.to_vec());
        let rebinding = [
            "93.184.216.34"
                .parse::<IpAddr>()
                .unwrap_or_else(|error| unreachable!("{error}")),
            "127.0.0.1"
                .parse::<IpAddr>()
                .unwrap_or_else(|error| unreachable!("{error}")),
        ];
        assert!(
            policy
                .validate_resolution(&authorization, "api.model.example", &rebinding)
                .is_err()
        );
        assert!(
            policy
                .validate_resolution(&authorization, "evil.example", &good)
                .is_err()
        );
        let verified = policy.verify_connection(&pinned, "api.model.example", 443, good[0]);
        assert_eq!(verified.reason, EgressReason::Allow);
        let stray = policy.verify_connection(
            &pinned,
            "api.model.example",
            443,
            "91.198.44.10"
                .parse::<IpAddr>()
                .unwrap_or_else(|error| unreachable!("{error}")),
        );
        assert_eq!(stray.reason, EgressReason::AuthorizationMismatch);
    }

    #[test]
    fn redirects_follow_policy_and_revalidate() {
        let policy = engine();
        let base = policy.authorize(&request("api.model.example"));
        let authorization = base
            .authorization
            .clone()
            .unwrap_or_else(|| unreachable!("allow must carry authorization"));
        let same = policy.authorize_redirect(&authorization, &request("api.model.example"));
        assert_eq!(same.reason, EgressReason::Allow);
        let cross = policy.authorize_redirect(&authorization, &request("evil.example"));
        assert_eq!(cross.reason, EgressReason::RedirectDenied);
    }

    #[test]
    fn policy_construction_rejects_malformed_rules() {
        assert!(EgressEngine::new(1, Vec::new()).is_ok());
        assert!(
            EgressEngine::new(
                1,
                vec![EgressRule {
                    purpose: "a".to_owned(),
                    destinations: Vec::new(),
                    schemes: vec!["https".to_owned()],
                    max_data_class: DataClass::Public,
                    redirect: RedirectPolicy::Deny,
                    allow_ip_literals: false,
                }],
            )
            .is_err()
        );
        assert!(
            EgressEngine::new(
                1,
                vec![EgressRule {
                    purpose: "Bad Purpose".to_owned(),
                    destinations: vec![DestinationPattern::Domain {
                        host: "api.example".to_owned(),
                        subdomains: false,
                    }],
                    schemes: vec!["https".to_owned()],
                    max_data_class: DataClass::Public,
                    redirect: RedirectPolicy::Deny,
                    allow_ip_literals: false,
                }],
            )
            .is_err()
        );
        assert!(
            EgressEngine::new(
                1,
                vec![EgressRule {
                    purpose: "a".to_owned(),
                    destinations: vec![DestinationPattern::IpLiteral {
                        address: "not-an-ip".to_owned(),
                    }],
                    schemes: vec!["https".to_owned()],
                    max_data_class: DataClass::Public,
                    redirect: RedirectPolicy::Deny,
                    allow_ip_literals: true,
                }],
            )
            .is_err()
        );
    }
}
