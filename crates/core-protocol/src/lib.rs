//! Versioned, bounded and idempotent local control protocol primitives.

mod generated;

use std::collections::HashMap;
use std::error::Error;
use std::fmt::{Display, Formatter};

pub use generated::*;

/// Current wire version.
pub const PROTOCOL_VERSION: &str = "1.0.0";
/// Explicitly supported N-1 wire version.
pub const PREVIOUS_PROTOCOL_VERSION: &str = "0.1.0";
/// Maximum accepted JSON frame size (1 MiB).
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

/// Returns whether the peer is exactly N or N-1 compatible.
#[must_use]
pub fn is_compatible(peer_version: &str) -> bool {
    matches!(peer_version, PROTOCOL_VERSION | PREVIOUS_PROTOCOL_VERSION)
}

/// Deterministic protocol rejection categories.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProtocolError {
    /// Input exceeded the configured frame bound.
    FrameTooLarge,
    /// Input was not valid JSON.
    InvalidJson,
    /// JSON did not match the closed request envelope.
    InvalidRequest,
    /// JSON-RPC version was not 2.0.
    InvalidJsonRpcVersion,
    /// Protocol version was outside N/N-1.
    IncompatibleProtocol,
    /// Method was not in the closed method registry.
    UnknownMethod,
    /// Request deadline has elapsed.
    DeadlineExceeded,
    /// A mutation omitted its idempotency key.
    IdempotencyRequired,
    /// An idempotency key was reused for a different request.
    IdempotencyConflict,
    /// Workspace identifier cannot form a local endpoint.
    InvalidWorkspaceId,
    /// The one-time bootstrap token was missing, wrong or already used.
    Unauthorized,
}

impl Display for ProtocolError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.code())
    }
}

impl Error for ProtocolError {}

impl ProtocolError {
    /// Stable machine-readable error code.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::FrameTooLarge => "frame_too_large",
            Self::InvalidJson => "invalid_json",
            Self::InvalidRequest => "invalid_request",
            Self::InvalidJsonRpcVersion => "invalid_jsonrpc_version",
            Self::IncompatibleProtocol => "incompatible_protocol",
            Self::UnknownMethod => "unknown_method",
            Self::DeadlineExceeded => "deadline_exceeded",
            Self::IdempotencyRequired => "idempotency_required",
            Self::IdempotencyConflict => "idempotency_conflict",
            Self::InvalidWorkspaceId => "invalid_workspace_id",
            Self::Unauthorized => "unauthorized",
        }
    }
}

fn is_mutation(method: &ControlMethod) -> bool {
    !matches!(
        method,
        ControlMethod::EventsSubscribe | ControlMethod::CoreInitialize | ControlMethod::CoreHealth
    )
}

/// Decode and validate a bounded control request.
///
/// # Errors
///
/// Returns a stable [`ProtocolError`] for frame, JSON, version, method, deadline or idempotency violations.
pub fn decode_request(frame: &[u8], now_unix_ms: u64) -> Result<ControlRequest, ProtocolError> {
    if frame.len() > MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge);
    }
    let raw: serde_json::Value =
        serde_json::from_slice(frame).map_err(|_| ProtocolError::InvalidJson)?;
    let method = raw.get("method").and_then(serde_json::Value::as_str);
    if method.is_some_and(|value| {
        !matches!(
            value,
            "run.steer"
                | "run.cancel"
                | "run.retry"
                | "run.fork"
                | "run.start"
                | "run.pause"
                | "run.resume"
                | "goal.create"
                | "plan.freeze"
                | "approval.resolve"
                | "events.subscribe"
                | "core.initialize"
                | "core.health"
        )
    }) {
        return Err(ProtocolError::UnknownMethod);
    }
    let request: ControlRequest =
        serde_json::from_value(raw).map_err(|_| ProtocolError::InvalidRequest)?;
    if request.jsonrpc != "2.0" {
        return Err(ProtocolError::InvalidJsonRpcVersion);
    }
    if !is_compatible(&request.protocol_version) {
        return Err(ProtocolError::IncompatibleProtocol);
    }
    if request.context.deadline_unix_ms < now_unix_ms {
        return Err(ProtocolError::DeadlineExceeded);
    }
    if is_mutation(&request.method)
        && request
            .context
            .idempotency_key
            .as_deref()
            .is_none_or(str::is_empty)
    {
        return Err(ProtocolError::IdempotencyRequired);
    }
    Ok(request)
}

/// Result of registering a mutation request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdempotencyOutcome {
    /// Key was registered for the first time.
    Accepted,
    /// The exact request was already registered.
    Replayed,
}

/// Process-local contract primitive; S04 persists the same semantics transactionally.
#[derive(Default)]
pub struct IdempotencyLedger {
    requests: HashMap<String, Vec<u8>>,
}

impl IdempotencyLedger {
    /// Register a mutation or identify an exact replay.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::IdempotencyRequired`] for a missing key and
    /// [`ProtocolError::IdempotencyConflict`] when the key names different content.
    pub fn register(
        &mut self,
        request: &ControlRequest,
    ) -> Result<IdempotencyOutcome, ProtocolError> {
        let key = request
            .context
            .idempotency_key
            .as_ref()
            .filter(|value| !value.is_empty())
            .ok_or(ProtocolError::IdempotencyRequired)?;
        let canonical = serde_json::to_vec(request).map_err(|_| ProtocolError::InvalidRequest)?;
        match self.requests.get(key) {
            Some(previous) if previous == &canonical => Ok(IdempotencyOutcome::Replayed),
            Some(_) => Err(ProtocolError::IdempotencyConflict),
            None => {
                self.requests.insert(key.clone(), canonical);
                Ok(IdempotencyOutcome::Accepted)
            }
        }
    }
}

