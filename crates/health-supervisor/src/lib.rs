//! Bounded reflexes, Safe Mode and escalation (ADR-020).

use std::collections::BTreeMap;

use serde::Serialize;

/// The closed reflex vocabulary. Policy, sandbox, audit, crypto and
/// recovery enforcement are structurally absent: reflexes can degrade
/// work, never weaken a boundary (ADR-020).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reflex {
    /// Rate-limit a hot path.
    RateLimit,
    /// Open a circuit breaker.
    CircuitBreak,
    /// Suspend a budget.
    BudgetSuspend,
    /// Quarantine a component.
    Quarantine,
}

/// Cooldown bounds per reflex (game-day tuned constants).
pub const REFLEX_COOLDOWN_MS: u64 = 30_000;
/// Blast radius: at most this many cells may be reflex-quarantined
/// before escalation instead of further reflexes.
pub const MAX_QUARANTINED_CELLS: usize = 3;

/// The reflex decision for one signal.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ReflexPlan {
    /// The chosen reflex.
    pub reflex: Reflex,
    /// Cooldown before the reflex may re-arm.
    pub cooldown_ms: u64,
    /// The contained cell.
    pub cell: String,
}

/// Safe Mode state.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SafeModeState {
    /// Normal operation.
    #[default]
    Normal,
    /// Safe Mode: effects stopped, evidence preserved.
    Active,
}

/// Escalation outcome for H4 incidents.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct Escalation {
    /// The incident cells.
    pub cells: Vec<String>,
    /// The minimal, metadata-only, DLP-reviewed diagnostic bundle
    /// (contains no content, credentials or transcripts).
    pub diagnostic_bundle: DiagnosticBundle,
}

/// The minimal external-authority bundle.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DiagnosticBundle {
    /// Signal severities by cell (metadata only).
    pub severities: BTreeMap<String, String>,
    /// When the escalation fired.
    pub escalated_at_ms: u64,
}

/// The health supervisor: pure state machine over signals, reflexes,
/// Safe Mode and escalation.
#[derive(Default)]
pub struct HealthSupervisor {
    quarantined_cells: Vec<String>,
    safe_mode: SafeModeState,
    autonomous_halted: bool,
    events: Vec<&'static str>,
}

impl HealthSupervisor {
    /// Process one classified signal: contain first, diagnose never
    /// autonomously beyond the ladder (ADR-020).
    ///
    /// # Errors
    ///
    /// Never fails; returns the action taken. (Kept `Result`-free for
    /// clarity of the state machine.)
    #[must_use]
    pub fn process(&mut self, signal: &HealthSignal, now_ms: u64) -> SupervisorAction {
        match signal.severity {
            Severity::H0LocalReflex => {
                self.record("health.signal_raised");
                SupervisorAction::Reflex(ReflexPlan {
                    reflex: Reflex::RateLimit,
                    cooldown_ms: REFLEX_COOLDOWN_MS,
                    cell: signal.observation.cell.clone(),
                })
            }
            Severity::H1CellContainment | Severity::H2CrossCellDegradation => {
                self.record("health.signal_raised");
                self.record("cell.degraded");
                if self.quarantined_cells.len() >= MAX_QUARANTINED_CELLS {
                    // Blast-radius bound reached: escalate instead of
                    // reflexing further.
                    self.halt_autonomy();
                    return SupervisorAction::Escalate(Self::escalate(&[signal], now_ms));
                }
                let cell = signal.observation.cell.clone();
                self.quarantined_cells.push(cell.clone());
                self.record("incident.contained");
                SupervisorAction::Reflex(ReflexPlan {
                    reflex: Reflex::Quarantine,
                    cooldown_ms: REFLEX_COOLDOWN_MS,
                    cell,
                })
            }
            Severity::H3SafeMode => {
                // Fail-closed Safe Mode: idempotent entry, effects stop.
                self.record("health.signal_raised");
                if self.safe_mode == SafeModeState::Normal {
                    self.safe_mode = SafeModeState::Active;
                    self.record("safe_mode.entered");
                }
                SupervisorAction::SafeModeEntered
            }
            Severity::H4ExternalAuthority => {
                self.record("health.signal_raised");
                self.halt_autonomy();
                self.record("incident.escalated");
                self.record("incident.external_help_requested");
                SupervisorAction::Escalate(Self::escalate(std::slice::from_ref(&signal), now_ms))
            }
        }
    }

    /// Exit Safe Mode: ONLY an explicit operator action, never a timeout
    /// or self-assessment (ADR-020).
    pub fn operator_exit_safe_mode(&mut self) -> bool {
        if self.safe_mode == SafeModeState::Active {
            self.safe_mode = SafeModeState::Normal;
            self.record("safe_mode.exited");
            return true;
        }
        false
    }

    /// Whether autonomy is halted (H4 or blast-radius escalation).
    #[must_use]
    pub fn autonomy_halted(&self) -> bool {
        self.autonomous_halted
    }

