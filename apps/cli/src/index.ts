#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { runtimeIdentity } from "@saber/agent-runtime";

/** Creates the deterministic CLI skeleton banner. */
export function createBanner(): string {
  return `saber-cli using ${runtimeIdentity()}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(createBanner());
}
