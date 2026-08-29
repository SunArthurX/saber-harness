/**
 * S32-WP01 — Goal DAG tests.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const src = (name) => import(pathToFileURL(join(root, "apps/desktop-codeoss/extensions/saber-agent/src", name)).href);

const goalDag = await src("goalDag.js");

const TASKS = [
  { id: "a", dependsOn: [], acceptance: ["a1"], budget: { tokens: 100 } },
  { id: "b", dependsOn: ["a"], acceptance: ["b1"], budget: { tokens: 50 } },
  { id: "c", dependsOn: ["a"], acceptance: ["c1"], budget: { tokens: 50 } },
  { id: "d", dependsOn: ["b", "c"], acceptance: ["d1"], budget: { tokens: 10 } },
];

test("S32-WP01 a valid DAG passes; failures list every problem", () => {
  const valid = goalDag.validateDag(TASKS);
  assert.deepEqual(valid.failures, []);
  const broken = goalDag.validateDag([
    { id: "x", dependsOn: ["ghost"], acceptance: [], budget: { tokens: -1 } },
    { id: "y", dependsOn: ["x"], acceptance: ["y1"], budget: {} },
    { id: "x2", dependsOn: ["cycle-b"], acceptance: ["x21"], budget: {} },
    { id: "cycle-b", dependsOn: ["x2"], acceptance: [], budget: {} },
  ]);
  assert.ok(broken.failures.some((failure) => failure.startsWith("missing-dependency:x:ghost")));
  assert.ok(broken.failures.some((failure) => failure.startsWith("impossible-budget:x")));
  assert.ok(broken.failures.some((failure) => failure.startsWith("missing-acceptance:x")));
  assert.ok(broken.failures.some((failure) => failure.startsWith("cycle:")));
});

test("S32-WP01 scheduling shows waiting reasons, never vague percentages", () => {
  const view = goalDag.schedulingView(TASKS, { a: "running", b: "running", c: "blocked" });
  const c = view.find((task) => task.id === "c");
  assert.equal(c.state, "blocked");
  assert.deepEqual([...c.waitingReasons], ["dependency:a"]);
  const d = view.find((task) => task.id === "d");
  assert.equal(d.waitingReasons.length, 2, "d waits on b and c");
  assert.ok(view.every((task) => !("progressPercent" in task)));
});

test("S32-WP01 the critical path is the longest dependency chain", () => {
  assert.deepEqual([...goalDag.criticalPath(TASKS)], ["a", "b", "d"]);
});

test("S32-WP01 nodes carry the full role declaration surface", () => {
  const view = goalDag.schedulingView(
    [
      {
        id: "a",
        dependsOn: [],
        acceptance: ["a1"],
        budget: { tokens: 10 },
        agent: "worker-1",
        model: "fixture",
        realm: "local",
        worktree: "wt-a",
      },
    ],
    { a: "ready" },
  );
  const node = view[0];
  assert.equal(node.agent, "worker-1");
  assert.equal(node.model, "fixture");
  assert.equal(node.realm, "local");
  assert.equal(node.worktree, "wt-a");
  assert.deepEqual([...node.evidenceGate], ["a1"]);
});