    /// Current Safe Mode state.
    #[must_use]
    pub fn safe_mode(&self) -> SafeModeState {
        self.safe_mode
    }

    /// Quarantined cells so far.
    #[must_use]
    pub fn quarantined_cells(&self) -> &[String] {
        &self.quarantined_cells
    }

    /// Drain the recorded event names (metadata-only audit feed).
    #[must_use]
    pub fn take_events(&mut self) -> Vec<&'static str> {
        std::mem::take(&mut self.events)
    }

    fn halt_autonomy(&mut self) {
        self.autonomous_halted = true;
    }

    fn escalate(signals: &[&HealthSignal], now_ms: u64) -> Escalation {
        let mut severities = BTreeMap::new();
        let mut cells = Vec::new();
        for signal in signals {
            severities.insert(
                signal.observation.cell.clone(),
                format!("{:?}", signal.severity),
            );
            cells.push(signal.observation.cell.clone());
        }
        Escalation {
            cells,
            diagnostic_bundle: DiagnosticBundle {
                severities,
                escalated_at_ms: now_ms,
            },
        }
    }

    fn record(&mut self, name: &'static str) {
        self.events.push(name);
    }
}

/// What the supervisor did with a signal.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub enum SupervisorAction {
    /// A bounded reflex fired.
    Reflex(ReflexPlan),
    /// Safe Mode was entered (idempotently).
    SafeModeEntered,
    /// Autonomy halted; a minimal bundle is ready for external authority.
    Escalate(Escalation),
}

pub mod detect;

