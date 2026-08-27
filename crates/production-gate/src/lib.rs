//! Production Gate: deterministic readiness certification (ADR-026).
//!
//! This crate is a pure evaluator over repository-state descriptors. It
//! performs no I/O, reads no clock and touches no network: collectors
//! (the Node verifiers and CI) produce [`GateInput`], the gate certifies
//! it. The report is metadata-only — codes and references, never content.

use serde::Serialize;

/// Gate failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GateError {
    /// An invariant family failed; the report carries the findings.
    InvariantFailed,
    /// The descriptor set cannot support a meaningful gate.
    Malformed,
}

impl std::fmt::Display for GateError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvariantFailed => "invariant_failed",
            Self::Malformed => "malformed",
        })
    }
}

impl std::error::Error for GateError {}

/// The invariant families certified by the gate (ADR-026).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InvariantFamily {
    /// Every S00-S23 crate contract is present.
    ContractsPresent,
    /// Every local verifier chains into the strict remote chain.
    VerifiersChained,
    /// Every segment tag is annotated, resolving and ordered.
    TagsResolve,
    /// Every required hosted gate context concluded successfully.
    HostedGatesGreen,
    /// No stale workspace members exist.
    WorkspaceHygiene,
    /// Every boundary change has an accepted ADR.
    AdrCoverage,
    /// E6 stays proposal-only; no autonomous E6/E7 path exists.
    EvolutionBoundary,
    /// TM-01..TM-16 each map to a covering control and test.
    ThreatCoverage,
    /// The rendered report itself is metadata-only.
    ReportHygiene,
}

impl InvariantFamily {
    /// Stable code used in findings and reports.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::ContractsPresent => "contracts_present",
            Self::VerifiersChained => "verifiers_chained",
            Self::TagsResolve => "tags_resolve",
            Self::HostedGatesGreen => "hosted_gates_green",
            Self::WorkspaceHygiene => "workspace_hygiene",
            Self::AdrCoverage => "adr_coverage",
            Self::EvolutionBoundary => "evolution_boundary",
            Self::ThreatCoverage => "threat_coverage",
            Self::ReportHygiene => "report_hygiene",
        }
    }
}

/// One S00-S23 crate contract observed (or not) by the collector.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractDescriptor {
    /// Owning segment, e.g. `S03`.
    pub segment: &'static str,
    /// Stable marker the collector looked for (reference only).
    pub marker: &'static str,
    /// Whether the marker was found.
    pub present: bool,
}

/// One segment verifier pair observed by the collector.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifierDescriptor {
    /// Owning segment, e.g. `S05`.
    pub segment: &'static str,
    /// Whether `verify-sXX.mjs` exists and is wired into the gates.
    pub local_present: bool,
    /// Whether `verify-remote-sXX.mjs` exists and chains the previous.
    pub remote_present: bool,
    /// Whether the remote script invokes the previous segment verifier.
    pub chains_previous: bool,
}

/// One segment completion tag observed by the collector.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TagDescriptor {
    /// Owning segment, e.g. `S07`.
    pub segment: &'static str,
    /// Tag name, e.g. `s07-complete`.
    pub tag: &'static str,
    /// Whether the tag object is annotated.
    pub annotated: bool,
    /// Whether the tag resolves to a commit on main.
    pub resolves: bool,
    /// Whether the commit is a descendant of the previous segment tag.
    pub after_previous: bool,
}

/// The conclusion of one required hosted gate context.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GateConclusion {
    /// The hosted context concluded successfully.
    Success,
    /// The hosted context concluded unsuccessfully.
    Failure,
    /// The hosted context never concluded (pending counts as not green).
    Pending,
}

/// One required hosted gate context observed by the collector.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostedGateDescriptor {
    /// Context name, e.g. `dependency-audit`.
    pub context: &'static str,
    /// The observed conclusion.
    pub conclusion: GateConclusion,
}

/// One declared workspace member observed by the collector.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceMemberDescriptor {
    /// Declared member path, e.g. `crates/policy`.
    pub path: &'static str,
    /// Whether the path exists with a manifest.
    pub exists: bool,
}

/// One architecture decision record observed by the collector.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdrDescriptor {
    /// Record path, e.g. `docs/adr/ADR-026-production-gate.md`.
    pub path: &'static str,
    /// Whether the record exists with `Status: accepted`.
    pub accepted: bool,
}

