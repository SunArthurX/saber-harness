/**
 * S29-WP03/WP04 — context preview/receipt and selector policy tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const receipts = await src("contextReceipt.js");
const selectors = await src("selectorPolicy.js");

function fragment(overrides = {}) {
  return {
    sourceId: "src/panel.ts:10-40",
    sourceType: "file-selection",
    revision: "rev-abc123",
    reason: "user-pinned",
    trust: "high",
    sensitivity: "internal",
    tokenEstimate: 120,
    transformation: "none",
    destinationProvider: "cloud-a",
    retentionPolicy: "request-only",
    ...overrides,
  };
}

test("S29-WP03 fragments must declare every provenance field", () => {
  const preview = new receipts.ContextPreview();
  for (const field of receipts.FRAGMENT_FIELDS) {
    const broken = fragment();
    broken[field] = undefined;
    assert.throws(() => preview.add(broken), new RegExp(`missing_fragment_field:${field}`), field);
  }
  assert.throws(() => preview.add(fragment({ trust: "ultimate" })), /invalid_trust/);
  assert.throws(() => preview.add(fragment({ tokenEstimate: -1 })), /invalid_token_estimate/);
  assert.equal(receipts.FRAGMENT_FIELDS.length, 10);
});

test("S29-WP03 secret fragments are refused before the preview", () => {
  const preview = new receipts.ContextPreview();
  assert.throws(() => preview.add(fragment({ sensitivity: "secret" })), /secret_fragment_not_dispatchable/);
});

test("S29-WP03 preview totals reconcile with the sent receipt", () => {
  const preview = new receipts.ContextPreview();
  preview.add(fragment());
  preview.add(fragment({ sourceId: "goal-1", sourceType: "goal", tokenEstimate: 80, sensitivity: "confidential" }));
  const totals = preview.totals();
  assert.equal(totals.fragmentCount, 2);
  assert.equal(totals.tokenEstimate, 200);
  assert.deepEqual(totals.providers, ["cloud-a"]);
  const receipt = preview.receipt("req-1", 1000);
  const check = receipts.reconcile(totals, receipt);
  assert.equal(check.reconciled, true);
  const divergent = receipts.reconcile(totals, { ...receipt, tokenEstimate: 999 });
  assert.equal(divergent.reconciled, false);
  assert.ok(divergent.divergences.some((line) => line.includes("token-estimate")));
});

test("S29-WP03 exclusion removes before dispatch and creates evidence", () => {
  const preview = new receipts.ContextPreview();
  preview.add(fragment());
  preview.add(fragment({ sourceId: "goal-1", sourceType: "goal", tokenEstimate: 80 }));
  const evidence = preview.exclude("src/panel.ts:10-40", 2000);
  assert.equal(evidence.kind, "context.fragment_excluded");
  assert.equal(evidence.wouldHaveGoneTo, "cloud-a");
  assert.equal(preview.totals().fragmentCount, 1);
  assert.equal(preview.totals().tokenEstimate, 80);
  const receipt = preview.receipt("req-2", 2001);
  assert.equal(receipt.excludedCount, 1);
  assert.equal(
    receipt.fragments.every((entry) => entry.sourceId !== "src/panel.ts:10-40"),
    true,
  );
  assert.throws(() => preview.exclude("src/panel.ts:10-40", 1), /unknown_fragment/);
});

test("S29-WP03 context chips expose name, source and keyboard removal", () => {
  const chip = receipts.contextChip(fragment());
  assert.equal(chip.name, "src/panel.ts:10-40");
  assert.equal(chip.source, "file-selection");
  assert.equal(chip.keyboardRemovable, true);
  assert.equal(chip.removeAction, "saber.conversation.excludeFragment");
});

test("S29-WP04 model registry shows deployment, limit, price and eligibility", () => {
  const local = selectors.MODELS.find((entry) => entry.deployment === "local");
  assert.ok(local && local.contextLimitTokens > 0 && local.priceClass === "free");
  const policy = {
    policyTags: ["offline", "no-egress"],
    priceClasses: [],
    realms: ["local"],
    capabilities: ["read.browse", "read.search"],
  };
  const selection = selectors.effectiveSelection(policy, {
    modelKey: "local/saber-local-8b",
    realmId: "local",
    autonomy: "read-only",
    budget: { tokens: 1000 },
  });
  assert.equal(selection.model.eligible, true);
  assert.equal(selection.model.deployment, "local");
  assert.equal(selection.realm.boundary, "this machine");
  assert.equal(selection.realm.dataEgress, "none");
  assert.deepEqual(selection.divergences, []);
});

test("S29-WP04 full access cannot bypass Core policy", () => {
  const policy = {
    policyTags: ["offline", "no-egress"],
    priceClasses: [],
    realms: ["local"],
    capabilities: ["read.browse", "read.search"], // policy grants read only
  };
  const selection = selectors.effectiveSelection(policy, {
    modelKey: "local/saber-local-8b",
    realmId: "local",
    autonomy: "governed-full",
  });
  assert.deepEqual(selection.autonomy.grantedCapabilities, ["read.browse", "read.search"]);
  assert.ok(selection.autonomy.droppedCapabilities.includes("exec.host"));
  assert.ok(selection.divergences.some((line) => line.startsWith("clamped-by-policy")));
  const cloudDenied = selectors.effectiveSelection(policy, {
    modelKey: "cloud-a/standard",
    realmId: "cloud",
    autonomy: "read-only",
  });
  assert.equal(cloudDenied.model.eligible, false);
  assert.equal(cloudDenied.realm.eligible, false);
  assert.ok(cloudDenied.divergences.includes("model-not-eligible:cloud-a/standard"));
  assert.ok(cloudDenied.divergences.includes("realm-not-permitted:cloud"));
});

test("S29-WP04 budget selector clamps to hard and policy ceilings", () => {
  const generous = {
    policyTags: ["egress-approved"],
    priceClasses: ["standard"],
    realms: ["cloud"],
    capabilities: [...selectors.CAPABILITIES],
    budgetCeilings: { tokens: 5000, moneyUsd: 2 },
  };
  const selection = selectors.effectiveSelection(generous, {
    modelKey: "cloud-a/standard",
    realmId: "cloud",
    autonomy: "sandboxed-edit",
    budget: { tokens: 1_000_000, moneyUsd: 50, wallClockMinutes: 10, toolCalls: 3 },
  });
  assert.equal(selection.budget.tokens, 5000, "policy ceiling wins over the request");
  assert.equal(selection.budget.moneyUsd, 2);
  assert.equal(selection.budget.wallClockMinutes, 10);
  assert.equal(selection.budget.toolCalls, 3);
  assert.ok(selection.budget.tokens <= selectors.BUDGET_LIMITS.tokens);
});

test("S29-WP04 realms expose boundary and egress; capabilities are closed", () => {
  for (const realm of selectors.REALMS) {
    assert.ok(realm.boundary.length > 0);
    assert.ok(realm.dataEgress.length > 0);
  }
  const allPresetCapabilities = Object.values(selectors.AUTONOMY_PRESETS).flat();
  assert.ok(allPresetCapabilities.every((capability) => selectors.CAPABILITIES.includes(capability)));
});