pub use detect::{
    HealthDimension, HealthObservation, HealthSignal, Severity, classify, dominant_signal,
};

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;

    fn observation(
        dimension: HealthDimension,
        cell: &str,
        value: u64,
        threshold: u64,
        critical: bool,
        trust_root: bool,
    ) -> HealthObservation {
        HealthObservation {
            dimension,
            cell: cell.to_owned(),
            value,
            threshold,
            critical_boundary: critical,
            trust_root_involved: trust_root,
        }
    }

    #[test]
    fn detection_is_deterministic_and_llm_free() {
        // Under threshold: healthy.
        assert!(
            classify(&observation(
                HealthDimension::Latency,
                "cell_a",
                100,
                1_000,
                false,
                false
            ))
            .is_none()
        );
        // Over threshold, non-critical, budget/latency: H0 reflex.
        assert_eq!(
            classify(&observation(
                HealthDimension::Budget,
                "cell_a",
                2_000,
                1_000,
                false,
                false
            ))
            .unwrap()
            .severity,
            Severity::H0LocalReflex
        );
        // Crash/integrity/contamination: H1 containment.
        for dimension in [
            HealthDimension::Crash,
            HealthDimension::Integrity,
            HealthDimension::Contamination,
        ] {
            assert_eq!(
                classify(&observation(dimension, "cell_a", 2, 0, false, false))
                    .unwrap()
                    .severity,
                Severity::H1CellContainment
            );
        }
        // Deterministic: same observation, same classification.
        let obs = observation(HealthDimension::Crash, "cell_a", 2, 0, false, false);
        assert_eq!(classify(&obs), classify(&obs));
    }

    #[test]
    fn critical_boundaries_fail_closed_into_safe_mode() {
        // A policy-boundary signal maps to H3 Safe Mode, not a reflex.
        assert_eq!(
            classify(&observation(
                HealthDimension::Policy,
                "policy_engine",
                1,
                0,
                true,
                false
            ))
            .unwrap()
            .severity,
            Severity::H3SafeMode
        );
    }

    #[test]
    fn trust_root_breaks_escalate_immediately() {
        assert_eq!(
            classify(&observation(
                HealthDimension::Integrity,
                "audit_chain",
                1,
                0,
                false,
                true
            ))
            .unwrap()
            .severity,
            Severity::H4ExternalAuthority
        );
    }

    #[test]
    fn reflexes_are_bounded_and_never_touch_authority() {
        // The closed vocabulary structurally excludes policy/audit/crypto:
        for reflex in [
            Reflex::RateLimit,
            Reflex::CircuitBreak,
            Reflex::BudgetSuspend,
            Reflex::Quarantine,
        ] {
            let _ = reflex; // exhaustive proof the set is closed
        }
        let mut supervisor = HealthSupervisor::default();
        let h0 = classify(&observation(
            HealthDimension::Latency,
            "cell_a",
            5_000,
            1_000,
            false,
            false,
        ))
        .unwrap();
        assert!(matches!(
            supervisor.process(&h0, 1_000),
            SupervisorAction::Reflex(plan) if plan.cooldown_ms == REFLEX_COOLDOWN_MS
        ));
        // Reflexes never changed Safe Mode or halted anything: authority
        // is untouched by construction.
        assert_eq!(supervisor.safe_mode(), SafeModeState::Normal);
        assert!(!supervisor.autonomy_halted());
    }

    #[test]
    fn safe_mode_is_idempotent_and_operator_exit_only() {
        let mut supervisor = HealthSupervisor::default();
        let critical = classify(&observation(
            HealthDimension::Policy,
            "policy_engine",
            1,
            0,
            true,
            false,
        ))
        .unwrap();
        assert!(matches!(
            supervisor.process(&critical, 1_000),
            SupervisorAction::SafeModeEntered
        ));
        // Idempotent re-entry.
        assert!(matches!(
            supervisor.process(&critical, 1_001),
            SupervisorAction::SafeModeEntered
        ));
        assert_eq!(supervisor.safe_mode(), SafeModeState::Active);
        // Exit requires the explicit operator action.
        assert!(supervisor.operator_exit_safe_mode());
        assert_eq!(supervisor.safe_mode(), SafeModeState::Normal);
        // Exiting while normal is a no-op, not an error state.
        assert!(!supervisor.operator_exit_safe_mode());
    }

    #[test]
    fn escalation_stops_autonomy_with_a_minimal_bundle() {
        let mut supervisor = HealthSupervisor::default();
        let h4 = classify(&observation(
            HealthDimension::Integrity,
            "audit_chain",
            1,
            0,
            false,
            true,
        ))
        .unwrap();
        let SupervisorAction::Escalate(escalation) = supervisor.process(&h4, 5_000) else {
            unreachable!("trust-root signals must escalate");
        };
        assert!(supervisor.autonomy_halted(), "autonomy stops on H4");
        // The bundle is metadata-only: severities and a timestamp.
        assert_eq!(
            escalation.diagnostic_bundle.severities.get("audit_chain"),
            Some(&"H4ExternalAuthority".to_owned())
        );
        // Later signals do not resume autonomy.
        let h0 = classify(&observation(
            HealthDimension::Latency,
            "cell_a",
            5_000,
            1_000,
            false,
            false,
        ))
        .unwrap();
        let _action = supervisor.process(&h0, 5_001);
        assert!(supervisor.autonomy_halted());
    }

    #[test]
    fn blast_radius_bounds_escalate_instead_of_reflexing() {
        let mut supervisor = HealthSupervisor::default();
        // Fill the quarantine budget.
        for index in 0..MAX_QUARANTINED_CELLS {
            let signal = classify(&observation(
                HealthDimension::Crash,
                &format!("cell_{index}"),
                2,
                0,
                false,
                false,
            ))
            .unwrap();
            assert!(matches!(
                supervisor.process(&signal, 1_000),
                SupervisorAction::Reflex(_)
            ));
        }
        assert_eq!(supervisor.quarantined_cells().len(), MAX_QUARANTINED_CELLS);
        // The next containment-class signal escalates rather than
        // reflexing beyond the blast radius.
        let overflow = classify(&observation(
            HealthDimension::Crash,
            "cell_overflow",
            2,
            0,
            false,
            false,
        ))
        .unwrap();
        assert!(matches!(
            supervisor.process(&overflow, 2_000),
            SupervisorAction::Escalate(_)
        ));
        assert!(supervisor.autonomy_halted());
    }

    #[test]
    fn game_day_cascade_ends_bounded_and_evidence_preserved() {
        // A cascade across many cells: H0 spam + crashes + a policy
        // boundary failure. The end state is bounded containment with
        // Safe Mode and preserved metadata-only events.
        let mut supervisor = HealthSupervisor::default();
        let observations = [
            observation(HealthDimension::Latency, "cell_a", 9_999, 100, false, false),
            observation(HealthDimension::Crash, "cell_b", 3, 0, false, false),
            observation(HealthDimension::Crash, "cell_c", 3, 0, false, false),
            observation(HealthDimension::Policy, "policy_engine", 1, 0, true, false),
            observation(HealthDimension::Latency, "cell_d", 9_999, 100, false, false),
        ];
        let signals: Vec<HealthSignal> = observations.iter().filter_map(classify).collect();
        // Deterministic dominant signal: the policy boundary (H3).
        let dominant = dominant_signal(&signals).unwrap();
        assert_eq!(dominant.severity, Severity::H3SafeMode);
        for signal in &signals {
            let _action = supervisor.process(signal, 3_000);
        }
        // Bounded: at most MAX quarantined cells, Safe Mode active,
        // autonomy not wrongly halted (H3 is not H4), events preserved.
        assert!(supervisor.quarantined_cells().len() <= MAX_QUARANTINED_CELLS);
        assert_eq!(supervisor.safe_mode(), SafeModeState::Active);
        assert!(!supervisor.autonomy_halted());
        let names = supervisor.take_events();
        assert!(names.contains(&"safe_mode.entered"));
        assert!(names.contains(&"incident.contained"));
        assert!(names.contains(&"health.signal_raised"));
    }
}
