/** Initial model-neutral Agent Runtime identity. */
export const AGENT_RUNTIME_VERSION = "0.1.0" as const;

/** Returns a stable identity used by skeleton smoke tests. */
export function runtimeIdentity(): string {
  return `saber-agent-runtime/${AGENT_RUNTIME_VERSION}`;
}

export * from "./control.js";
export type * from "./generated/contracts.js";
