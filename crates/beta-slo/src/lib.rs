//! Design Partner Beta: SLO budgets, telemetry and feedback intake
//! (ADR-025).

use serde::Serialize;

/// SLO failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SloError {
    /// A measurement exceeded its budget.
    BudgetExceeded,
    /// The benchmark or payload was malformed.
    Malformed,
}

impl std::fmt::Display for SloError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::BudgetExceeded => "budget_exceeded",
            Self::Malformed => "malformed",
        })
    }
}

impl std::error::Error for SloError {}

/// The measured dimensions (ADR-025).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SloDimension {
    /// Cold-start to green acceptance, milliseconds.
    StartupMs,
    /// Peak resident memory, kilobytes.
    MemoryKb,
    /// End-to-end task latency, milliseconds.
    TaskLatencyMs,
    /// CI wall-clock, milliseconds.
    CiTimeMs,
}

/// One SLO budget: a ceiling for a dimension.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct SloBudget {
    /// The dimension.
    pub dimension: SloDimension,
    /// The maximum acceptable value.
    pub ceiling: u64,
}

/// One benchmark measurement.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct SloMeasurement {
    /// The dimension.
    pub dimension: SloDimension,
    /// The observed value.
    pub value: u64,
}

/// Assert a set of measurements against budgets: every measured
/// dimension with a budget must be at or below the ceiling, and every
/// budget must be covered by a measurement (silent absence fails).
///
/// # Errors
///
/// [`SloError::BudgetExceeded`] naming nothing (stable code) when any
/// dimension is over; [`SloError::Malformed`] when a budget has no
/// measurement.
pub fn assert_budgets(
    budgets: &[SloBudget],
    measurements: &[SloMeasurement],
) -> Result<(), SloError> {
    for budget in budgets {
        let Some(measurement) = measurements
            .iter()
            .find(|measurement| measurement.dimension == budget.dimension)
        else {
            return Err(SloError::Malformed);
        };
        if measurement.value > budget.ceiling {
            return Err(SloError::BudgetExceeded);
        }
    }
    Ok(())
}

/// A deterministic benchmark harness input: fixed work counts produce
/// comparable measurements per platform.
#[must_use]
pub fn deterministic_measurements(
    startup_work_units: u64,
    latency_work_units: u64,
) -> Vec<SloMeasurement> {
    // Deterministic transforms of work counts: the absolute numbers are
    // platform-reported by real deployments; the harness guarantees the
    // same inputs map to the same outputs.
    vec![
        SloMeasurement {
            dimension: SloDimension::StartupMs,
            value: 500 + startup_work_units * 10,
        },
        SloMeasurement {
            dimension: SloDimension::TaskLatencyMs,
            value: 100 + latency_work_units * 5,
        },
        SloMeasurement {
            dimension: SloDimension::MemoryKb,
            value: 120_000 + startup_work_units * 25,
        },
        SloMeasurement {
            dimension: SloDimension::CiTimeMs,
            value: 90_000 + latency_work_units * 100,
        },
    ]
}

/// One opt-in telemetry event (metadata-only, ADR-025).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TelemetryEvent {
    /// Stable event kind (counter/duration label).
    pub kind: String,
    /// A count or duration in milliseconds.
    pub value: u64,
}

/// The telemetry collector: opt-in, metadata-only. There is no field
/// for content; payloads are numbers and labels by construction.
#[derive(Default)]
pub struct Telemetry {
    enabled: bool,
    events: Vec<TelemetryEvent>,
}

impl Telemetry {
    /// Enable or disable collection (default off).
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// Whether collection is enabled.
    #[must_use]
    pub const fn enabled(&self) -> bool {
        self.enabled
    }

    /// Record one event; dropped unless opted in.
    pub fn record(&mut self, event: TelemetryEvent) {
        if self.enabled && !event.kind.is_empty() {
            self.events.push(event);
        }
    }

    /// Drain collected events (metadata-only export).
    #[must_use]
    pub fn drain(&mut self) -> Vec<TelemetryEvent> {
        std::mem::take(&mut self.events)
    }
}

/// Assert that no forbidden payload strings can appear in telemetry
/// events (canary, ADR-025).
///
/// # Errors
///
/// [`SloError::Malformed`] when any event kind carries forbidden
/// material.
pub fn telemetry_canary(events: &[TelemetryEvent]) -> Result<(), SloError> {
    const FORBIDDEN: [&str; 6] = [
        "credential",
        "token",
        "password",
        "secret",
        "transcript",
        "plaintext",
    ];
    for event in events {
        let lowered = event.kind.to_ascii_lowercase();
        if FORBIDDEN.iter().any(|word| lowered.contains(word)) {
            return Err(SloError::Malformed);
        }
    }
    Ok(())
}

