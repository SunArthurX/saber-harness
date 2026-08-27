//! Fail-closed task budgets and the budget-guarded stream driver (ADR-010).

use serde::Serialize;

use crate::spi::{ModelError, StreamEvent, StreamOutcome, ToolCall, UsageRecord};

/// Bounded token budget for one task.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct TaskBudget {
    total_tokens: u64,
    consumed_tokens: u64,
}

impl TaskBudget {
    /// Construct a bounded budget.
    ///
    /// # Errors
    ///
    /// Rejects zero-sized budgets.
    pub fn new(total_tokens: u64) -> Result<Self, ModelError> {
        if total_tokens == 0 {
            return Err(ModelError::InvalidRequest);
        }
        Ok(Self {
            total_tokens,
            consumed_tokens: 0,
        })
    }

    /// Tokens still available.
    #[must_use]
    pub const fn remaining(&self) -> u64 {
        self.total_tokens.saturating_sub(self.consumed_tokens)
    }

    /// Consume usage against the budget.
    ///
    /// # Errors
    ///
    /// [`ModelError::BudgetExhausted`] when the record does not fit; the
    /// partial consumption is still applied for durable evidence.
    pub fn consume(&mut self, usage: &UsageRecord) -> Result<(), ModelError> {
        self.consumed_tokens = self.consumed_tokens.saturating_add(usage.total());
        if self.consumed_tokens > self.total_tokens {
            return Err(ModelError::BudgetExhausted);
        }
        Ok(())
    }

    /// Refund usage (for example when a retried attempt double-counted).
    pub fn refund(&mut self, usage: &UsageRecord) {
        self.consumed_tokens = self.consumed_tokens.saturating_sub(usage.total());
    }

    /// Whether an estimated token count is affordable.
    #[must_use]
    pub const fn affords(&self, estimated_tokens: u64) -> bool {
        self.remaining() >= estimated_tokens
    }
}

/// Drive a stream to its outcome under a budget: usage events consume the
/// budget as they arrive and exhaustion cancels cleanly with the partial
/// usage preserved as evidence.
pub fn drive_stream(events: &[StreamEvent], budget: &mut TaskBudget) -> StreamOutcome {
    let mut outcome = StreamOutcome {
        text: String::new(),
        tool_calls: Vec::new(),
        finish: None,
        usage: UsageRecord::default(),
        cancelled: false,
        error: None,
    };
    let mut calls: Vec<(usize, ToolCall)> = Vec::new();
    for event in events {
        match event {
            StreamEvent::TextDelta { delta } => outcome.text.push_str(delta),
            StreamEvent::ToolCallDelta {
                index,
                id,
                name,
                arguments_delta,
            } => match calls.iter_mut().find(|(call_index, _)| call_index == index) {
                Some((_, call)) => {
                    call.arguments.push_str(arguments_delta);
                    if call.id.is_empty() {
                        call.id = id.clone().unwrap_or_default();
                    }
                    if call.name.is_empty() {
                        call.name = name.clone().unwrap_or_default();
                    }
                }
                None => calls.push((
                    *index,
                    ToolCall {
                        id: id.clone().unwrap_or_default(),
                        name: name.clone().unwrap_or_default(),
                        arguments: arguments_delta.clone(),
                    },
                )),
            },
            StreamEvent::Usage { usage } => {
                // Accumulate: later usage events extend earlier ones, they do
                // not replace them.
                outcome.usage.input_tokens += usage.input_tokens;
                outcome.usage.output_tokens += usage.output_tokens;
                outcome.usage.cached_tokens = usage.cached_tokens.or(outcome.usage.cached_tokens);
                if budget.consume(usage).is_err() {
                    outcome.cancelled = true;
                    outcome.error = Some(ModelError::BudgetExhausted);
                    break;
                }
            }
            StreamEvent::Done { finish } => outcome.finish = Some(*finish),
            StreamEvent::MessageStart { .. } => {}
        }
    }
    calls.sort_by_key(|(index, _)| *index);
    outcome.tool_calls = calls.into_iter().map(|(_, call)| call).collect();
    if !outcome.cancelled && outcome.finish.is_none() {
        // A stream without a terminal event is an abort, not a success.
        outcome.error = Some(ModelError::StreamAborted);
    }
    if let Some(finish) = outcome.finish
        && finish == crate::spi::FinishReason::ToolCall
        && outcome.tool_calls.is_empty()
    {
        // Tool-call finish without any accumulated call is unusable.
        outcome.error = Some(ModelError::Provider);
    }
    outcome
}

/// Bounded retry policy: only retryable error classes, at most `max` times.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct RetryPolicy {
    /// Maximum retry attempts.
    pub max_attempts: u32,
}

impl RetryPolicy {
    /// Default bounded policy.
    #[must_use]
    pub const fn default_policy() -> Self {
        Self { max_attempts: 2 }
    }

    /// Whether one more attempt is permitted for this error.
    #[must_use]
    pub const fn permits(&self, error: ModelError, attempts_used: u32) -> bool {
        error.retryable() && attempts_used < self.max_attempts
    }
}
