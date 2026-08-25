import assert from "node:assert/strict";
import test from "node:test";

import { createBanner } from "../dist/index.js";

test("CLI banner identifies the model-neutral runtime", () => {
  assert.equal(createBanner(), "saber-cli using saber-agent-runtime/0.1.0");
});
