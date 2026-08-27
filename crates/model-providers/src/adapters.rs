//! Translation-only adapters for the three wire families (ADR-010).

use std::collections::BTreeMap;

use saber_sandbox::RedactableValue;
use serde_json::{Value, json};

use crate::provider::{ApiFamily, ModelProvider, ProviderDescriptor, require_success_payload};
use crate::spi::{
    FinishReason, MODEL_SPI_VERSION, ModelError, ModelRequest, ModelResponse, Role, StreamEvent,
    ToolCall, UsageRecord, WireRequest, WireResponse,
};

/// OpenAI-compatible chat/completions adapter.
pub struct OpenAiAdapter {
    descriptor: ProviderDescriptor,
}

impl OpenAiAdapter {
    /// Construct the adapter for one provider id.
    #[must_use]
    pub fn new(provider_id: &str) -> Self {
        Self {
            descriptor: ProviderDescriptor {
                provider_id: provider_id.to_owned(),
                family: ApiFamily::OpenAiCompatible,
                spi_version: MODEL_SPI_VERSION.to_owned(),
                credential_header: "authorization",
            },
        }
    }
}

impl ModelProvider for OpenAiAdapter {
    fn descriptor(&self) -> &ProviderDescriptor {
        &self.descriptor
    }

    fn translate(&self, request: &ModelRequest) -> Result<WireRequest, ModelError> {
        request.validate()?;
        let messages: Vec<Value> = request
            .messages
            .iter()
            .map(|message| {
                json!({
                    "role": match message.role {
                        Role::System | Role::User | Role::Assistant | Role::Tool => {
                            match message.role {
                                Role::Tool => "tool",
                                Role::System => "system",
                                Role::User => "user",
                                Role::Assistant => "assistant",
                            }
                        }
                    },
                    "content": message.text,
                    "tool_call_id": message.tool_call_id,
                })
            })
            .collect();
        let mut body = json!({
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_output_tokens,
            "temperature": request.temperature,
            "stream": request.stream,
        });
        if !request.tools.is_empty() {
            body["tools"] = json!(
                request
                    .tools
                    .iter()
                    .map(|tool| json!({
                        "type": "function",
                        "function": {"name": tool.name, "parameters": tool.schema},
                    }))
                    .collect::<Vec<_>>()
            );
        }
        if let Some(structured) = &request.structured {
            body["response_format"] = json!({
                "type": "json_schema",
                "json_schema": {"name": "structured_output", "schema": structured.schema},
            });
        }
        Ok(WireRequest {
            path: "/v1/chat/completions".to_owned(),
            headers: BTreeMap::new(),
            credential_header: Some((
                "authorization".to_owned(),
                RedactableValue("placeholder".to_owned()),
            )),
            body,
        })
    }

    fn parse_response(&self, wire: &WireResponse) -> Result<ModelResponse, ModelError> {
        let usage = parse_openai_usage(&wire.body);
        require_success_payload(wire.status, usage)?;
        let choice = wire
            .body
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .ok_or(ModelError::Provider)?;
        let message = choice.get("message").ok_or(ModelError::Provider)?;
        let text = message
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let mut tool_calls = Vec::new();
        if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
            for call in calls {
                let function = call.get("function").ok_or(ModelError::Provider)?;
                tool_calls.push(ToolCall {
                    id: call
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    name: function
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    arguments: function
                        .get("arguments")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                });
            }
        }
        let finish = match choice
            .get("finish_reason")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "tool_calls" | "function_call" => FinishReason::ToolCall,
            "length" => FinishReason::Length,
            "content_filter" => FinishReason::ContentFilter,
            _ => FinishReason::Stop,
        };
        Ok(ModelResponse {
            text,
            tool_calls,
            finish,
            usage: usage.unwrap_or_default(),
            model: wire
                .body
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        })
    }

    fn parse_stream_chunk(&self, chunk: &str) -> Result<Vec<StreamEvent>, ModelError> {
        let mut events = Vec::new();
        for line in chunk.lines() {
            let Some(payload) = line.strip_prefix("data: ") else {
                continue;
            };
            if payload.trim() == "[DONE]" {
                events.push(StreamEvent::Done {
                    finish: FinishReason::Stop,
                });
                continue;
            }
            let value: Value = serde_json::from_str(payload).map_err(|_| ModelError::Provider)?;
            if let Some(usage) = parse_openai_usage(&value) {
                events.push(StreamEvent::Usage { usage });
            }
            let Some(choice) = value
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|choices| choices.first())
            else {
                continue;
            };
            let delta = choice.get("delta").cloned().unwrap_or(Value::Null);
            if let Some(text) = delta.get("content").and_then(Value::as_str) {
                events.push(StreamEvent::TextDelta {
                    delta: text.to_owned(),
                });
            }
            if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
                for call in calls {
                    let function = call.get("function").cloned().unwrap_or(Value::Null);
                    events.push(StreamEvent::ToolCallDelta {
                        index: call
                            .get("index")
                            .and_then(Value::as_u64)
                            .and_then(|index| usize::try_from(index).ok())
                            .unwrap_or_default(),
                        id: call
                            .get("id")
                            .and_then(Value::as_str)
                            .map(ToString::to_string),
                        name: function
                            .get("name")
                            .and_then(Value::as_str)
                            .map(ToString::to_string),
                        arguments_delta: function
                            .get("arguments")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                    });
                }
            }
        }
        Ok(events)
    }
}

