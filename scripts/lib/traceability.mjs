import { readFileSync } from "node:fs";

export const requirementFamilies = Object.freeze([
  "FR-CONT",
  "FR-RUN",
  "FR-MEM",
  "FR-EVO",
  "SEC-POL",
  "SEC-ISO",
  "SEC-SYNC",
  "RES-HEAL",
  "OPS-ENT",
]);

const idPattern = /^(FR-(?:CONT|RUN|MEM|EVO)|SEC-(?:POL|ISO|SYNC)|RES-HEAL|OPS-ENT)-\d{3}$/;
const eventPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const testPattern = /^S\d{2}-[A-Z0-9-]+$/;

export function loadTraceability(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function familyOf(id) {
  return id?.replace(/-\d{3}$/, "");
}

export function validateTraceability(document) {
  const errors = [];
  const requirements = Array.isArray(document?.requirements) ? document.requirements : [];
  const ids = new Set();

  if (document?.schema_version !== 2) errors.push("schema-version");
  if (JSON.stringify(document?.families) !== JSON.stringify(requirementFamilies)) errors.push("family-catalog");
  if (requirements.length < 50) errors.push("requirement-count");

  for (const requirement of requirements) {
    const label = requirement?.id ?? "missing-id";
    if (!idPattern.test(label)) errors.push(`${label}:id-format`);
    if (ids.has(label)) errors.push(`${label}:duplicate-id`);
    ids.add(label);

    if (!["P0", "P1", "P2"].includes(requirement?.priority)) errors.push(`${label}:priority`);
    for (const field of ["statement", "owner", "module", "source", "status"]) {
      if (
        typeof requirement?.[field] !== "string" ||
        requirement[field].trim() === "" ||
        /\bTBD\b/i.test(requirement[field])
      ) {
        errors.push(`${label}:${field}`);
      }
    }
    if (!/^S\d{2}$/.test(requirement?.segment ?? "")) errors.push(`${label}:segment`);

    if (
      !Array.isArray(requirement?.events) ||
      requirement.events.length === 0 ||
      requirement.events.some((event) => !eventPattern.test(event))
    ) {
      errors.push(`${label}:events`);
    }
    if (
      !Array.isArray(requirement?.tests) ||
      requirement.tests.length === 0 ||
      requirement.tests.some((test) => !testPattern.test(test))
    ) {
      errors.push(`${label}:tests`);
    }
    if (requirement?.priority === "P0" && (!requirement.owner || requirement.tests.length === 0)) {
      errors.push(`${label}:p0-owner-test`);
    }
  }

  for (const family of requirementFamilies) {
    if (!requirements.some((requirement) => familyOf(requirement.id) === family))
      errors.push(`${family}:orphan-family`);
  }

  return {
    errors,
    summary: {
      total: requirements.length,
      p0: requirements.filter(({ priority }) => priority === "P0").length,
      families: requirementFamilies.length,
    },
  };
}
