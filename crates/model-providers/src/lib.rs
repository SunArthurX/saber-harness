//! Policy-bound replaceable model layer (ADR-010).
//!
//! Translation-only adapters behind a versioned SPI, PEP-authorized
//! transports, a digest-verified registry, capability probes, a
//! deterministic classification-first router and fail-closed budgets.

pub mod adapters;
pub mod budget;
pub mod invoker;
pub mod probe;
pub mod provider;
pub mod registry;
pub mod router;
pub mod spi;

pub use adapters::{AnthropicAdapter, OllamaAdapter, OpenAiAdapter};
pub use budget::{RetryPolicy, TaskBudget, drive_stream};
pub use invoker::{InvokeError, ModelInvoker, ModelTransport, route_request_for};
pub use probe::{ProbeReport, exclusions_from_reports, probe_model};
pub use provider::{
    ApiFamily, Capabilities, CostProfile, EndpointSpec, ModelEntry, ModelProvider,
    ProviderDescriptor, Residency, map_status,
};
pub use registry::{ModelRegistry, RegistryError, RegistryRecord, canonical_digest, record_for};
pub use router::{ModelRouter, RouteDecision, RouteError, RouteRequest};
pub use spi::{
    FinishReason, MODEL_EGRESS_PURPOSE, MODEL_SPI_VERSION, ModelError, ModelMessage, ModelRequest,
    ModelResponse, Role, StreamEvent, StreamOutcome, StructuredOutput, ToolCall, ToolDeclaration,
    UsageRecord, WireRequest, WireResponse,
};

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use std::collections::BTreeMap;

    use saber_egress::{
        DestinationPattern, EgressEngine, EgressRequest, EgressRule, RedirectPolicy,
    };
    use saber_policy::DataClass;
    use saber_secret_broker::{Channel, SecretBroker};

    use super::*;
    use crate::invoker::ModelTransport;

    // ---------- fixtures ----------

    fn entry(
        model_id: &str,
        provider_id: &str,
        max_data_class: DataClass,
        quality: u8,
        cost: u64,
    ) -> RegistryRecord {
        record_for(ModelEntry {
            model_id: model_id.to_owned(),
            provider_id: provider_id.to_owned(),
            family: ApiFamily::OpenAiCompatible,
            endpoint: EndpointSpec {
                host: format!("{provider_id}.example"),
                port: 443,
                path_prefix: "/v1".to_owned(),
            },
            capabilities: Capabilities {
                streaming: true,
                tools: true,
                structured: true,
            },
            max_data_class,
            residency: Residency::Global,
            quality_tier: quality,
            cost: CostProfile {
                input_per_mtok: cost,
                output_per_mtok: cost,
            },
            context_tokens: 128_000,
        })
    }

    fn registry() -> ModelRegistry {
        ModelRegistry::new(
            1,
            vec![
                entry("cloud-premium", "cloud", DataClass::Internal, 9, 5_000),
                entry("cloud-budget", "cloud", DataClass::Internal, 6, 500),
                entry("local-mini", "local", DataClass::Restricted, 4, 0),
            ],
        )
        .unwrap()
    }

    fn egress_engine() -> EgressEngine {
        EgressEngine::new(
            1,
            vec![EgressRule {
                purpose: MODEL_EGRESS_PURPOSE.to_owned(),
                destinations: vec![
                    DestinationPattern::Domain {
                        host: "cloud.example".to_owned(),
                        subdomains: false,
                    },
                    DestinationPattern::Domain {
                        host: "local.example".to_owned(),
                        subdomains: false,
                    },
                ],
                schemes: vec!["https".to_owned()],
                max_data_class: DataClass::Confidential,
                redirect: RedirectPolicy::SameHost,
                allow_ip_literals: false,
            }],
        )
        .unwrap()
    }

    fn providers() -> BTreeMap<String, Box<dyn ModelProvider>> {
        let mut map: BTreeMap<String, Box<dyn ModelProvider>> = BTreeMap::new();
        map.insert("cloud".to_owned(), Box::new(OpenAiAdapter::new("cloud")));
        map.insert("local".to_owned(), Box::new(OllamaAdapter::new("local")));
        map
    }

    struct FakeTransport {
        calls: u64,
        response: WireResponse,
        credential_echo: Option<String>,
    }

    impl FakeTransport {
        fn with(response: WireResponse) -> Self {
            Self {
                calls: 0,
                response,
                credential_echo: None,
            }
        }
    }

    impl ModelTransport for FakeTransport {
        fn execute(
            &mut self,
            _authorization: &saber_egress::EgressAuthorization,
            _request: &WireRequest,
            credential: Option<&saber_secret_broker::LeaseMaterial>,
        ) -> Result<WireResponse, ModelError> {
            self.calls += 1;
            if let Some(material) = credential {
                self.credential_echo = Some(material.expose().to_owned());
            }
            Ok(self.response.clone())
        }

        fn call_count(&self) -> u64 {
            self.calls
        }
    }

    fn request(model: &str, data_class: DataClass) -> ModelRequest {
        ModelRequest {
            request_id: "req_m_01".to_owned(),
            model: model.to_owned(),
            messages: vec![ModelMessage {
                role: Role::User,
                text: "hello".to_owned(),
                tool_call_id: None,
                tool_name: None,
            }],
            tools: Vec::new(),
            structured: None,
            max_output_tokens: 256,
            temperature: 0.2,
            stream: false,
            data_class,
        }
    }

    fn invoker() -> ModelInvoker<'static> {
        // Leaked box keeps the test simple; providers outlive the test.
        let providers: &'static BTreeMap<String, Box<dyn ModelProvider>> =
            Box::leak(Box::new(providers()));
        ModelInvoker::new(
            registry(),
            egress_engine(),
            SecretBroker::default(),
            providers,
        )
    }

    // ---------- adapters ----------

    #[test]
    fn openai_translation_and_parsing_roundtrip() {
        let adapter = OpenAiAdapter::new("cloud");
        let wire = adapter
            .translate(&request("cloud-premium", DataClass::Internal))
            .unwrap();
        assert_eq!(wire.path, "/v1/chat/completions");
        assert_eq!(
            wire.body["model"], "cloud-premium",
            "model must not be rewritten"
        );
        assert_eq!(wire.credential_header.as_ref().unwrap().0, "authorization");

        let response = adapter
            .parse_response(&WireResponse {
                status: 200,
                body: serde_json::json!({
                    "model": "cloud-premium",
                    "choices": [{
                        "message": {
                            "content": "hi there",
                            "tool_calls": [{
                                "id": "call_1",
                                "function": {"name": "ls", "arguments": "{\"path\":\".\"}"}
                            }]
                        },
                        "finish_reason": "tool_calls"
                    }],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5}
                }),
            })
            .unwrap();
        assert_eq!(response.text, "hi there");
        assert_eq!(response.finish, FinishReason::ToolCall);
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.usage.total(), 15);
    }

    #[test]
    fn anthropic_translation_and_parsing_roundtrip() {
        let adapter = AnthropicAdapter::new("anthropic");
        let mut req = request("claude-x", DataClass::Internal);
        req.messages.insert(
            0,
            ModelMessage {
                role: Role::System,
                text: "be terse".to_owned(),
                tool_call_id: None,
                tool_name: None,
            },
        );
        let wire = adapter.translate(&req).unwrap();
        assert_eq!(wire.path, "/v1/messages");
        assert_eq!(wire.body["system"], "be terse");

        let response = adapter
            .parse_response(&WireResponse {
                status: 200,
                body: serde_json::json!({
                    "model": "claude-x",
                    "content": [
                        {"type": "text", "text": "ok"},
                        {"type": "tool_use", "id": "tu_1", "name": "ls", "input": {"path": "."}}
                    ],
                    "stop_reason": "tool_use",
                    "usage": {"input_tokens": 7, "output_tokens": 3}
                }),
            })
            .unwrap();
        assert_eq!(response.text, "ok");
        assert_eq!(response.tool_calls[0].name, "ls");
        assert_eq!(response.usage.total(), 10);
    }

    #[test]
    fn ollama_translation_and_stream_parsing() {
        let adapter = OllamaAdapter::new("local");
        let wire = adapter
            .translate(&request("local-mini", DataClass::Restricted))
            .unwrap();
        assert_eq!(wire.path, "/api/chat");
        assert!(
            wire.credential_header.is_none(),
            "local provider needs no credential"
        );

        let events = adapter
            .parse_stream_chunk(
                "{\"message\":{\"content\":\"he\"}}\n{\"message\":{\"content\":\"llo\"}}\n{\"done\":true,\"prompt_eval_count\":4,\"eval_count\":2}\n",
            )
            .unwrap();
        let mut budget = TaskBudget::new(1_000).unwrap();
        let outcome = drive_stream(&events, &mut budget);
        assert_eq!(outcome.text, "hello");
        assert_eq!(outcome.usage.total(), 6);
        assert!(!outcome.cancelled);
        assert_eq!(outcome.finish, Some(FinishReason::Stop));
    }

    // ---------- no forged success ----------

    #[test]
    fn provider_success_without_usage_is_rejected() {
        let adapter = OpenAiAdapter::new("cloud");
        let error = adapter
            .parse_response(&WireResponse {
                status: 200,
                body: serde_json::json!({
                    "choices": [{"message": {"content": "trust me"}, "finish_reason": "stop"}]
                }),
            })
            .unwrap_err();
        assert_eq!(error, ModelError::Provider);
        assert!(!error.retryable(), "forged success is terminal");
    }

    #[test]
    fn stream_without_terminal_event_aborts() {
        let events = vec![
            StreamEvent::TextDelta {
                delta: "partial".to_owned(),
            },
            StreamEvent::Usage {
                usage: UsageRecord {
                    input_tokens: 3,
                    output_tokens: 2,
                    cached_tokens: None,
                },
            },
        ];
        let mut budget = TaskBudget::new(1_000).unwrap();
        let outcome = drive_stream(&events, &mut budget);
        assert_eq!(outcome.error, Some(ModelError::StreamAborted));
        assert!(outcome.error.unwrap().retryable());
    }

    // ---------- egress boundary ----------

    #[test]
    fn egress_denial_executes_zero_transport_calls() {
        let mut invoker = invoker();
        let mut budget = TaskBudget::new(100_000).unwrap();
        let mut transport = FakeTransport::with(WireResponse {
            status: 200,
            body: serde_json::json!({}),
        });
        // No egress rule admits this host, so authorization must fail before
        // any transport contact.
        let record = entry("unknown-host-model", "rogue", DataClass::Internal, 9, 1);
        invoker.registry_mut().update(2, vec![record]).unwrap();
        let result = invoker.invoke(
            &request("unknown-host-model", DataClass::Internal),
            Residency::Global,
            &[],
            &mut budget,
            &mut transport,
            1_000,
        );
        assert!(matches!(result, Err(InvokeError::EgressDenied(_))));
        assert_eq!(transport.call_count(), 0, "zero transport calls on denial");
    }

    #[test]
    fn happy_invocation_verifies_usage_and_leases_credentials() {
        let mut invoker = invoker();
        invoker
            .secrets_mut()
            .register(
                "credential://broker/provider-cloud",
                "sk-cloud-SECRET1234567890",
                vec![Channel::EnvVar("authorization".to_owned())],
                vec![MODEL_EGRESS_PURPOSE.to_owned()],
            )
            .unwrap();
        let mut budget = TaskBudget::new(100_000).unwrap();
        let mut transport = FakeTransport::with(WireResponse {
            status: 200,
            body: serde_json::json!({
                "model": "cloud-premium",
                "choices": [{"message": {"content": "answer"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 8}
            }),
        });
        let response = invoker
            .invoke(
                &request("cloud-premium", DataClass::Internal),
                Residency::Global,
                &[],
                &mut budget,
                &mut transport,
                1_000,
            )
            .unwrap();
        assert_eq!(response.text, "answer");
        assert_eq!(response.usage.total(), 20);
        assert_eq!(transport.call_count(), 1);
        assert_eq!(budget.remaining(), 100_000 - 20);
        assert_eq!(
            transport.credential_echo.as_deref(),
            Some("sk-cloud-SECRET1234567890"),
            "credential injected via lease channel"
        );
        // The lease was single-consumption.
        assert!(
            invoker
                .secrets_mut()
                .reference_available("credential://broker/provider-cloud")
        );
    }

    // ---------- classification ----------

    #[test]
    fn restricted_data_never_routes_to_lower_ceiling() {
        let registry = registry();
        let router = ModelRouter::new(&registry);
        let error = router
            .route(&RouteRequest {
                data_class: DataClass::Restricted,
                residency: Residency::Global,
                required: Capabilities::default(),
                budget_remaining_tokens: 10_000,
                estimated_tokens: 1_000,
                excluded: Vec::new(),
            })
            .map(|decision| decision.model_id);
        // Only local-mini (Restricted ceiling) survives.
        assert_eq!(error.unwrap(), "local-mini");
        let denied = router.route(&RouteRequest {
            data_class: DataClass::Restricted,
            residency: Residency::OnDevice,
            required: Capabilities {
                structured: true,
                tools: true,
                streaming: true,
            },
            budget_remaining_tokens: 10_000,
            estimated_tokens: 1_000,
            excluded: vec!["local-mini".to_owned()],
        });
        assert_eq!(denied.unwrap_err(), RouteError::NoAdmissibleProvider);
    }

    #[test]
    fn router_is_deterministic_and_fails_closed_on_budget() {
        let registry = registry();
        let router = ModelRouter::new(&registry);
        let route_request = || RouteRequest {
            data_class: DataClass::Internal,
            residency: Residency::Global,
            required: Capabilities::default(),
            budget_remaining_tokens: 10_000,
            estimated_tokens: 1_000,
            excluded: Vec::new(),
        };
        let first = router.route(&route_request()).unwrap();
        let second = router.route(&route_request()).unwrap();
        assert_eq!(first, second, "identical inputs decide identically");
        assert_eq!(
            first.model_id, "cloud-premium",
            "quality ranks before cost among survivors"
        );
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap(),
            "byte-identical decisions"
        );
        let exhausted = router.route(&RouteRequest {
            data_class: DataClass::Internal,
            residency: Residency::Global,
            required: Capabilities::default(),
            budget_remaining_tokens: 10,
            estimated_tokens: 1_000,
            excluded: Vec::new(),
        });
        assert_eq!(exhausted.unwrap_err(), RouteError::BudgetExhausted);
    }

    // ---------- budget ----------

    #[test]
    fn budget_exhaustion_midstream_cancels_with_partial_usage() {
        let events = vec![
            StreamEvent::TextDelta {
                delta: "once upon".to_owned(),
            },
            StreamEvent::Usage {
                usage: UsageRecord {
                    input_tokens: 60,
                    output_tokens: 40,
                    cached_tokens: None,
                },
            },
            StreamEvent::TextDelta {
                delta: " a time".to_owned(),
            },
            StreamEvent::Usage {
                usage: UsageRecord {
                    input_tokens: 0,
                    output_tokens: 5,
                    cached_tokens: None,
                },
            },
            StreamEvent::Done {
                finish: FinishReason::Stop,
            },
        ];
        let mut budget = TaskBudget::new(100).unwrap();
        let outcome = drive_stream(&events, &mut budget);
        assert!(outcome.cancelled);
        assert_eq!(outcome.error, Some(ModelError::BudgetExhausted));
        assert_eq!(
            outcome.usage.total(),
            105,
            "billed usage preserved including the event that overflowed"
        );
        assert_eq!(outcome.finish, None, "no terminal event after cancel");
        assert!(!outcome.text.is_empty());
    }

    #[test]
    fn retries_are_bounded_and_only_retryable() {
        let policy = RetryPolicy { max_attempts: 2 };
        assert!(policy.permits(ModelError::Transport, 0));
        assert!(policy.permits(ModelError::RateLimited, 1));
        assert!(!policy.permits(ModelError::Transport, 2));
        assert!(!policy.permits(ModelError::Auth, 0));
        assert!(!policy.permits(ModelError::Provider, 0));
    }

    // ---------- registry ----------

    #[test]
    fn registry_rejects_digest_mismatch_and_rollback() {
        let mut records = vec![entry(
            "cloud-premium",
            "cloud",
            DataClass::Internal,
            9,
            5_000,
        )];
        records[0].content_digest = format!("sha256:{}", "0".repeat(64));
        assert_eq!(
            ModelRegistry::new(1, records).unwrap_err(),
            RegistryError::DigestMismatch
        );

        let mut registry = registry();
        assert_eq!(
            registry.update(0, Vec::new()).unwrap_err(),
            RegistryError::Rollback
        );
        assert!(
            registry.update(1, Vec::new()).is_ok(),
            "forward update is allowed"
        );
    }

    // ---------- credentials never leak ----------

    // ---------- probing (live module) ----------

    #[test]
    fn probe_reports_certify_capabilities_and_drive_exclusions() {
        let provider = OpenAiAdapter::new("cloud");
        let engine = egress_engine();
        let authorization = engine
            .authorize(&EgressRequest {
                purpose: MODEL_EGRESS_PURPOSE.to_owned(),
                scheme: "https".to_owned(),
                host: "cloud.example".to_owned(),
                port: 443,
                data_class: saber_policy::DataClass::Public,
                taints: Vec::new(),
                credential_ref: None,
                payload_len: 0,
            })
            .authorization
            .clone()
            .unwrap();

        // Healthy transport: every stage passes.
        let mut healthy = FakeTransport::with(WireResponse {
            status: 200,
            body: serde_json::json!({
                "choices": [{"message": {"content": "pong"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1}
            }),
        });
        let report = probe_model("cloud-premium", &provider, &mut healthy, &authorization);
        assert!(report.basic_ok);
        assert!(report.tools_ok);
        assert!(report.certifies(&Capabilities {
            streaming: false,
            tools: true,
            structured: false,
        }));

        // Streaming stage needs a terminal event with usage in the body.
        assert!(!report.streaming_ok || healthy.call_count() >= 2);

        // Forged transport (no usage): probe fails and excludes the model.
        let mut forged = FakeTransport::with(WireResponse {
            status: 200,
            body: serde_json::json!({
                "choices": [{"message": {"content": "trust me"}, "finish_reason": "stop"}]
            }),
        });
        let failed = probe_model("cloud-budget", &provider, &mut forged, &authorization);
        assert!(!failed.basic_ok);
        let mut reports = BTreeMap::new();
        reports.insert("cloud-budget".to_owned(), failed);
        assert_eq!(
            exclusions_from_reports(&reports, &Capabilities::default()),
            vec!["cloud-budget".to_owned()],
            "probe-failing models are excluded from routing"
        );
    }

    #[test]
    fn wire_request_never_renders_credentials_or_body() {
        let wire = WireRequest {
            path: "/v1/chat/completions".to_owned(),
            headers: BTreeMap::new(),
            credential_header: Some((
                "authorization".to_owned(),
                saber_sandbox::RedactableValue("sk-live-SECRET".to_owned()),
            )),
            body: serde_json::json!({"secret_in_body": "nope"}),
        };
        let rendered = format!("{wire:?}");
        assert!(!rendered.contains("sk-live-SECRET"));
        assert!(!rendered.contains("secret_in_body"));
        assert!(rendered.contains("[redacted]"));
    }

    // ---------- probing ----------

    #[test]
    fn probe_excludes_failing_providers_from_routing() {
        let registry = registry();
        let router = ModelRouter::new(&registry);
        let without_exclusion = router
            .route(&RouteRequest {
                data_class: DataClass::Internal,
                residency: Residency::Global,
                required: Capabilities::default(),
                budget_remaining_tokens: 10_000,
                estimated_tokens: 1_000,
                excluded: Vec::new(),
            })
            .unwrap();
        assert_eq!(without_exclusion.model_id, "cloud-premium");
        let with_exclusion = router
            .route(&RouteRequest {
                data_class: DataClass::Internal,
                residency: Residency::Global,
                required: Capabilities::default(),
                budget_remaining_tokens: 10_000,
                estimated_tokens: 1_000,
                excluded: vec!["cloud-premium".to_owned(), "cloud-budget".to_owned()],
            })
            .unwrap();
        assert_eq!(with_exclusion.model_id, "local-mini");
    }
}
