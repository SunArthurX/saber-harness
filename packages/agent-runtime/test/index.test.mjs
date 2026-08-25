import assert from "node:assert/strict";
import test from "node:test";

import { runtimeIdentity } from "../dist/index.js";

test("runtime identity is stable and model-neutral", () => {
  assert.equal(runtimeIdentity(), "saber-agent-runtime/0.1.0");
});
