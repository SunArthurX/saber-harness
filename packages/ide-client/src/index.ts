/** Untrusted renderer client for the Saber IDE loop (ADR-013). */
export const IDE_CLIENT_VERSION = "0.1.0" as const;

export function ideClientIdentity(): string {
  return `saber-ide-client/${IDE_CLIENT_VERSION}`;
}

export * from "./approvalCard.js";
export * from "./contextPanel.js";
export * from "./protocol.js";
export * from "./runView.js";
