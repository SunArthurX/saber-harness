//! PEP-authorized transport and the model invoker (ADR-010).
//!
//! Every network call requires an [`EgressAuthorization`] issued by the S06
//! Egress PEP: an adapter that never obtained one has no code path to the
//! network. Credentials reach the transport exclusively as secret-broker
//! lease material.

use std::collections::BTreeMap;

use saber_egress::{EgressEngine, EgressReason, EgressRequest};
use saber_policy::DataClass;
use saber_secret_broker::{BrokerError, Channel, LeaseRequest, SecretBroker};

use crate::budget::{RetryPolicy, TaskBudget};
use crate::provider::{ModelProvider, Residency};
use crate::registry::ModelRegistry;
use crate::router::{ModelRouter, RouteError, RouteRequest};
use crate::spi::{
    MODEL_EGRESS_PURPOSE, ModelError, ModelRequest, ModelResponse, WireRequest, WireResponse,
};

/// The only network boundary of the model layer.
pub trait ModelTransport {
    /// Execute one wire request under a PEP authorization. Credential
    /// material is injected here, never serialized into the wire body.
    ///
    /// # Errors
    ///
    /// Typed model error; transports map transport failures themselves.
    fn execute(
        &mut self,
        authorization: &saber_egress::EgressAuthorization,
        request: &WireRequest,
        credential: Option<&saber_secret_broker::LeaseMaterial>,
    ) -> Result<WireResponse, ModelError>;

    /// Number of executed calls (for zero-effect assertions).
    fn call_count(&self) -> u64;
}

/// Invocation failures beyond [`ModelError`].
#[derive(Debug)]
pub enum InvokeError {
    /// Routing refused the request.
    Route(RouteError),
    /// The egress PEP denied the destination.
    EgressDenied(EgressReason),
    /// The secret broker refused a lease.
    Secret(BrokerError),
    /// The provider failed after bounded retries.
    Model(ModelError),
}

/// The model invoker: route, authorize egress, lease credentials, execute
/// through the transport and verify usage evidence.
pub struct ModelInvoker<'providers> {
    registry: ModelRegistry,
    egress: EgressEngine,
    secrets: SecretBroker,
    providers: &'providers BTreeMap<String, Box<dyn ModelProvider>>,
    retries: RetryPolicy,
}

impl<'providers> ModelInvoker<'providers> {
    /// Compose an invoker over one registry snapshot and provider set.
    #[must_use]
    pub fn new(
        registry: ModelRegistry,
        egress: EgressEngine,
        secrets: SecretBroker,
        providers: &'providers BTreeMap<String, Box<dyn ModelProvider>>,
    ) -> Self {
        Self {
            registry,
            egress,
            secrets,
            providers,
            retries: RetryPolicy::default_policy(),
        }
    }

    /// Mutable secret-broker access for out-of-band registration.
    #[must_use]
    pub fn secrets_mut(&mut self) -> &mut SecretBroker {
        &mut self.secrets
    }

    /// Mutable registry access for monotonic updates.
    #[must_use]
    pub fn registry_mut(&mut self) -> &mut ModelRegistry {
        &mut self.registry
    }

    /// Invoke one request end to end with bounded idempotent retries.
    ///
    /// # Errors
    ///
    /// Every variant guarantees zero or verified effects: a denied route or
    /// egress decision executes zero transport calls.
    pub fn invoke(
        &mut self,
        request: &ModelRequest,
        residency: Residency,
        excluded: &[String],
        budget: &mut TaskBudget,
        transport: &mut dyn ModelTransport,
        now_ms: u64,
    ) -> Result<ModelResponse, InvokeError> {
        request.validate().map_err(InvokeError::Model)?;
        let record = self
            .registry
            .get(&request.model)
            .ok_or(InvokeError::Route(RouteError::NoAdmissibleProvider))?;
        let router = ModelRouter::new(&self.registry);
        let decision = router
            .route(&RouteRequest {
                data_class: request.data_class,
                residency,
                required: record.entry.capabilities,
                budget_remaining_tokens: budget.remaining(),
                estimated_tokens: estimate_tokens(request),
                excluded: excluded.to_vec(),
            })
            .map_err(InvokeError::Route)?;
        if decision.model_id != request.model {
            // The router may only confirm or refuse the requested model;
            // silent substitution is a policy bypass.
            return Err(InvokeError::Route(RouteError::NoAdmissibleProvider));
        }

        // Egress authorization before any transport contact.
        let egress_request = EgressRequest {
            purpose: MODEL_EGRESS_PURPOSE.to_owned(),
            scheme: "https".to_owned(),
            host: record.entry.endpoint.host.clone(),
            port: record.entry.endpoint.port,
            data_class: request.data_class,
            taints: Vec::new(),
            credential_ref: None,
            payload_len: 0,
        };
        let authorization = self
            .egress
            .authorize(&egress_request)
            .authorization
            .clone()
            .ok_or(InvokeError::EgressDenied(EgressReason::DefaultDeny))?;

        // Credential lease bound to this exact request id.
        let provider = self
            .providers
            .get(&record.entry.provider_id)
            .ok_or(InvokeError::Route(RouteError::NoAdmissibleProvider))?;
        let wire = provider.translate(request).map_err(InvokeError::Model)?;
        let credential = if provider.descriptor().credential_header.is_empty() {
            None
        } else {
            let lease = self
                .secrets
                .issue(
                    &LeaseRequest {
                        credential_ref: format!(
                            "credential://broker/provider-{}",
                            record.entry.provider_id
                        ),
                        request_digest: digest_of(&request.request_id),
                        channels: vec![Channel::EnvVar(
                            provider.descriptor().credential_header.to_owned(),
                        )],
                        purpose: MODEL_EGRESS_PURPOSE.to_owned(),
                        expires_at_ms: now_ms + 60_000,
                    },
                    now_ms,
                )
                .map_err(InvokeError::Secret)?;
            Some(
                self.secrets
                    .consume(&lease.lease_id, &digest_of(&request.request_id), now_ms)
                    .map_err(InvokeError::Secret)?,
            )
        };

        // Bounded idempotent retries: only retryable classes, same request id.
        let mut attempts = 0_u32;
        loop {
            match transport.execute(&authorization, &wire, credential.as_ref()) {
                Ok(wire_response) => {
                    let response = provider
                        .parse_response(&wire_response)
                        .map_err(InvokeError::Model)?;
                    budget
                        .consume(&response.usage)
                        .map_err(InvokeError::Model)?;
                    return Ok(response);
                }
                Err(error) => {
                    if self.retries.permits(error, attempts) {
                        attempts += 1;
                        continue;
                    }
                    return Err(InvokeError::Model(error));
                }
            }
        }
    }
}

fn estimate_tokens(request: &ModelRequest) -> u64 {
    let input: usize = request.messages.iter().map(|m| m.text.len()).sum();
    u64::try_from(input / 4).unwrap_or(1).max(1) + u64::from(request.max_output_tokens)
}

fn digest_of(request_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(request_id.as_bytes());
    format!("sha256:{}", saber_sandbox::hex_upper(&hasher.finalize()))
}

/// Data-classification helper used by callers building route requests.
#[must_use]
pub fn route_request_for(
    data_class: DataClass,
    residency: Residency,
    required: crate::provider::Capabilities,
    budget: &TaskBudget,
    estimated_tokens: u64,
    excluded: Vec<String>,
) -> RouteRequest {
    RouteRequest {
        data_class,
        residency,
        required,
        budget_remaining_tokens: budget.remaining(),
        estimated_tokens,
        excluded,
    }
}
