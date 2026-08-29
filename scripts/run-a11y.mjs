#!/usr/bin/env node
/**
 * Accessibility test runner with journeys (S28/S29).
 *
 * `pnpm desktop:test:a11y` runs the workbench journey; `--journey
 * conversation` runs the conversation journey; `--journey all` runs
 * both. Journeys map 1:1 to test files so later segments extend this
 * table instead of forking the entry point.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOURNEYS = {
  workbench: ["scripts/tests/s28-a11y.test.mjs"],
  conversation: ["scripts/tests/s29-a11y-conversation.test.mjs"],
};

const args = process.argv.slice(2);
let journey = "workbench";
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--journey" && args[index + 1]) {
    journey = args[index + 1];
    index += 1;
  }
}
const files = journey === "all" ? Object.values(JOURNEYS).flat() : JOURNEYS[journey];
if (!files) {
  console.error(`unknown journey: ${journey} (known: ${Object.keys(JOURNEYS).join(", ")}, all)`);
  process.exit(1);
}
const result = spawnSync(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