/// Partner feedback entering the evolution pipeline (ADR-025): feedback
/// becomes a PROPOSAL with imported provenance — never a promotion.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FeedbackIntake {
    /// Stable feedback id.
    pub feedback_id: String,
    /// Partner-provided summary (evidence, not instruction).
    pub summary: String,
    /// The evolution kind it proposes toward.
    pub proposed_kind: &'static str,
}

/// The result of admitting feedback: a candidate description for the
/// S15 workshop (this crate does not depend on saber-evolution to keep
/// the harness dependency-free; the workshop accepts these fields).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EvolutionProposalDraft {
    /// Feedback id.
    pub feedback_id: String,
    /// Payload the workshop will digest.
    pub payload: String,
    /// Provenance trust: always imported (untrusted would also be
    /// legal, never trusted).
    pub trust: &'static str,
}

/// Intake: feedback becomes a proposal draft only (ADR-025). There is
/// no function here that can promote anything.
#[must_use]
pub fn intake_feedback(feedback: &FeedbackIntake) -> EvolutionProposalDraft {
    EvolutionProposalDraft {
        feedback_id: feedback.feedback_id.clone(),
        payload: format!("feedback:{}:{}", feedback.feedback_id, feedback.summary),
        trust: "imported",
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;

    fn budget(dimension: SloDimension, ceiling: u64) -> SloBudget {
        SloBudget { dimension, ceiling }
    }

    #[test]
    fn budgets_are_contracts_and_regressions_fail() {
        let measurements = deterministic_measurements(10, 10);
        // Comfortable budgets pass.
        assert!(
            assert_budgets(
                &[
                    budget(SloDimension::StartupMs, 10_000),
                    budget(SloDimension::MemoryKb, 500_000),
                    budget(SloDimension::TaskLatencyMs, 5_000),
                    budget(SloDimension::CiTimeMs, 500_000),
                ],
                &measurements,
            )
            .is_ok()
        );
        // An intentionally over-budget dimension fails the gate.
        assert_eq!(
            assert_budgets(&[budget(SloDimension::StartupMs, 1)], &measurements),
            Err(SloError::BudgetExceeded)
        );
        // A budget with no measurement is malformed, not silently passed.
        assert_eq!(
            assert_budgets(
                &[budget(SloDimension::StartupMs, 10_000)],
                &[SloMeasurement {
                    dimension: SloDimension::MemoryKb,
                    value: 1,
                }]
            ),
            Err(SloError::Malformed)
        );
    }

    #[test]
    fn benchmarks_are_deterministic() {
        assert_eq!(
            deterministic_measurements(7, 3),
            deterministic_measurements(7, 3)
        );
        assert_ne!(
            deterministic_measurements(7, 3),
            deterministic_measurements(8, 3)
        );
    }

    #[test]
    fn telemetry_is_opt_in_and_metadata_only() {
        let mut telemetry = Telemetry::default();
        telemetry.record(TelemetryEvent {
            kind: "task.completed".to_owned(),
            value: 42,
        });
        // Disabled by default: nothing collected.
        assert!(telemetry.drain().is_empty());
        telemetry.set_enabled(true);
        telemetry.record(TelemetryEvent {
            kind: "task.completed".to_owned(),
            value: 42,
        });
        telemetry.record(TelemetryEvent {
            kind: String::new(),
            value: 1,
        });
        let events = telemetry.drain();
        assert_eq!(events.len(), 1, "empty kinds are dropped");
        assert_eq!(events[0].kind, "task.completed");
        // The canary catches forbidden labels.
        assert_eq!(
            telemetry_canary(&[TelemetryEvent {
                kind: "credential.leak".to_owned(),
                value: 1,
            }]),
            Err(SloError::Malformed)
        );
        assert!(telemetry_canary(&events).is_ok());
    }

    #[test]
    fn feedback_becomes_candidates_only() {
        let draft = intake_feedback(&FeedbackIntake {
            feedback_id: "fb-01".to_owned(),
            summary: "faster builds please".to_owned(),
            proposed_kind: "workflow",
        });
        assert_eq!(draft.trust, "imported");
        assert!(draft.payload.contains("fb-01"));
        // There is no promotion path in this module by construction: the
        // only produced type is a draft with imported trust.
        assert_eq!(draft.feedback_id, "fb-01");
    }
}
