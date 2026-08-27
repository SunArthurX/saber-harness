//! Provider descriptors and the translation-only `ModelProvider` trait.

use saber_policy::DataClass;
use serde::{Deserialize, Serialize};

use crate::spi::{ModelError, ModelRequest, ModelResponse, StreamEvent, WireRequest, WireResponse};

/// Wire protocol family an adapter speaks.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiFamily {
    /// OpenAI-compatible chat/completions.
    OpenAiCompatible,
    /// Anthropic messages API.
    AnthropicCompatible,
    /// Ollama native API.
    Ollama,
}

/// Where a provider may process data.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Residency {
    /// Any region the tenant policy admits.
    Global,
    /// Must stay within the tenant's region.
    Regional,
    /// Must execute on the local device.
    OnDevice,
}

/// Capabilities a provider/model combination reports.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct Capabilities {
    /// Server-sent streaming.
    pub streaming: bool,
    /// Tool calling.
    pub tools: bool,
    /// Structured (schema-constrained) output.
    pub structured: bool,
}

impl Capabilities {
    /// Whether this set covers a required set.
    #[must_use]
    pub const fn covers(&self, required: &Self) -> bool {
        (!required.streaming || self.streaming)
            && (!required.tools || self.tools)
            && (!required.structured || self.structured)
    }
}

/// Cost per million tokens, in micro-currency units for determinism.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CostProfile {
    /// Input cost per million tokens.
    pub input_per_mtok: u64,
    /// Output cost per million tokens.
    pub output_per_mtok: u64,
}

impl CostProfile {
    /// Deterministic estimated cost of a usage record in micro-units.
    #[must_use]
    pub fn estimate_micro(&self, usage: &crate::spi::UsageRecord) -> u128 {
        let input = u128::from(usage.input_tokens) * u128::from(self.input_per_mtok);
        let output = u128::from(usage.output_tokens) * u128::from(self.output_per_mtok);
        (input + output) / 1_000_000
    }
}

/// Endpoint a provider is reached at; feeds the S06 Egress PEP.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct EndpointSpec {
    /// HTTPS host.
    pub host: String,
    /// Port (443 for cloud providers).
    pub port: u16,
    /// Path prefix for the API.
    pub path_prefix: String,
}

/// One registered model offering.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ModelEntry {
    /// Stable model identifier.
    pub model_id: String,
    /// Owning provider identifier.
    pub provider_id: String,
    /// Wire family.
    pub family: ApiFamily,
    /// Endpoint for this model.
    pub endpoint: EndpointSpec,
    /// Reported capabilities.
    pub capabilities: Capabilities,
    /// Highest data classification this model may see.
    pub max_data_class: DataClass,
    /// Residency constraint.
    pub residency: Residency,
    /// Quality tier (higher is better).
    pub quality_tier: u8,
    /// Cost profile.
    pub cost: CostProfile,
    /// Context window in tokens.
    pub context_tokens: u32,
}

/// Identity of one adapter.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderDescriptor {
    /// Stable provider identifier.
    pub provider_id: String,
    /// Wire family.
    pub family: ApiFamily,
    /// SPI version implemented.
    pub spi_version: String,
    /// Header channel for credential lease injection.
    pub credential_header: &'static str,
}

/// Translation-only provider contract (ADR-010). Implementations perform no
/// I/O; the transport is invoked by the invoker with a PEP authorization.
pub trait ModelProvider {
    /// Adapter identity.
    fn descriptor(&self) -> &ProviderDescriptor;

    /// Translate a typed request into wire form.
    ///
    /// # Errors
    ///
    /// [`ModelError::InvalidRequest`] for shapes the family cannot express.
    fn translate(&self, request: &ModelRequest) -> Result<WireRequest, ModelError>;

    /// Parse a wire response into typed form. Success without usable usage
    /// is [`ModelError::Provider`].
    ///
    /// # Errors
    ///
    /// Typed model error for malformed or unusable payloads.
    fn parse_response(&self, wire: &WireResponse) -> Result<ModelResponse, ModelError>;

    /// Parse one streaming chunk into zero or more events.
    ///
    /// # Errors
    ///
    /// Typed model error for malformed chunks.
    fn parse_stream_chunk(&self, chunk: &str) -> Result<Vec<StreamEvent>, ModelError>;
}

/// Shared success-shape check: a 2xx body without meaningful usage is a
/// forged or unusable success and must not surface as success.
pub(crate) fn require_success_payload(
    status: u16,
    usage: Option<crate::spi::UsageRecord>,
) -> Result<(), ModelError> {
    if !(200..300).contains(&status) {
        return Err(map_status(status));
    }
    match usage {
        Some(usage) if usage.is_meaningful() => Ok(()),
        _ => Err(ModelError::Provider),
    }
}

/// Map an HTTP status onto a typed model error.
#[must_use]
pub fn map_status(status: u16) -> ModelError {
    match status {
        400 | 404 | 413 | 422 => ModelError::InvalidRequest,
        401 | 403 => ModelError::Auth,
        408 | 409 | 429 => ModelError::RateLimited,
        500..=599 => ModelError::Transport,
        _ => ModelError::Provider,
    }
}