/// One audited source surface with the count of forbidden autonomy
/// markers found in it (zero is the only passing count).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvolutionSurfaceDescriptor {
    /// Surface reference, e.g. `crates/evolution`.
    pub surface: &'static str,
    /// Occurrences of forbidden autonomy markers (ADR-026).
    pub forbidden_marker_occurrences: u32,
}

/// One threat-register entry with its covering control and test.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ThreatCoverageDescriptor {
    /// Register id, e.g. `TM-03`.
    pub id: &'static str,
    /// The covering control (short reference, not report material).
    pub control: &'static str,
    /// The test reference proving the control.
    pub test: &'static str,
}

/// The complete repository-state descriptor set collected for the gate.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GateInput {
    /// S00-S23 crate contracts.
    pub contracts: Vec<ContractDescriptor>,
    /// Segment verifier pairs.
    pub verifiers: Vec<VerifierDescriptor>,
    /// Segment completion tags.
    pub tags: Vec<TagDescriptor>,
    /// Required hosted gate contexts.
    pub hosted_gates: Vec<HostedGateDescriptor>,
    /// Declared workspace members.
    pub workspace_members: Vec<WorkspaceMemberDescriptor>,
    /// Boundary-change ADRs.
    pub adrs: Vec<AdrDescriptor>,
    /// Audited source surfaces for the E6/E7 structural assertion.
    pub evolution_surfaces: Vec<EvolutionSurfaceDescriptor>,
    /// Threat-register coverage submitted for certification.
    pub threat_coverage: Vec<ThreatCoverageDescriptor>,
    /// Whether E6 publication is protected-PR-with-independent-review only.
    pub e6_proposal_only: bool,
}

/// One finding: a stable code plus a metadata-only reference detail.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct InvariantFinding {
    /// The failed family.
    pub family: InvariantFamily,
    /// Stable finding code, e.g. `missing_contract`.
    pub code: String,
    /// Metadata-only reference (segment/tag/context identifiers and counts).
    pub detail: String,
}

/// The result of one invariant family.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FamilyResult {
    /// The family.
    pub family: InvariantFamily,
    /// Whether every check in the family passed.
    pub passed: bool,
    /// Findings produced by this family (empty when passed).
    pub findings: Vec<InvariantFinding>,
}

/// The overall verdict.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadinessVerdict {
    /// Every family passed.
    Ready,
    /// At least one family failed.
    NotReady,
}

/// The auditable readiness report (ADR-026): pass/fail per invariant
/// family with metadata-only evidence references.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ReadinessReport {
    /// The overall verdict.
    pub verdict: ReadinessVerdict,
    /// Per-family results, in family order.
    pub families: Vec<FamilyResult>,
    /// Total findings across all families.
    pub total_findings: usize,
    /// Determinism checksum: identical inputs must produce identical
    /// digests (a comparison checksum, not a cryptographic commitment).
    pub determinism_digest: String,
}

/// Forbidden autonomy markers: none may occur in any audited surface
/// (ADR-026). Their presence would mean an autonomous E6/E7 path.
pub const FORBIDDEN_AUTONOMY_MARKERS: [&str; 6] = [
    "auto_merge",
    "self_approve",
    "autonomous_promote",
    "merge_without_review",
    "unreviewed_merge",
    "e7_autonomous_allow",
];

/// Material words that must never appear in a rendered report.
const FORBIDDEN_MATERIAL_WORDS: [&str; 6] = [
    "credential",
    "token",
    "password",
    "secret",
    "transcript",
    "plaintext",
];

