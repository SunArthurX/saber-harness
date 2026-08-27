//! Versioned `ModelProvider` SPI: typed requests, streaming, tool calls,
//! structured output, usage accounting, cancellation, typed errors with
//! retryability and per-request data-policy declarations (ADR-010).

use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use saber_policy::DataClass;
use serde::{Deserialize, Serialize};

/// SPI contract version implemented by this crate.
pub const MODEL_SPI_VERSION: &str = "1.0.0";

/// Stable purpose code every model egress request must carry.
pub const MODEL_EGRESS_PURPOSE: &str = "model-provider";

/// Conversation role.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// Instruction context.
    System,
    /// User or tool-result input.
    User,
    /// Model output.
    Assistant,
    /// Tool result payload.
    Tool,
}

/// One conversation message.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ModelMessage {
    /// Authoring role.
    pub role: Role,
    /// Text content.
    pub text: String,
    /// Tool-call identifier this message answers, for tool results.
    pub tool_call_id: Option<String>,
    /// Name of the tool that produced a tool result.
    pub tool_name: Option<String>,
}

/// A declared callable tool.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ToolDeclaration {
    /// Stable tool name.
    pub name: String,
    /// JSON-schema description of the arguments.
    pub schema: serde_json::Value,
}

/// A model-emitted tool call.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ToolCall {
    /// Provider-issued call identifier.
    pub id: String,
    /// Tool name.
    pub name: String,
    /// Raw JSON arguments text (validated by the caller).
    pub arguments: String,
}

/// Structured-output declaration.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StructuredOutput {
    /// JSON schema the response must satisfy.
    pub schema: serde_json::Value,
}

/// Token usage record. Success without usable usage is rejected.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct UsageRecord {
    /// Prompt tokens billed.
    pub input_tokens: u64,
    /// Completion tokens billed.
    pub output_tokens: u64,
    /// Cached prompt tokens, if reported.
    pub cached_tokens: Option<u64>,
}

impl UsageRecord {
    /// Total tokens for budget accounting.
    #[must_use]
    pub const fn total(&self) -> u64 {
        self.input_tokens + self.output_tokens
    }

    /// Whether the record carries any billable signal.
    #[must_use]
    pub const fn is_meaningful(&self) -> bool {
        self.input_tokens > 0 || self.output_tokens > 0
    }
}

/// Why generation stopped.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    /// Natural stop.
    Stop,
    /// The model requested a tool call.
    ToolCall,
    /// Token limit reached.
    Length,
    /// Provider content filter triggered.
    ContentFilter,
}

/// One streaming event.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum StreamEvent {
    /// Stream opened against a model.
    MessageStart {
        /// Model identifier reported by the provider.
        model: String,
    },
    /// Incremental assistant text.
    TextDelta {
        /// Text fragment.
        delta: String,
    },
    /// Incremental tool-call arguments.
    ToolCallDelta {
        /// Call index within the response.
        index: usize,
        /// Call identifier when first seen.
        id: Option<String>,
        /// Tool name when first seen.
        name: Option<String>,
        /// Argument fragment.
        arguments_delta: String,
    },
    /// Usage accounting event (required before a terminal event).
    Usage {
        /// Provider-reported usage.
        usage: UsageRecord,
    },
    /// Terminal success event.
    Done {
        /// Finish reason.
        finish: FinishReason,
    },
}

/// Typed model-layer errors with retryability.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelError {
    /// Transport-level failure (retryable).
    Transport,
    /// Authentication or permission rejected (terminal).
    Auth,
    /// Rate limited (retryable with backoff).
    RateLimited,
    /// The request was malformed (terminal).
    InvalidRequest,
    /// Provider-side failure or forged/unusable success payload (terminal).
    Provider,
    /// The stream aborted before a terminal event (retryable).
    StreamAborted,
    /// The task budget was exhausted (terminal for this task).
    BudgetExhausted,
    /// Routing found no admissible provider (terminal).
    NoProvider,
}

