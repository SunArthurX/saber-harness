//! Deterministic classification-first router (ADR-010).

use saber_policy::DataClass;
use serde::Serialize;

use crate::provider::{Capabilities, Residency};
use crate::registry::{ModelRegistry, RegistryRecord};
use crate::spi::UsageRecord;

/// Routing failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RouteError {
    /// No provider satisfies the classification, residency or capability filter.
    NoAdmissibleProvider,
    /// Surviving providers are all unaffordable.
    BudgetExhausted,
    /// The request itself was malformed.
    InvalidRequest,
}

impl std::fmt::Display for RouteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::NoAdmissibleProvider => "no_admissible_provider",
            Self::BudgetExhausted => "budget_exhausted",
            Self::InvalidRequest => "invalid_request",
        })
    }
}

impl std::error::Error for RouteError {}

/// One routing query.
#[derive(Clone, Debug)]
pub struct RouteRequest {
    /// Highest data classification in the payload.
    pub data_class: DataClass,
    /// Required residency treatment.
    pub residency: Residency,
    /// Required capabilities.
    pub required: Capabilities,
    /// Remaining token budget for the task.
    pub budget_remaining_tokens: u64,
    /// Estimated tokens this invocation needs.
    pub estimated_tokens: u64,
    /// Models excluded by health decay or failed probes.
    pub excluded: Vec<String>,
}

/// The routing decision, deterministic for identical inputs.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RouteDecision {
    /// Chosen model id.
    pub model_id: String,
    /// Owning provider id.
    pub provider_id: String,
    /// Ordered survivors after the chosen one.
    pub alternates: Vec<String>,
    /// Registry snapshot bound into this decision.
    pub registry_snapshot_id: String,
    /// Estimated cost in micro-units at the survivor profiles.
    pub estimated_cost_micro: u128,
}

/// Classification-first deterministic router.
pub struct ModelRouter<'a> {
    registry: &'a ModelRegistry,
}

impl<'a> ModelRouter<'a> {
    /// Bind a router to one registry snapshot.
    #[must_use]
    pub const fn new(registry: &'a ModelRegistry) -> Self {
        Self { registry }
    }

    /// Route one request: filter by policy, then rank by quality and cost.
    ///
    /// # Errors
    ///
    /// [`RouteError::NoAdmissibleProvider`] when the policy filter empties
    /// the candidate set; [`RouteError::BudgetExhausted`] when no survivor
    /// is affordable — routing fails closed instead of degrading policy.
    pub fn route(&self, request: &RouteRequest) -> Result<RouteDecision, RouteError> {
        if request.budget_remaining_tokens < request.estimated_tokens
            || request.estimated_tokens == 0
        {
            return Err(RouteError::BudgetExhausted);
        }
        let mut survivors: Vec<&RegistryRecord> = self
            .registry
            .records()
            .filter(|record| {
                record.entry.max_data_class >= request.data_class
                    && residency_admissible(record.entry.residency, request.residency)
                    && record.entry.capabilities.covers(&request.required)
                    && !request.excluded.contains(&record.entry.model_id)
            })
            .collect();
        if survivors.is_empty() {
            return Err(RouteError::NoAdmissibleProvider);
        }
        // Rank: quality descending, then cost ascending, then model id for a
        // stable total order — identical inputs always decide identically.
        survivors.sort_by(|left, right| {
            right
                .entry
                .quality_tier
                .cmp(&left.entry.quality_tier)
                .then_with(|| {
                    let left_cost = left.entry.cost.estimate_micro(&UsageRecord {
                        input_tokens: request.estimated_tokens,
                        output_tokens: request.estimated_tokens / 4,
                        cached_tokens: None,
                    });
                    let right_cost = right.entry.cost.estimate_micro(&UsageRecord {
                        input_tokens: request.estimated_tokens,
                        output_tokens: request.estimated_tokens / 4,
                        cached_tokens: None,
                    });
                    left_cost.cmp(&right_cost)
                })
                .then_with(|| left.entry.model_id.cmp(&right.entry.model_id))
        });
        let chosen = survivors[0];
        let estimated_cost_micro = chosen.entry.cost.estimate_micro(&UsageRecord {
            input_tokens: request.estimated_tokens,
            output_tokens: request.estimated_tokens / 4,
            cached_tokens: None,
        });
        Ok(RouteDecision {
            model_id: chosen.entry.model_id.clone(),
            provider_id: chosen.entry.provider_id.clone(),
            alternates: survivors[1..]
                .iter()
                .map(|record| record.entry.model_id.clone())
                .collect(),
            registry_snapshot_id: self.registry.snapshot_id().to_owned(),
            estimated_cost_micro,
        })
    }
}

fn residency_admissible(candidate: Residency, required: Residency) -> bool {
    match (candidate, required) {
        (Residency::OnDevice, _) => true,
        (_, Residency::OnDevice) => false,
        (Residency::Regional, Residency::Regional | Residency::Global) | (Residency::Global, _) => {
            true
        }
    }
}
