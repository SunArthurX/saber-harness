#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const inputs = ["schemas/domain/v1/entities.schema.json", "schemas/control/v1/protocol.schema.json"];
const definitions = Object.assign(
  {},
  ...inputs.map((path) => JSON.parse(readFileSync(join(root, path), "utf8")).$defs),
);

const referenceName = (schema) => schema.$ref?.split("/").at(-1);
const nullable = (schema) => Array.isArray(schema.type) && schema.type.includes("null");
const nonNullType = (schema) =>
  Array.isArray(schema.type) ? schema.type.find((value) => value !== "null") : schema.type;
const pascal = (value) =>
  value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");

function tsType(schema) {
  if (referenceName(schema)) return referenceName(schema);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const base =
    {
      string: "string",
      integer: "number",
      object: "Record<string, unknown>",
    }[nonNullType(schema)] ?? (nonNullType(schema) === "array" ? `Array<${tsType(schema.items)}>` : "unknown");
  return nullable(schema) ? `${base} | null` : base;
}

function rustType(schema) {
  if (referenceName(schema)) return referenceName(schema);
  const base =
    {
      string: "String",
      integer: schema.minimum >= 0 ? "u64" : "i64",
      object: "serde_json::Value",
    }[nonNullType(schema)] ??
    (nonNullType(schema) === "array" ? `Vec<${rustType(schema.items)}>` : "serde_json::Value");
  return nullable(schema) ? `Option<${base}>` : base;
}

function tsDefinition(name, schema) {
  if (schema.enum) return `export type ${name} = ${tsType(schema)};`;
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {}).map(
    ([field, property]) => `  ${field}${required.has(field) ? "" : "?"}: ${tsType(property)};`,
  );
  return `export interface ${name} {\n${fields.join("\n")}\n}`;
}

function rustDefinition(name, schema) {
  if (schema.enum) {
    const variants = schema.enum.map(
      (value) => `    #[serde(rename = ${JSON.stringify(value)})]\n    ${pascal(value)},`,
    );
    return `#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]\npub enum ${name} {\n${variants.join("\n")}\n}`;
  }
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {}).map(([field, property]) => {
    const base = rustType(property);
    const type = required.has(field) || base.startsWith("Option<") ? base : `Option<${base}>`;
    const skip = type.startsWith("Option<") ? '    #[serde(default, skip_serializing_if = "Option::is_none")]\n' : "";
    return `${skip}    pub ${field}: ${type},`;
  });
  return `#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]\n#[serde(deny_unknown_fields)]\npub struct ${name} {\n${fields.join("\n")}\n}`;
}

const banner = "Generated from canonical JSON Schema by scripts/generate-contracts.mjs. DO NOT EDIT.";
const ts = `// ${banner}\n\n${Object.entries(definitions)
  .map(([name, schema]) => tsDefinition(name, schema))
  .join("\n\n")}\n`;
const rust = `//! ${banner}\n#![allow(missing_docs)]\n\nuse serde::{Deserialize, Serialize};\n\n${Object.entries(
  definitions,
)
  .map(([name, schema]) => rustDefinition(name, schema))
  .join("\n\n")}\n`;
const outputs = new Map([
  ["packages/agent-runtime/src/generated/contracts.ts", ts],
  ["crates/core-protocol/src/generated.rs", rust],
]);

let different = false;
for (const [path, content] of outputs) {
  const absolute = join(root, path);
  if (checkOnly) {
    const actual = readFileSync(absolute, "utf8");
    if (actual !== content) {
      different = true;
      console.error(`Generated contract is stale: ${path}`);
    }
  } else {
    writeFileSync(absolute, content);
    console.log(`Generated ${path}`);
  }
}
if (different) process.exit(1);
if (checkOnly) console.log(`Generated contracts are deterministic (${outputs.size} files).`);
