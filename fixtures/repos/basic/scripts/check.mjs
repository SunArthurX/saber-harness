// S30 fixture acceptance script: exits 0 exactly when the governed run's
// edit landed. Never touched by network access.
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../notes.md", import.meta.url), "utf8");
if (!text.includes("saber-was-here")) {
  console.error("notes.md lacks the governed marker");
  process.exit(1);
}
console.log("fixture-check-ok");