/// Supported desktop transport families.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopPlatform {
    /// macOS and Linux Unix-domain socket.
    Unix,
    /// Windows named pipe.
    Windows,
}

/// Build the local-only transport endpoint for a workspace.
///
/// # Errors
///
/// Returns [`ProtocolError::InvalidWorkspaceId`] when the identifier is not safe for a local endpoint.
pub fn transport_address(
    platform: DesktopPlatform,
    workspace_id: &str,
) -> Result<String, ProtocolError> {
    if workspace_id.is_empty()
        || !workspace_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-'))
    {
        return Err(ProtocolError::InvalidWorkspaceId);
    }
    Ok(match platform {
        DesktopPlatform::Unix => format!("/tmp/saber-{workspace_id}.sock"),
        DesktopPlatform::Windows => format!(r"\\.\pipe\saber-{workspace_id}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTROL_FIXTURE: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../schemas/fixtures/v1/control-request.json"
    ));
    const DOMAIN_FIXTURE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../schemas/fixtures/v1/domain-roundtrip.json"
    ));

    #[test]
    fn accepts_current_and_previous_only() {
        assert!(is_compatible(PROTOCOL_VERSION));
        assert!(is_compatible(PREVIOUS_PROTOCOL_VERSION));
        assert!(!is_compatible("999.0.0"));
    }

    #[test]
    fn control_fixture_round_trips_and_is_idempotent() -> Result<(), Box<dyn Error>> {
        let request = decode_request(CONTROL_FIXTURE, 0)?;
        let encoded = serde_json::to_vec(&request)?;
        assert_eq!(decode_request(&encoded, 0)?, request);
        let mut ledger = IdempotencyLedger::default();
        assert_eq!(ledger.register(&request)?, IdempotencyOutcome::Accepted);
        assert_eq!(ledger.register(&request)?, IdempotencyOutcome::Replayed);
        let mut conflicting = request.clone();
        conflicting.params = serde_json::json!({"run_id": "run_02"});
        assert_eq!(
            ledger.register(&conflicting),
            Err(ProtocolError::IdempotencyConflict)
        );
        Ok(())
    }

    #[test]
    fn domain_fixture_round_trips_every_entity() -> Result<(), Box<dyn Error>> {
        let fixture: serde_json::Value = serde_json::from_str(DOMAIN_FIXTURE)?;
        macro_rules! round_trip {
            ($key:literal, $type:ty) => {{
                let source = fixture
                    .get($key)
                    .cloned()
                    .ok_or(ProtocolError::InvalidRequest)?;
                let typed: $type = serde_json::from_value(source.clone())?;
                assert_eq!(serde_json::to_value(typed)?, source);
            }};
        }
        round_trip!("workspace", Workspace);
        round_trip!("goal", Goal);
        round_trip!("task", Task);
        round_trip!("run", Run);
        round_trip!("artifact", Artifact);
        round_trip!("decision", Decision);
        round_trip!("memory", Memory);
        round_trip!("capability", Capability);
        round_trip!("incident", Incident);
        round_trip!("evolution_candidate", EvolutionCandidate);
        round_trip!("event", EventEnvelope);
        Ok(())
    }

    #[test]
    fn violations_fail_deterministically() -> Result<(), Box<dyn Error>> {
        assert_eq!(
            decode_request(&vec![0; MAX_FRAME_BYTES + 1], 0),
            Err(ProtocolError::FrameTooLarge)
        );
        let mut value: serde_json::Value = serde_json::from_slice(CONTROL_FIXTURE)?;
        value["method"] = serde_json::Value::String("run.destroy".to_owned());
        assert_eq!(
            decode_request(&serde_json::to_vec(&value)?, 0),
            Err(ProtocolError::UnknownMethod)
        );
        value["method"] = serde_json::Value::String("run.cancel".to_owned());
        value["context"]["deadline_unix_ms"] = serde_json::Value::from(1);
        assert_eq!(
            decode_request(&serde_json::to_vec(&value)?, 2),
            Err(ProtocolError::DeadlineExceeded)
        );
        let mut domain: serde_json::Value = serde_json::from_str(DOMAIN_FIXTURE)?;
        domain["run"]["state"] = serde_json::Value::String("invented".to_owned());
        assert!(serde_json::from_value::<Run>(domain["run"].clone()).is_err());
        Ok(())
    }

    #[test]
    fn malformed_frames_never_escape_as_success() {
        for length in 0_usize..512 {
            let frame: Vec<u8> = (0_u8..=u8::MAX)
                .cycle()
                .take(length)
                .map(|value| value.wrapping_mul(31))
                .collect();
            assert!(decode_request(&frame, 0).is_err());
        }
    }

    #[test]
    fn transport_is_platform_specific_and_workspace_bounded() -> Result<(), Box<dyn Error>> {
        assert_eq!(
            transport_address(DesktopPlatform::Unix, "ws_01")?,
            "/tmp/saber-ws_01.sock"
        );
        assert_eq!(
            transport_address(DesktopPlatform::Windows, "ws_01")?,
            r"\\.\pipe\saber-ws_01"
        );
        assert_eq!(
            transport_address(DesktopPlatform::Unix, "../escape"),
            Err(ProtocolError::InvalidWorkspaceId)
        );
        Ok(())
    }
}
