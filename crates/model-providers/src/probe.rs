//! Capability probes: evidence-based routing health (ADR-010).
//!
//! A probe issues tiny PEP-authorized requests through the transport and
//! records which capabilities actually worked. Probe-failing providers are
//! excluded from routing regardless of their declared capabilities.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::invoker::ModelTransport;
use crate::provider::{ModelProvider, ProviderDescriptor};
use crate::spi::{
    ModelError, ModelMessage, ModelRequest, Role, ToolDeclaration, UsageRecord, WireResponse,
};

/// One probe outcome.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProbeReport {
    /// Probed model id.
    pub model_id: String,
    /// Whether a minimal completion succeeded with usage evidence.
    pub basic_ok: bool,
    /// Whether a streamed chunk parsed with a terminal event.
    pub streaming_ok: bool,
    /// Whether a tool declaration round-tripped.
    pub tools_ok: bool,
    /// Terminal error of the last failing stage, if any.
    pub error: Option<ModelError>,
}

impl ProbeReport {
    /// Whether this report certifies the given capability set.
    #[must_use]
    pub const fn certifies(&self, required: &crate::provider::Capabilities) -> bool {
        self.basic_ok
            && (!required.streaming || self.streaming_ok)
            && (!required.tools || self.tools_ok)
    }
}

/// Model ids whose probe reports failed a required capability.
#[must_use]
pub fn exclusions_from_reports(
    reports: &BTreeMap<String, ProbeReport>,
    required: &crate::provider::Capabilities,
) -> Vec<String> {
    reports
        .iter()
        .filter(|(_, report)| !report.certifies(required))
        .map(|(model_id, _)| model_id.clone())
        .collect()
}

/// Probe one model through a PEP-authorized transport.
///
/// # Errors
///
/// Transport errors surface inside the report, not as a function failure:
/// a failed probe is routing evidence, not a caller error.
pub fn probe_model(
    model_id: &str,
    provider: &dyn ModelProvider,
    transport: &mut dyn ModelTransport,
    authorization: &saber_egress::EgressAuthorization,
) -> ProbeReport {
    let mut report = ProbeReport {
        model_id: model_id.to_owned(),
        basic_ok: false,
        streaming_ok: false,
        tools_ok: false,
        error: None,
    };
    let base = || ModelRequest {
        request_id: format!("probe-{model_id}"),
        model: model_id.to_owned(),
        messages: vec![ModelMessage {
            role: Role::User,
            text: "ping".to_owned(),
            tool_call_id: None,
            tool_name: None,
        }],
        tools: Vec::new(),
        structured: None,
        max_output_tokens: 8,
        temperature: 0.0,
        stream: false,
        data_class: saber_policy::DataClass::Public,
    };

    // Stage 1: minimal completion with usage evidence.
    let wire = match provider.translate(&base()) {
        Ok(wire) => wire,
        Err(error) => {
            report.error = Some(error);
            return report;
        }
    };
    match transport.execute(authorization, &wire, None) {
        Ok(response) => match provider.parse_response(&response) {
            Ok(parsed) if parsed.usage.is_meaningful() => report.basic_ok = true,
            Ok(_) => report.error = Some(ModelError::Provider),
            Err(error) => report.error = Some(error),
        },
        Err(error) => report.error = Some(error),
    }
    if !report.basic_ok {
        return report;
    }

    // Stage 2: streaming parses with a terminal event.
    let mut streamed = base();
    streamed.stream = true;
    if let Ok(wire) = provider.translate(&streamed)
        && let Ok(response) = transport.execute(authorization, &wire, None)
    {
        let body = wire_body_text(&response);
        match provider.parse_stream_chunk(&body) {
            Ok(events) => {
                report.streaming_ok = events
                    .iter()
                    .any(|event| matches!(event, crate::spi::StreamEvent::Done { .. }))
                    && events
                        .iter()
                        .any(|event| matches!(event, crate::spi::StreamEvent::Usage { .. }));
            }
            Err(error) => report.error = Some(error),
        }
    }

    // Stage 3: tool declaration round-trip.
    let mut tooled = base();
    tooled.tools = vec![ToolDeclaration {
        name: "probe_noop".to_owned(),
        schema: serde_json::json!({"type": "object", "properties": {}}),
    }];
    match provider.translate(&tooled) {
        Ok(wire) => match transport.execute(authorization, &wire, None) {
            Ok(response) => {
                report.tools_ok = provider
                    .parse_response(&response)
                    .is_ok_and(|parsed| parsed.usage.is_meaningful());
            }
            Err(error) => report.error = Some(error),
        },
        Err(error) => report.error = Some(error),
    }
    report
}

fn wire_body_text(response: &WireResponse) -> String {
    match response.body {
        serde_json::Value::String(ref text) => text.clone(),
        _ => response.body.to_string(),
    }
}

/// Unused descriptor helper kept for probe-report attachment symmetry.
#[allow(dead_code)]
fn provider_id_of(descriptor: &ProviderDescriptor) -> &str {
    &descriptor.provider_id
}

/// Usage synthesis placeholder type for wrapper deployments (ADR-010).
pub type UsageSynthesizer = fn(&WireResponse) -> UsageRecord;