/// The canonical TM-01..TM-16 mapping from
/// `docs/security/THREAT-MODEL-v0.md` to covering controls and tests.
#[must_use]
pub fn threat_register_baseline() -> Vec<ThreatCoverageDescriptor> {
    vec![
        ThreatCoverageDescriptor {
            id: "TM-01",
            control: "typed ContextBundle taints, deterministic PDP, default-deny egress",
            test: "crates/context-engine taint tests; crates/egress deny tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-02",
            control: "capability scopes, sandbox realms, worktree checkpoints, approval TTL",
            test: "crates/sandbox realm tests; crates/tool-broker checkpoint tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-03",
            control: "brokered credential leases, no ambient environment, redaction",
            test: "crates/secret-broker lease and canary tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-04",
            control: "manifest digest chain, digest-pinned dependencies, SBOM, signature",
            test: "crates/plugin-registry digest tests; crates/release-integrity provenance tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-05",
            control: "typed protocol decode, frame limits, no eval",
            test: "packages/agent-runtime protocol violation tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-06",
            control: "untrusted imported memory stays candidate until promotion approval",
            test: "crates/memory-authority poisoning tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-07",
            control: "E0-E7 source gates, paired evaluation, independent review",
            test: "crates/evolution ownership and gate tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-08",
            control: "authenticated subagent evidence, artifact hashes, judge reports",
            test: "crates/orchestrator spoof and false-success tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-09",
            control: "scoped task budgets, plugin circuit breaker, cancel propagation",
            test: "crates/model-providers budget tests; crates/effect-broker breaker tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-10",
            control: "risk-specific approvals, least scope, TTL, no allow-all default",
            test: "crates/policy approval policy tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-11",
            control: "E7 autonomous modification denied; protected release chain, freeze refusal",
            test: "crates/release-integrity rollback and root tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-12",
            control: "client-held keys, AEAD seals, epoch ledger, server-stream canary",
            test: "crates/sync-e2ee tamper and rollback tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-13",
            control: "tenant-qualified identifiers and attenuated delegation",
            test: "crates/enterprise cross-tenant tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-14",
            control: "hash-chain event store, checkpoints, idempotent replay",
            test: "crates/event-store recovery tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-15",
            control: "contain-first reflex ladder, Safe Mode, operator-only exit",
            test: "crates/health-supervisor H0-H4 tests",
        },
        ThreatCoverageDescriptor {
            id: "TM-16",
            control: "tracked-file safety and credential-pattern scans before publication",
            test: "scripts/verify-s00.mjs tracked-file safety checks",
        },
    ]
}

fn finding(family: InvariantFamily, code: &str, detail: String) -> InvariantFinding {
    InvariantFinding {
        family,
        code: code.to_owned(),
        detail,
    }
}

fn family_result(family: InvariantFamily, mut findings: Vec<InvariantFinding>) -> FamilyResult {
    findings.retain(|item| item.family == family);
    let passed = findings.is_empty();
    FamilyResult {
        family,
        passed,
        findings,
    }
}

/// Assert that no autonomous E6/E7 path exists in the audited surface:
/// every surface must report zero forbidden autonomy marker occurrences
/// (ADR-026; structural assertion over the collected surface).
///
/// # Errors
///
/// [`GateError::InvariantFailed`] when any surface reports a marker.
pub fn assert_no_autonomous_e6_e7(
    surfaces: &[EvolutionSurfaceDescriptor],
) -> Result<(), GateError> {
    for surface in surfaces {
        if surface.forbidden_marker_occurrences > 0 {
            return Err(GateError::InvariantFailed);
        }
    }
    Ok(())
}

/// Assert full threat-register coverage: exactly TM-01..TM-16, each
/// present once, each with a non-empty control and test reference.
///
/// # Errors
///
/// [`GateError::InvariantFailed`] on any missing, duplicated or
/// under-specified entry; [`GateError::Malformed`] on an empty register.
pub fn assert_threat_coverage(coverage: &[ThreatCoverageDescriptor]) -> Result<(), GateError> {
    if coverage.is_empty() {
        return Err(GateError::Malformed);
    }
    for index in 1..=16 {
        let id = format!("TM-{index:02}");
        let matching: Vec<&ThreatCoverageDescriptor> =
            coverage.iter().filter(|entry| entry.id == id).collect();
        if matching.len() != 1 {
            return Err(GateError::InvariantFailed);
        }
        let entry = matching[0];
        if entry.control.is_empty() || entry.test.is_empty() {
            return Err(GateError::InvariantFailed);
        }
    }
    Ok(())
}

