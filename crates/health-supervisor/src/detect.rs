//! Deterministic health detection: pure detectors and the H0-H4 severity
//! ladder (ADR-020).

use serde::{Deserialize, Serialize};

/// The severity ladder.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// H0: local reflex inside one component.
    H0LocalReflex,
    /// H1: containment inside one Trust Cell.
    H1CellContainment,
    /// H2: cross-cell degradation (Safe Mode candidate).
    H2CrossCellDegradation,
    /// H3: Safe Mode — stop effects, preserve evidence.
    H3SafeMode,
    /// H4: external medicine — stop autonomy, emit a bundle.
    H4ExternalAuthority,
}

/// The observed health dimensions (RES-HEAL-003). Detection is pure: no LLM participates in classification.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthDimension {
    /// Integrity failures (hash chain, projection drift).
    Integrity,
    /// Budget overruns.
    Budget,
    /// Latency/deadline breaches.
    Latency,
    /// Crash signals.
    Crash,
    /// Policy enforcement failures.
    Policy,
    /// Contamination (poisoned knowledge).
    Contamination,
}

/// One observed metric feeding detection.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HealthObservation {
    /// The dimension being reported.
    pub dimension: HealthDimension,
    /// The Trust Cell / component that observed it.
    pub cell: String,
    /// Observed raw value (count, milliseconds…).
    pub value: u64,
    /// The configured threshold for this dimension at this cell.
    pub threshold: u64,
    /// Whether the reporting cell is a critical enforcement boundary
    /// (policy, sandbox, audit, crypto, recovery).
    pub critical_boundary: bool,
    /// Whether the observation indicates trust-root or audit-chain
    /// involvement (escalation class).
    pub trust_root_involved: bool,
}

/// A raised health signal with its deterministic classification.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct HealthSignal {
    /// Severity classification.
    pub severity: Severity,
    /// The originating observation.
    pub observation: HealthObservation,
}

/// Classify one observation onto the ladder (pure, deterministic).
#[must_use]
pub fn classify(observation: &HealthObservation) -> Option<HealthSignal> {
    // Under threshold: healthy.
    if observation.value <= observation.threshold {
        return None;
    }
    // Trust-root or audit-chain involvement: straight to external
    // authority; autonomous repair stops entirely (ADR-020).
    let severity = if observation.trust_root_involved {
        Severity::H4ExternalAuthority
    } else if observation.critical_boundary {
        // A critical enforcement boundary failing is fail-closed Safe
        // Mode, not a local reflex.
        Severity::H3SafeMode
    } else {
        match observation.dimension {
            HealthDimension::Crash | HealthDimension::Policy => Severity::H1CellContainment,
            HealthDimension::Integrity | HealthDimension::Contamination => {
                Severity::H1CellContainment
            }
            HealthDimension::Budget | HealthDimension::Latency => Severity::H0LocalReflex,
        }
    };
    Some(HealthSignal {
        severity,
        observation: observation.clone(),
    })
}

/// Classify a batch and fold to the dominant signal (max severity;
/// deterministic tie-break by dimension then cell).
#[must_use]
pub fn dominant_signal(signals: &[HealthSignal]) -> Option<&HealthSignal> {
    signals.iter().max_by(|left, right| {
        left.severity
            .cmp(&right.severity)
            .then_with(|| {
                format!("{:?}", left.observation.dimension)
                    .cmp(&format!("{:?}", right.observation.dimension))
            })
            .then_with(|| left.observation.cell.cmp(&right.observation.cell))
    })
}