fn parse_openai_usage(value: &Value) -> Option<UsageRecord> {
    value.get("usage").map(|usage| UsageRecord {
        input_tokens: usage
            .get("prompt_tokens")
            .and_then(Value::as_u64)
            .unwrap_or_default(),
        output_tokens: usage
            .get("completion_tokens")
            .and_then(Value::as_u64)
            .unwrap_or_default(),
        cached_tokens: usage
            .get("prompt_tokens_details")
            .and_then(|details| details.get("cached_tokens"))
            .and_then(Value::as_u64),
    })
}

/// Anthropic messages adapter.
pub struct AnthropicAdapter {
    descriptor: ProviderDescriptor,
}

impl AnthropicAdapter {
    /// Construct the adapter for one provider id.
    #[must_use]
    pub fn new(provider_id: &str) -> Self {
        Self {
            descriptor: ProviderDescriptor {
                provider_id: provider_id.to_owned(),
                family: ApiFamily::AnthropicCompatible,
                spi_version: MODEL_SPI_VERSION.to_owned(),
                credential_header: "x-api-key",
            },
        }
    }
}

impl ModelProvider for AnthropicAdapter {
    fn descriptor(&self) -> &ProviderDescriptor {
        &self.descriptor
    }

    fn translate(&self, request: &ModelRequest) -> Result<WireRequest, ModelError> {
        request.validate()?;
        let mut system = Vec::new();
        let mut messages = Vec::new();
        for message in &request.messages {
            match message.role {
                Role::System => system.push(message.text.clone()),
                Role::User | Role::Tool => messages.push(json!({
                    "role": "user",
                    "content": message.text,
                })),
                Role::Assistant => messages.push(json!({
                    "role": "assistant",
                    "content": message.text,
                })),
            }
        }
        let mut body = json!({
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_output_tokens,
            "temperature": request.temperature,
            "stream": request.stream,
        });
        if !system.is_empty() {
            body["system"] = json!(system.join("\n"));
        }
        if !request.tools.is_empty() {
            body["tools"] = json!(
                request
                    .tools
                    .iter()
                    .map(|tool| json!({
                        "name": tool.name,
                        "input_schema": tool.schema,
                    }))
                    .collect::<Vec<_>>()
            );
        }
        Ok(WireRequest {
            path: "/v1/messages".to_owned(),
            headers: BTreeMap::new(),
            credential_header: Some((
                "x-api-key".to_owned(),
                RedactableValue("placeholder".to_owned()),
            )),
            body,
        })
    }