impl ModelError {
    /// Whether an automatic bounded retry may be attempted.
    #[must_use]
    pub const fn retryable(self) -> bool {
        matches!(
            self,
            Self::Transport | Self::RateLimited | Self::StreamAborted
        )
    }
}

impl Display for ModelError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Transport => "transport",
            Self::Auth => "auth",
            Self::RateLimited => "rate_limited",
            Self::InvalidRequest => "invalid_request",
            Self::Provider => "provider",
            Self::StreamAborted => "stream_aborted",
            Self::BudgetExhausted => "budget_exhausted",
            Self::NoProvider => "no_provider",
        })
    }
}

impl std::error::Error for ModelError {}

/// A complete non-streaming model response.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ModelResponse {
    /// Assistant text (possibly empty when tool calls dominate).
    pub text: String,
    /// Tool calls the model requested.
    pub tool_calls: Vec<ToolCall>,
    /// Why generation stopped.
    pub finish: FinishReason,
    /// Usage evidence; a success without it was already rejected.
    pub usage: UsageRecord,
    /// Model that served the request.
    pub model: String,
}

/// One typed model request with its data-policy declaration.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ModelRequest {
    /// Stable idempotency identifier.
    pub request_id: String,
    /// Target model identifier.
    pub model: String,
    /// Conversation so far.
    pub messages: Vec<ModelMessage>,
    /// Declared callable tools.
    pub tools: Vec<ToolDeclaration>,
    /// Structured-output constraint.
    pub structured: Option<StructuredOutput>,
    /// Maximum completion tokens.
    pub max_output_tokens: u32,
    /// Sampling temperature.
    pub temperature: f32,
    /// Whether streaming is requested.
    pub stream: bool,
    /// Highest data classification in the payload.
    pub data_class: DataClass,
}

impl ModelRequest {
    /// Validate the request shape.
    ///
    /// # Errors
    ///
    /// Rejects empty models, empty conversations and malformed tool names.
    pub fn validate(&self) -> Result<(), ModelError> {
        if self.request_id.is_empty()
            || self.model.is_empty()
            || self.messages.is_empty()
            || self.max_output_tokens == 0
            || self.tools.iter().any(|tool| {
                tool.name.is_empty()
                    || tool.name.len() > 128
                    || tool
                        .name
                        .bytes()
                        .any(|byte| !(byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')))
            })
        {
            return Err(ModelError::InvalidRequest);
        }
        Ok(())
    }
}

/// A wire-level HTTP request produced by an adapter. Credential values are
/// redacted: they never render in debug output or logs.
#[derive(Clone, Eq, PartialEq)]
pub struct WireRequest {
    /// Request path including query.
    pub path: String,
    /// Header names to credential-free values.
    pub headers: BTreeMap<String, String>,
    /// Credential header channel carrying lease material.
    pub credential_header: Option<(String, saber_sandbox::RedactableValue)>,
    /// Canonical JSON body.
    pub body: serde_json::Value,
}

impl std::fmt::Debug for WireRequest {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WireRequest")
            .field("path", &self.path)
            .field("headers", &self.headers)
            .field(
                "credential_header",
                &self
                    .credential_header
                    .as_ref()
                    .map(|(name, _)| format!("{name}: [redacted]")),
            )
            .field("body", &"[redacted-body]")
            .finish()
    }
}

/// A wire-level HTTP response consumed by an adapter.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WireResponse {
    /// HTTP status code.
    pub status: u16,
    /// Canonical JSON body (empty object when none).
    pub body: serde_json::Value,
}

/// Cancellation outcome of a budget-guarded stream.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct StreamOutcome {
    /// Accumulated assistant text.
    pub text: String,
    /// Accumulated tool calls in call order.
    pub tool_calls: Vec<ToolCall>,
    /// Finish reason when the stream completed.
    pub finish: Option<FinishReason>,
    /// Usage evidence accumulated before termination.
    pub usage: UsageRecord,
    /// Whether the stream was cancelled by budget exhaustion.
    pub cancelled: bool,
    /// Terminal error class when the stream failed.
    pub error: Option<ModelError>,
}