/// Scan a rendered report for forbidden material words; the readiness
/// report is metadata-only and must stay that way (ADR-026).
///
/// # Errors
///
/// [`GateError::Malformed`] when the rendered report carries any
/// forbidden material word.
pub fn readiness_report_canary(report: &ReadinessReport) -> Result<(), GateError> {
    let Ok(rendered) = serde_json::to_string(report) else {
        return Err(GateError::Malformed);
    };
    let lowered = rendered.to_ascii_lowercase();
    if FORBIDDEN_MATERIAL_WORDS
        .iter()
        .any(|word| lowered.contains(word))
    {
        return Err(GateError::Malformed);
    }
    Ok(())
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn determinism_digest(verdict: ReadinessVerdict, families: &[FamilyResult]) -> String {
    let mut canonical = String::new();
    canonical.push_str(match verdict {
        ReadinessVerdict::Ready => "ready",
        ReadinessVerdict::NotReady => "not_ready",
    });
    for result in families {
        canonical.push('|');
        canonical.push_str(result.family.code());
        canonical.push(':');
        canonical.push_str(if result.passed { "pass" } else { "fail" });
        for item in &result.findings {
            canonical.push('|');
            canonical.push_str(&item.code);
        }
    }
    let digest = fnv1a64(canonical.as_bytes());
    format!("fnv1a:{digest:016x}")
}

fn contract_family_findings(input: &GateInput) -> Vec<InvariantFinding> {
    let mut findings = Vec::new();
    for contract in &input.contracts {
        if !contract.present {
            findings.push(finding(
                InvariantFamily::ContractsPresent,
                "missing_contract",
                format!("{} marker absent", contract.segment),
            ));
        }
    }
    findings
}

fn verifier_family_findings(input: &GateInput) -> Vec<InvariantFinding> {
    let mut findings = Vec::new();
    for verifier in &input.verifiers {
        if !verifier.local_present {
            findings.push(finding(
                InvariantFamily::VerifiersChained,
                "local_verifier_missing",
                format!("{} local verifier absent", verifier.segment),
            ));
        }
        if !verifier.remote_present || !verifier.chains_previous {
            findings.push(finding(
                InvariantFamily::VerifiersChained,
                "remote_chain_broken",
                format!("{} remote chain broken", verifier.segment),
            ));
        }
    }
    findings
}

fn tag_family_findings(input: &GateInput) -> Vec<InvariantFinding> {
    let mut findings = Vec::new();
    for tag in &input.tags {
        if !tag.annotated || !tag.resolves || !tag.after_previous {
            findings.push(finding(
                InvariantFamily::TagsResolve,
                "tag_unresolved",
                format!("{} unresolved or unordered", tag.segment),
            ));
        }
    }
    findings
}

fn hosted_gate_family_findings(input: &GateInput) -> Vec<InvariantFinding> {
    let mut findings = Vec::new();
    for gate in &input.hosted_gates {
        if gate.conclusion != GateConclusion::Success {
            findings.push(finding(
                InvariantFamily::HostedGatesGreen,
                "hosted_gate_not_green",
                format!("{} not successful", gate.context),
            ));
        }
    }
    findings
}

fn workspace_family_findings(input: &GateInput) -> Vec<InvariantFinding> {
    let mut findings = Vec::new();
    for member in &input.workspace_members {
        if !member.exists {
            findings.push(finding(
                InvariantFamily::WorkspaceHygiene,
                "stale_workspace_member",
                format!("{} declared but missing", member.path),
            ));
        }
    }
    findings
}

fn adr_family_findings(input: &GateInput) -> Vec<InvariantFinding> {
    let mut findings = Vec::new();
    for adr in &input.adrs {
        if !adr.accepted {
            findings.push(finding(
                InvariantFamily::AdrCoverage,
                "adr_not_accepted",
                format!("{} not accepted", adr.path),
            ));
        }
    }
    findings
}

fn evolution_family_findings(input: &GateInput) -> Vec<InvariantFinding> {
    let mut findings = Vec::new();
    if !input.e6_proposal_only {
        findings.push(finding(
            InvariantFamily::EvolutionBoundary,
            "e6_not_proposal_only",
            "protected-PR-only flag absent".to_owned(),
        ));
    }
    for surface in &input.evolution_surfaces {
        if surface.forbidden_marker_occurrences > 0 {
            findings.push(finding(
                InvariantFamily::EvolutionBoundary,
                "autonomous_evolution_path",
                format!(
                    "{} carries {} forbidden markers",
                    surface.surface, surface.forbidden_marker_occurrences
                ),
            ));
        }
    }
    findings
}

fn threat_family_findings(input: &GateInput) -> Vec<InvariantFinding> {
    let mut findings = Vec::new();
    if assert_threat_coverage(&input.threat_coverage).is_err() {
        findings.push(finding(
            InvariantFamily::ThreatCoverage,
            "threat_uncovered",
            "register incomplete or under-specified".to_owned(),
        ));
    }
    findings
}

fn verdict_of(families: &[FamilyResult]) -> ReadinessVerdict {
    if families.iter().all(|result| result.passed) {
        ReadinessVerdict::Ready
    } else {
        ReadinessVerdict::NotReady
    }
}

fn report_of(verdict: ReadinessVerdict, families: Vec<FamilyResult>) -> ReadinessReport {
    let total_findings = families.iter().map(|result| result.findings.len()).sum();
    ReadinessReport {
        verdict,
        total_findings,
        determinism_digest: determinism_digest(verdict, &families),
        families,
    }
}

/// Evaluate the full invariant checklist over the descriptor set. The
/// function is pure and total: a malformed descriptor set (empty
/// contracts, verifiers, tags or hosted gates — a gate over nothing)
/// errors instead of certifying anything.
///
/// # Errors
///
/// [`GateError::Malformed`] when the descriptor set cannot support a
/// meaningful gate. Findings never error; they mark families failed in
/// the returned report.
pub fn evaluate_gate(input: &GateInput) -> Result<ReadinessReport, GateError> {
    if input.contracts.is_empty()
        || input.verifiers.is_empty()
        || input.tags.is_empty()
        || input.hosted_gates.is_empty()
    {
        return Err(GateError::Malformed);
    }

    let mut families = vec![
        family_result(
            InvariantFamily::ContractsPresent,
            contract_family_findings(input),
        ),
        family_result(
            InvariantFamily::VerifiersChained,
            verifier_family_findings(input),
        ),
        family_result(InvariantFamily::TagsResolve, tag_family_findings(input)),
        family_result(
            InvariantFamily::HostedGatesGreen,
            hosted_gate_family_findings(input),
        ),
        family_result(
            InvariantFamily::WorkspaceHygiene,
            workspace_family_findings(input),
        ),
        family_result(InvariantFamily::AdrCoverage, adr_family_findings(input)),
        family_result(
            InvariantFamily::EvolutionBoundary,
            evolution_family_findings(input),
        ),
        family_result(
            InvariantFamily::ThreatCoverage,
            threat_family_findings(input),
        ),
    ];

    // Self-certification: the canary runs over the report being built.
    let provisional_verdict = verdict_of(&families);
    let provisional = report_of(provisional_verdict, families.clone());
    let mut report_findings = Vec::new();
    if readiness_report_canary(&provisional).is_err() {
        report_findings.push(finding(
            InvariantFamily::ReportHygiene,
            "report_carries_forbidden_material",
            "rendered report tripped the material canary".to_owned(),
        ));
    }
    families.push(family_result(
        InvariantFamily::ReportHygiene,
        report_findings,
    ));

    Ok(report_of(verdict_of(&families), families))
}

/// Fail closed unless every family passed (ADR-026).
///
/// # Errors
///
/// [`GateError::InvariantFailed`] when the report verdict is not ready.
pub fn assert_ready(report: &ReadinessReport) -> Result<(), GateError> {
    if report.verdict == ReadinessVerdict::Ready && report.total_findings == 0 {
        Ok(())
    } else {
        Err(GateError::InvariantFailed)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;

    fn healthy_input() -> GateInput {
        GateInput {
            contracts: vec![
                ContractDescriptor {
                    segment: "S00",
                    marker: "verify-s00",
                    present: true,
                },
                ContractDescriptor {
                    segment: "S23",
                    marker: "beta contracts",
                    present: true,
                },
            ],
            verifiers: vec![VerifierDescriptor {
                segment: "S23",
                local_present: true,
                remote_present: true,
                chains_previous: true,
            }],
            tags: vec![TagDescriptor {
                segment: "S23",
                tag: "s23-complete",
                annotated: true,
                resolves: true,
                after_previous: true,
            }],
            hosted_gates: vec![
                HostedGateDescriptor {
                    context: "repository-verification",
                    conclusion: GateConclusion::Success,
                },
                HostedGateDescriptor {
                    context: "dependency-audit",
                    conclusion: GateConclusion::Success,
                },
            ],
            workspace_members: vec![WorkspaceMemberDescriptor {
                path: "crates/production-gate",
                exists: true,
            }],
            adrs: vec![AdrDescriptor {
                path: "docs/adr/ADR-026-production-gate.md",
                accepted: true,
            }],
            evolution_surfaces: vec![EvolutionSurfaceDescriptor {
                surface: "crates/evolution",
                forbidden_marker_occurrences: 0,
            }],
            threat_coverage: threat_register_baseline(),
            e6_proposal_only: true,
        }
    }

    #[test]
    fn healthy_checklist_is_ready_and_metadata_only() {
        let report = evaluate_gate(&healthy_input()).unwrap();
        assert_eq!(report.verdict, ReadinessVerdict::Ready);
        assert_eq!(report.total_findings, 0);
        assert_eq!(report.families.len(), 9, "every family is reported");
        assert!(report.families.iter().all(|result| result.passed));
        assert!(assert_ready(&report).is_ok());
        assert!(readiness_report_canary(&report).is_ok());
        assert!(report.determinism_digest.starts_with("fnv1a:"));
    }

    #[test]
    fn missing_contract_fails_the_gate() {
        let mut input = healthy_input();
        input.contracts[0].present = false;
        let report = evaluate_gate(&input).unwrap();
        assert_eq!(report.verdict, ReadinessVerdict::NotReady);
        assert_eq!(assert_ready(&report), Err(GateError::InvariantFailed));
        let family = &report.families[0];
        assert!(!family.passed);
        assert_eq!(family.findings[0].code, "missing_contract");
        assert_eq!(family.findings[0].detail, "S00 marker absent");
    }

    #[test]
    fn missing_verifier_or_tag_fails_the_gate() {
        let mut input = healthy_input();
        input.verifiers[0].chains_previous = false;
        let report = evaluate_gate(&input).unwrap();
        assert_eq!(report.verdict, ReadinessVerdict::NotReady);
        assert_eq!(report.families[1].findings[0].code, "remote_chain_broken");

        let mut input = healthy_input();
        input.tags[0].annotated = false;
        let report = evaluate_gate(&input).unwrap();
        assert_eq!(report.verdict, ReadinessVerdict::NotReady);
        assert_eq!(report.families[2].findings[0].code, "tag_unresolved");

        // A pending hosted gate is not green either.
        let mut input = healthy_input();
        input.hosted_gates[1].conclusion = GateConclusion::Pending;
        let report = evaluate_gate(&input).unwrap();
        assert_eq!(report.verdict, ReadinessVerdict::NotReady);
        assert_eq!(
            report.families[3].findings[0].detail,
            "dependency-audit not successful"
        );
    }

    #[test]
    fn stale_member_or_missing_adr_fails() {
        let mut input = healthy_input();
        input.workspace_members[0].exists = false;
        let report = evaluate_gate(&input).unwrap();
        assert_eq!(
            report.families[4].findings[0].code,
            "stale_workspace_member"
        );

        let mut input = healthy_input();
        input.adrs[0].accepted = false;
        let report = evaluate_gate(&input).unwrap();
        assert_eq!(report.families[5].findings[0].code, "adr_not_accepted");
    }

    #[test]
    fn gate_is_deterministic_across_runs() {
        let first = evaluate_gate(&healthy_input()).unwrap();
        let second = evaluate_gate(&healthy_input()).unwrap();
        assert_eq!(first, second, "identical inputs, identical reports");
        assert_eq!(
            first.determinism_digest, second.determinism_digest,
            "the checksum certifies determinism"
        );
        let mut input = healthy_input();
        input.contracts[1].present = false;
        let changed = evaluate_gate(&input).unwrap();
        assert_ne!(first.determinism_digest, changed.determinism_digest);
    }

    #[test]
    fn gate_over_nothing_is_malformed() {
        let empty = GateInput::default();
        assert_eq!(evaluate_gate(&empty), Err(GateError::Malformed));
    }

    #[test]
    fn every_threat_entry_maps_to_control_and_test() {
        let baseline = threat_register_baseline();
        assert_eq!(baseline.len(), 16, "TM-01..TM-16 exactly");
        assert!(assert_threat_coverage(&baseline).is_ok());
        for entry in &baseline {
            assert!(!entry.control.is_empty(), "{} control", entry.id);
            assert!(!entry.test.is_empty(), "{} test", entry.id);
        }
        // Missing one entry fails.
        let mut broken: Vec<ThreatCoverageDescriptor> = baseline.clone();
        broken.remove(7);
        assert_eq!(
            assert_threat_coverage(&broken),
            Err(GateError::InvariantFailed)
        );
        // A duplicated entry fails.
        let mut duplicated: Vec<ThreatCoverageDescriptor> = baseline.clone();
        duplicated.push(duplicated[0]);
        assert_eq!(
            assert_threat_coverage(&duplicated),
            Err(GateError::InvariantFailed)
        );
        // An under-specified entry fails.
        let mut hollow: Vec<ThreatCoverageDescriptor> = baseline.clone();
        hollow[2] = ThreatCoverageDescriptor {
            id: "TM-03",
            control: "",
            test: "",
        };
        assert_eq!(
            assert_threat_coverage(&hollow),
            Err(GateError::InvariantFailed)
        );
        // An empty register is malformed, never green.
        assert_eq!(assert_threat_coverage(&[]), Err(GateError::Malformed));
        // Under-specified coverage fails the full gate too.
        let mut input = healthy_input();
        input.threat_coverage = hollow;
        let report = evaluate_gate(&input).unwrap();
        assert_eq!(report.verdict, ReadinessVerdict::NotReady);
        assert_eq!(report.families[7].findings[0].code, "threat_uncovered");
    }

    #[test]
    fn no_autonomous_e6_e7_path_exists() {
        // Zero markers across every audited surface passes.
        let clean = vec![
            EvolutionSurfaceDescriptor {
                surface: "crates/evolution",
                forbidden_marker_occurrences: 0,
            },
            EvolutionSurfaceDescriptor {
                surface: "crates/release-integrity",
                forbidden_marker_occurrences: 0,
            },
        ];
        assert!(assert_no_autonomous_e6_e7(&clean).is_ok());
        // Any occurrence fails the structural assertion.
        let poisoned = vec![EvolutionSurfaceDescriptor {
            surface: "crates/orchestrator",
            forbidden_marker_occurrences: 1,
        }];
        assert_eq!(
            assert_no_autonomous_e6_e7(&poisoned),
            Err(GateError::InvariantFailed)
        );
        // Dropping the proposal-only flag fails the boundary family.
        let mut input = healthy_input();
        input.e6_proposal_only = false;
        let report = evaluate_gate(&input).unwrap();
        assert_eq!(report.families[6].findings[0].code, "e6_not_proposal_only");
        // A marker on any surface fails the full gate too.
        let mut input = healthy_input();
        input.evolution_surfaces[0].forbidden_marker_occurrences = 2;
        let report = evaluate_gate(&input).unwrap();
        assert_eq!(report.verdict, ReadinessVerdict::NotReady);
        assert_eq!(
            report.families[6].findings[0].code,
            "autonomous_evolution_path"
        );
    }

    #[test]
    fn readiness_report_is_metadata_only() {
        let healthy = evaluate_gate(&healthy_input()).unwrap();
        assert!(readiness_report_canary(&healthy).is_ok());
        // A poisoned finding detail trips the canary (negative fixture).
        let mut poisoned = healthy.clone();
        poisoned.families[0].findings.push(InvariantFinding {
            family: InvariantFamily::ContractsPresent,
            code: "missing_contract".to_owned(),
            detail: "token=0123456789abcdef".to_owned(),
        });
        assert_eq!(
            readiness_report_canary(&poisoned),
            Err(GateError::Malformed)
        );
        // The gate self-certifies: a poisoned detail also fails the
        // ReportHygiene family inside evaluate_gate.
        let mut input = healthy_input();
        // The only route to a poisoned report is a poisoned descriptor
        // detail; surfaces carry counts, so simulate via a poisoned path
        // reference that renders forbidden material.
        input.workspace_members.push(WorkspaceMemberDescriptor {
            path: "crates/token-exfiltration",
            exists: false,
        });
        let report = evaluate_gate(&input).unwrap();
        assert_eq!(report.verdict, ReadinessVerdict::NotReady);
        let hygiene = report
            .families
            .iter()
            .find(|result| result.family == InvariantFamily::ReportHygiene)
            .unwrap();
        assert!(!hygiene.passed, "the canary fails the report itself");
    }
}
