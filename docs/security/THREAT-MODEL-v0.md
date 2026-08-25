# Threat Model v0

Status: accepted baseline for S01
Method: asset/boundary-driven analysis aligned to OWASP agentic risk themes and NIST AI RMF lifecycle concepts

## Protected assets

- user and organization authority, policy and approvals;
- source code, conversations, governed memory and customer data;
- credentials, device/workspace keys and signing roots;
- event history, provenance, evaluation and release evidence;
- host, sandbox, network and external-service side effects;
- availability, budgets and cross-tenant isolation.

## Threat actors

- malicious or compromised external content/provider/agent;
- vulnerable or malicious plugin, dependency or generated code;
- over-privileged model/agent or confused-deputy user workflow;
- compromised local device, enterprise operator or CI identity;
- ordinary sync/control-plane service attempting content access or rollback;
- accidental operator error and correlated infrastructure failure.

## Threat register

| ID | Threat and attack path | Assets | Prevent/detect/respond baseline | Verification target |
|---|---|---|---|---|
| TM-01 | prompt/goal injection turns README, web or tool output into an upload instruction | authority, code, secrets | taint, typed context, deterministic PDP, default-deny egress | adversarial context/egress tests |
| TM-02 | legitimate shell/tool is composed into destructive or out-of-scope behavior | host, repo, external systems | capability scope, sandbox, resource hash, approval TTL, idempotency | deny/TOCTOU/destructive-action tests |
| TM-03 | model or plugin obtains ambient user credentials | credentials, production systems | Secret Broker, workload identity, no inherited host env, output redaction | canary-secret and env-isolation tests |
| TM-04 | malicious Skill/Plugin/MCP dependency executes during install or runtime | host, supply chain | source gate, digest lock, SBOM, signature, quarantine, isolated host | install/runtime escape tests |
| TM-05 | tool output is evaluated as code or crosses typed protocol boundary | Core, host | schema validation, no eval, size/deadline/backpressure, sandbox | protocol fuzz/property tests |
| TM-06 | imported content poisons durable memory or rules | knowledge, future decisions | untrusted default, candidate state, provenance, scope, TTL, promotion approval | poisoning/revocation/recall tests |
| TM-07 | runtime evidence poisons Skill, Tool or Core self-evolution | product integrity | E0–E7 source gates, paired eval, independent review, E7 prohibition | evolution ownership/hash/gate tests |
| TM-08 | forged subagent/provider result is treated as authoritative success | run integrity | authenticated actor/channel, artifact hash, verification evidence, kernel state machine | spoof/replay/false-success tests |
| TM-09 | retry storms or multi-agent cascades amplify cost and damage | availability, budget | scoped budgets, circuit breaker, failure domains, cancel propagation | overload/fault-injection tests |
| TM-10 | dark-pattern approval causes broad permanent privilege | authority, data | risk-specific approval, least scope, TTL, no allow-all default | approval UX/policy tests |
| TM-11 | agent modifies policy, updater, crypto or audit root | trust root | E7 autonomous deny, separated identities, protected build/signing | E7 negative and release-auth tests |
| TM-12 | sync server reads, replaces or rolls back knowledge | confidentiality, integrity | client AEAD, signed manifests, epochs/Merkle roots, local key custody | tamper/rollback/restore tests |
| TM-13 | tenant/workspace identifiers omitted from cache/index/queue paths | customer isolation | tenant-qualified keys and processes, attenuated delegation | cross-tenant property tests |
| TM-14 | crash between intent and result duplicates an external side effect | external state, audit | transactional event/outbox, idempotency, reconcile/read-after-write | kill-9/replay tests |
| TM-15 | health subsystem or repair loop worsens an incident | availability, evidence | contain first, bounded deterministic reflexes, cooldown, Safe Mode, escalation | H0–H4 game-day tests |
| TM-16 | public repository accidentally exposes historical sensitive artifacts | credentials, research | pre-publication full-history scan, secret CI, ignored extraction data | history/tracked-file scan |

## Abuse cases requiring external authority

Stop autonomous recovery and produce a minimal diagnostic bundle for suspected trust-root/signing-key exposure, sandbox escape, unexplained audit-chain break, repeated rollback failure, irreversible recovery choice, notification obligation, third-party/OS vulnerability, or any repair requiring broader privilege/data scope.

## Residual risks

- A fully compromised, unlocked endpoint can observe plaintext available to that user.
- Revocation cannot erase plaintext already copied by a previously authorized device.
- Deterministic controls reduce but cannot prove absence of all semantic prompt attacks.
- Public source visibility increases reconnaissance and supply-chain impersonation risk; release signatures and provenance remain necessary.

## Update triggers

Revise this model when a trust boundary, principal type, external processor, data class, side effect, self-evolution level, sync mode or release authority changes; after a material incident; and at every enterprise release Gate.