    fn parse_response(&self, wire: &WireResponse) -> Result<ModelResponse, ModelError> {
        let usage = wire.body.get("usage").map(|usage| UsageRecord {
            input_tokens: usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            output_tokens: usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            cached_tokens: None,
        });
        require_success_payload(wire.status, usage)?;
        let mut text = String::new();
        let mut tool_calls = Vec::new();
        if let Some(blocks) = wire.body.get("content").and_then(Value::as_array) {
            for block in blocks {
                match block.get("type").and_then(Value::as_str) {
                    Some("text") => text.push_str(
                        block
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                    ),
                    Some("tool_use") => tool_calls.push(ToolCall {
                        id: block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                        name: block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                        arguments: block
                            .get("input")
                            .map(ToString::to_string)
                            .unwrap_or_default(),
                    }),
                    _ => {}
                }
            }
        }
        let finish = if tool_calls.is_empty() {
            match wire
                .body
                .get("stop_reason")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "max_tokens" => FinishReason::Length,
                "refusal" => FinishReason::ContentFilter,
                _ => FinishReason::Stop,
            }
        } else {
            FinishReason::ToolCall
        };
        Ok(ModelResponse {
            text,
            tool_calls,
            finish,
            usage: usage.unwrap_or_default(),
            model: wire
                .body
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        })
    }

    fn parse_stream_chunk(&self, chunk: &str) -> Result<Vec<StreamEvent>, ModelError> {
        let mut events = Vec::new();
        for line in chunk.lines() {
            let Some(payload) = line.strip_prefix("data: ") else {
                continue;
            };
            let value: Value = serde_json::from_str(payload).map_err(|_| ModelError::Provider)?;
            match value.get("type").and_then(Value::as_str) {
                Some("message_start") => events.push(StreamEvent::MessageStart {
                    model: value
                        .pointer("/message/model")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                }),
                Some("content_block_delta") => {
                    if let Some(delta) = value.pointer("/delta/text").and_then(Value::as_str) {
                        events.push(StreamEvent::TextDelta {
                            delta: delta.to_owned(),
                        });
                    }
                }
                Some("message_delta") => {
                    if let Some(usage) = value
                        .pointer("/usage/output_tokens")
                        .and_then(Value::as_u64)
                    {
                        events.push(StreamEvent::Usage {
                            usage: UsageRecord {
                                input_tokens: 0,
                                output_tokens: usage,
                                cached_tokens: None,
                            },
                        });
                    }
                    events.push(StreamEvent::Done {
                        finish: FinishReason::Stop,
                    });
                }
                _ => {}
            }
        }
        Ok(events)
    }
}

/// Ollama native adapter. Ollama does not always report usage; a response
/// without meaningful usage is rejected as unusable success unless the
/// deployment synthesizes usage (ADR-010).
pub struct OllamaAdapter {
    descriptor: ProviderDescriptor,
}

impl OllamaAdapter {
    /// Construct the adapter for one provider id.
    #[must_use]
    pub fn new(provider_id: &str) -> Self {
        Self {
            descriptor: ProviderDescriptor {
                provider_id: provider_id.to_owned(),
                family: ApiFamily::Ollama,
                spi_version: MODEL_SPI_VERSION.to_owned(),
                credential_header: "authorization",
            },
        }
    }
}

impl ModelProvider for OllamaAdapter {
    fn descriptor(&self) -> &ProviderDescriptor {
        &self.descriptor
    }

    fn translate(&self, request: &ModelRequest) -> Result<WireRequest, ModelError> {
        request.validate()?;
        let body = json!({
            "model": request.model,
            "messages": request
                .messages
                .iter()
                .map(|message| json!({
                    "role": match message.role {
                        Role::System => "system",
                        Role::User | Role::Tool => "user",
                        Role::Assistant => "assistant",
                    },
                    "content": message.text,
                }))
                .collect::<Vec<_>>(),
            "stream": request.stream,
            "options": {"num_predict": request.max_output_tokens, "temperature": request.temperature},
        });
        Ok(WireRequest {
            path: "/api/chat".to_owned(),
            headers: BTreeMap::new(),
            credential_header: None,
            body,
        })
    }

    fn parse_response(&self, wire: &WireResponse) -> Result<ModelResponse, ModelError> {
        let usage = wire.body.get("usage").map(|usage| UsageRecord {
            input_tokens: usage
                .get("prompt_tokens")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            output_tokens: usage
                .get("completion_tokens")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            cached_tokens: None,
        });
        require_success_payload(wire.status, usage)?;
        Ok(ModelResponse {
            text: wire
                .body
                .pointer("/message/content")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            tool_calls: Vec::new(),
            finish: FinishReason::Stop,
            usage: usage.unwrap_or_default(),
            model: wire
                .body
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        })
    }

    fn parse_stream_chunk(&self, chunk: &str) -> Result<Vec<StreamEvent>, ModelError> {
        let mut events = Vec::new();
        for line in chunk.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let value: Value = serde_json::from_str(line).map_err(|_| ModelError::Provider)?;
            if let Some(text) = value.pointer("/message/content").and_then(Value::as_str) {
                events.push(StreamEvent::TextDelta {
                    delta: text.to_owned(),
                });
            }
            if value.get("done").and_then(Value::as_bool) == Some(true) {
                let usage = UsageRecord {
                    input_tokens: value
                        .get("prompt_eval_count")
                        .and_then(Value::as_u64)
                        .unwrap_or_default(),
                    output_tokens: value
                        .get("eval_count")
                        .and_then(Value::as_u64)
                        .unwrap_or_default(),
                    cached_tokens: None,
                };
                events.push(StreamEvent::Usage { usage });
                events.push(StreamEvent::Done {
                    finish: FinishReason::Stop,
                });
            }
        }
        Ok(events)
    }
}
