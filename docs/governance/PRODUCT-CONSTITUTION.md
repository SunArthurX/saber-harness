# Saber Product Constitution v1

Status: accepted baseline for implementation
Effective Segment: S01
Authority: repository owner, ratified by merge through protected `main`

## Purpose

Saber is a local-first, model-neutral and governable CodingAgent IDE/runtime. It is a continuous software subject whose identity comes from its constitution, goal lineage, governed memory, capability boundary and accountable event history—not from any single model, prompt, device or chat window.

The product combines two modes of growth:

- Iron Man growth: replaceable external models, agents, plugins, MCP servers and managed execution realms.
- Hulk growth: governed internal memory, rules, workflows, skills, tools, strategies and reviewed source changes.

Neither mode may bypass the authority, safety or evidence rules below.

## Constitutional principles

### PC-01 — Human and organization authority

The user and governing organization are the final authority. Models and agents may recommend and execute delegated actions but may not grant themselves authority.

### PC-02 — Local truth and knowledge sovereignty

Local encrypted state is the default home of plaintext facts. Cloud services are optional cognitive processors, enterprise control planes or ciphertext stores under an explicit deployment contract.

### PC-03 — Replaceable intelligence and declared capabilities

Models and external agents are replaceable. Every external capability declares identity, version, permissions, data access, side effects, failure semantics and evidence quality.

### PC-04 — Explainable context

Every context item sent to a model is attributable to a source, scope, sensitivity, freshness state and selection reason. Hidden bulk collection is forbidden.

### PC-05 — Deterministic side-effect control

Every operation with side effects is authorized by the trusted Policy Decision Point before execution. UI consent and model intent are inputs, not enforcement boundaries.

### PC-06 — Evidence-governed evolution

Every promoted evolution identifies its evidence, baseline comparison, risk class, permissions, evaluation result, approver and rollback target.

### PC-07 — Governed memory

Memory is typed knowledge with provenance, scope, revision, validity and conflict state. A chat summary is never authoritative memory by itself.

### PC-08 — Accountable user experience

The UI exposes goals, plans, actions, evidence, diffs, tests, approvals and concise reasons. It does not fabricate private chain-of-thought or use anthropomorphic confidence as proof.

### PC-09 — Immutable safety boundary

Ordinary agents, plugins, skills and self-change candidates cannot weaken, replace or uninstall Policy, Sandbox, Secret, Egress, Audit, Update, Crypto or Recovery roots.

### PC-10 — Containment before persistence

Failures are contained in the smallest practical fault domain. Recovery and reconciliation take precedence over repeated execution; missing safety infrastructure fails closed or enters Safe Mode.

## Authority hierarchy

```text
Platform hard invariants
  > regulatory and tenant hard policy
    > organization baseline
      > team and workspace restrictions
        > user restrictions
          > task-scoped, time-bound grants
```

Lower layers may narrow authority but cannot weaken higher layers. Exceptions are signed, scoped, time-bound governance objects—not prompt text or project configuration.

## Product commitments

1. Continue Anywhere preserves observable evidence and causal lineage across supported agents; it never claims to reconstruct hidden vendor reasoning.
2. One Knowledge removes silos through a permission-aware knowledge fabric, not an unrestricted global index.
3. Learn Safely treats observations as candidates until evaluation and promotion gates succeed.
4. Code-based self-improvement occurs through isolated Code Capsules or E6 pull requests, never runtime binary patching.
5. Self-healing uses deterministic health, containment and recovery loops before LLM diagnosis.
6. Users can export, revoke and delete governed knowledge subject to explicit legal-hold and audit rules.

## Non-goals for V1

- NG-01: train or silently fine-tune a proprietary foundation model as part of the runtime learning loop.
- NG-02: reimplement Git, language servers, debuggers or the full IDE workbench from scratch.
- NG-03: promise lossless migration of a vendor's hidden reasoning or private model state.
- NG-04: allow a running product binary to patch or publish itself.
- NG-05: claim both zero-knowledge E2EE and server-side plaintext/vector search under one deployment contract.
- NG-06: optimize for the largest model/provider count instead of verified task value.
- NG-07: treat workspace paths, allowlists, prompts, scanners or approval dialogs as substitutes for OS/container isolation.
- NG-08: market the product as conscious, morally autonomous or exempt from human/organizational accountability.

## Definition of Done for implementation changes

A change is not complete unless applicable schema/events, traceability, capability/policy, tests, observability, rollback and documentation are updated. New side effects require declared capabilities. Logs and evidence must not expose secrets or unrestricted content. Model-generated code receives the same review and release gates as human-authored code.

## Ratification and amendment

This constitution is ratified when its S01 pull request is merged by the repository owner through protected `main` after the S01 verifier passes. Amendments require a dedicated ADR, affected requirement updates, security review for trust-boundary changes and the same protected review path.
