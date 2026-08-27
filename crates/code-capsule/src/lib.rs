//! Isolated typed Code Capsules (ADR-018).

pub mod capsule;
pub mod registry;

pub use capsule::{
    CAPSULE_SCHEMA_VERSION, CapsuleError, CodeCapsule, DependencyLock, capsule_digest_of,
    capsule_id_of, source_digest_of,
};
pub use registry::{CapsuleRegistry, ExecutionAuthorization, grant, plan_for_authorization};

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use saber_memory_authority::ReviewAuthority;
    use saber_orchestrator::{Grant, Selector};
    use saber_policy::Action;
    use saber_sandbox::{BudgetSpec, Realm};

    use super::*;

    const SOURCE: &[u8] = b"fn improve() { analyze(); }";

    fn review() -> ReviewAuthority {
        ReviewAuthority::HumanReview {
            reviewer_id: "human_01".to_owned(),
        }
    }

    fn capsule(name: &str, version: u32, prefix: &str) -> CodeCapsule {
        let source_digest = source_digest_of(SOURCE);
        let draft = CodeCapsule {
            capsule_id: String::new(),
            schema_version: CAPSULE_SCHEMA_VERSION.to_owned(),
            name: name.to_owned(),
            version,
            source_digest: source_digest.clone(),
            dependencies: vec![DependencyLock {
                name: "analysis-lib".to_owned(),
                digest: format!("sha256:{}", "a".repeat(64)),
            }],
            grants: vec![Grant {
                action: Action::FsRead,
                selector: Selector::Prefix(format!("workspace://ws_01/{prefix}")),
            }],
            realm: Realm::S3IsolatedOverlay,
            budget: BudgetSpec::default_budget(),
            capsule_digest: String::new(),
        };
        let capsule_digest = capsule_digest_of(&draft);
        CodeCapsule {
            capsule_id: capsule_id_of(name, &capsule_digest),
            capsule_digest,
            ..draft
        }
    }

    fn admitted(registry: &mut CapsuleRegistry, name: &str, version: u32, prefix: &str) -> String {
        let capsule = capsule(name, version, prefix);
        let id = capsule.capsule_id.clone();
        registry.admit(capsule, SOURCE).unwrap();
        id
    }

    #[test]
    fn admission_requires_the_exact_source_digest() {
        let mut registry = CapsuleRegistry::new();
        let id = admitted(&mut registry, "formatter", 1, "repo");
        registry.evaluate(&id, true).unwrap();
        registry.promote(&id, &review(), 1_000).unwrap();
        assert_eq!(registry.active_version("formatter"), Some(id.as_str()));

        // Tampered source bytes under the same declared digest: refused.
        let mut evil = capsule("formatter", 2, "repo");
        evil.version = 2;
        let rebuilt = CodeCapsule {
            capsule_digest: capsule_digest_of(&evil),
            capsule_id: capsule_id_of("formatter", &capsule_digest_of(&evil)),
            ..evil.clone()
        };
        assert_eq!(
            registry.admit(rebuilt, b"fn evil() { exfiltrate(); }"),
            Err(CapsuleError::DigestMismatch)
        );
        // Tampered envelope digest: refused at validate().
        let mut bad_digest = capsule("other", 1, "repo");
        bad_digest.capsule_digest = format!("sha256:{}", "0".repeat(64));
        assert_eq!(
            registry.admit(bad_digest, SOURCE),
            Err(CapsuleError::DigestMismatch)
        );
    }

    #[test]
    fn unpromoted_capsules_never_execute() {
        let mut registry = CapsuleRegistry::new();
        let id = admitted(&mut registry, "helper", 1, "repo");
        let read = Grant {
            action: Action::FsRead,
            selector: Selector::Exact("workspace://ws_01/repo/a.txt".to_owned()),
        };
        // Candidate state: not executable.
        assert_eq!(
            registry.authorize_execution(&id, std::slice::from_ref(&read), &["analysis-lib"]),
            Err(CapsuleError::NotPromoted)
        );
        // Evaluated but unreviewed: still not executable.
        registry.evaluate(&id, true).unwrap();
        assert_eq!(
            registry.authorize_execution(&id, &[read], &["analysis-lib"]),
            Err(CapsuleError::NotPromoted)
        );
    }

    #[test]
    fn undeclared_grants_and_dependencies_fail_closed() {
        let mut registry = CapsuleRegistry::new();
        let id = admitted(&mut registry, "reader", 1, "repo");
        registry.evaluate(&id, true).unwrap();
        registry.promote(&id, &review(), 1_000).unwrap();

        // Declared grant within the capsule's prefix: authorized.
        let declared = Grant {
            action: Action::FsRead,
            selector: Selector::Exact("workspace://ws_01/repo/a.txt".to_owned()),
        };
        let pinned = ["analysis-lib"];
        assert!(
            registry
                .authorize_execution(&id, std::slice::from_ref(&declared), &pinned)
                .is_ok()
        );

        // A grant outside the declared prefix: undeclared, refused.
        let outside = Grant {
            action: Action::FsRead,
            selector: Selector::Exact("workspace://ws_01/secrets/keys".to_owned()),
        };
        assert_eq!(
            registry.authorize_execution(&id, &[outside], &pinned),
            Err(CapsuleError::UndeclaredGrant)
        );
        // A foreign action: undeclared, refused.
        let write = Grant {
            action: Action::FsWrite,
            selector: Selector::Exact("workspace://ws_01/repo/a.txt".to_owned()),
        };
        assert_eq!(
            registry.authorize_execution(&id, &[write], &pinned),
            Err(CapsuleError::UndeclaredGrant)
        );
        // An unpinned dependency: refused.
        assert_eq!(
            registry.authorize_execution(&id, &[declared], &["evil-lib"]),
            Err(CapsuleError::UndeclaredDependency)
        );
    }

    #[test]
    fn budget_exhaustion_terminates_eligibility() {
        let mut registry = CapsuleRegistry::new();
        let id = admitted(&mut registry, "bounded", 1, "repo");
        registry.evaluate(&id, true).unwrap();
        registry.promote(&id, &review(), 1_000).unwrap();
        let declared = Grant {
            action: Action::FsRead,
            selector: Selector::Exact("workspace://ws_01/repo/a.txt".to_owned()),
        };
        registry.consume_budget(&id, u64::MAX);
        assert_eq!(
            registry.authorize_execution(&id, &[declared], &["analysis-lib"]),
            Err(CapsuleError::BudgetExhausted)
        );
    }

    #[test]
    fn grants_never_widen_across_versions_and_history_rolls_back() {
        let mut registry = CapsuleRegistry::new();
        let v1 = admitted(&mut registry, "tool", 1, "repo");
        registry.evaluate(&v1, true).unwrap();
        registry.promote(&v1, &review(), 1_000).unwrap();

        // Version 2 with a WIDER prefix: supersession refused.
        let wide = capsule("tool", 2, "ws-wide");
        assert_eq!(registry.admit(wide, SOURCE), Err(CapsuleError::Escalation));

        // Version 2 within the previous grants: admitted and activated.
        let v2 = admitted(&mut registry, "tool", 2, "repo");
        registry.evaluate(&v2, true).unwrap();
        registry.promote(&v2, &review(), 2_000).unwrap();
        assert_eq!(registry.active_version("tool"), Some(v2.as_str()));
        assert_eq!(registry.history("tool").len(), 2, "history retained");

        // Rollback to version 1 is explicit and clean.
        registry.rollback("tool", &v1).unwrap();
        assert_eq!(registry.active_version("tool"), Some(v1.as_str()));
        assert!(registry.rollback("tool", "missing").is_err());
    }

    #[test]
    fn malformed_locks_and_versions_fail_admission() {
        let mut registry = CapsuleRegistry::new();
        let mut unpinned = capsule("bad", 1, "repo");
        unpinned.dependencies[0].digest = "nope".to_owned();
        assert_eq!(
            registry.admit(unpinned, SOURCE),
            Err(CapsuleError::Malformed)
        );
        let mut zero_version = capsule("bad", 0, "repo");
        zero_version.version = 0;
        // Rebuild digests so the failure is the shape, not tampering.
        let rebuilt = CodeCapsule {
            capsule_digest: capsule_digest_of(&zero_version),
            capsule_id: capsule_id_of("bad", &capsule_digest_of(&zero_version)),
            ..zero_version
        };
        assert_eq!(
            registry.admit(rebuilt, SOURCE),
            Err(CapsuleError::Malformed)
        );
    }

    #[test]
    fn authorization_builds_a_realm_bound_plan() {
        let _registry = CapsuleRegistry::new();
        let authorization = ExecutionAuthorization {
            capsule_id: "cap_01".to_owned(),
            realm: Realm::S3IsolatedOverlay,
            grants: vec![],
            budget_wall_clock_ms: 5_000,
        };
        let plan = plan_for_authorization(&authorization, std::path::Path::new("/tmp/ov"));
        assert_eq!(plan.realm, Realm::S3IsolatedOverlay);
        assert_eq!(plan.budget.wall_clock_ms, 5_000);
        assert!(
            plan.command.is_none(),
            "the plan binds; execution goes through the S06 SPI"
        );
    }
}
