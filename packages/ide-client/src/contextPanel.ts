/**
 * Context explanation panel view-model bound to the S09 explain contract
 * (ADR-013). Redacted fields render only their stable marker; exclude and
 * revoke actions are protocol intents routed through the Core, never
 * direct fabric mutations.
 */

/** Stable redaction marker shared with the Rust fabric. */
export const REDACTED_MARKER = "[saber:redacted]";

/** Mirrors the S09 explanation surface the renderer consumes. */
export interface ExplanationItemView {
  readonly chunk_id: string;
  readonly reason: Record<string, unknown>;
  readonly origin: string;
  readonly trust: "trusted" | "imported" | "untrusted";
  readonly sensitivity: string;
  readonly redacted_fields: readonly string[];
  /** Raw field map for rendering; redacted paths must already carry the marker. */
  readonly fields: Record<string, string>;
}

export interface ExplanationView {
  readonly selections: readonly ExplanationItemView[];
  readonly exclusions: readonly { chunk_id: string; reason: string }[];
}

export interface PanelItem {
  readonly chunk_id: string;
  readonly headline: string;
  readonly trust: string;
  readonly sensitivity: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface ContextPanel {
  readonly items: readonly PanelItem[];
}

/** Deterministic panel construction failures with stable codes. */
export class ContextPanelViolation extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function reasonHeadline(reason: Record<string, unknown>): string {
  const kind = typeof reason.kind === "string" ? reason.kind : "unknown";
  const detail =
    typeof reason.term === "string"
      ? reason.term
      : typeof reason.symbol === "string"
        ? reason.symbol
        : typeof reason.path === "string"
          ? reason.path
          : "";
  return detail.length > 0 ? `${kind}:${detail}` : kind;
}

/**
 * Construct the renderable panel. Fails closed when a field marked
 * redacted carries anything other than the stable marker — explanations
 * cannot display redacted content by construction.
 */
export function contextPanelFor(explanation: ExplanationView): ContextPanel {
  const items = explanation.selections.map((selection) => {
    for (const path of selection.redacted_fields) {
      const value = selection.fields[path];
      if (value !== undefined && value !== REDACTED_MARKER) {
        throw new ContextPanelViolation("redacted_field_leak");
      }
    }
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(selection.fields)) {
      fields[key] = selection.redacted_fields.includes(key) ? REDACTED_MARKER : value;
    }
    return {
      chunk_id: selection.chunk_id,
      headline: reasonHeadline(selection.reason),
      trust: selection.trust,
      sensitivity: selection.sensitivity,
      fields,
    };
  });
  return { items };
}

/** Exclude one source from future context — a protocol intent, not an effect. */
export function excludeIntent(chunkId: string): {
  method: "context.exclude";
  params: Record<string, unknown>;
} {
  if (chunkId.length === 0) {
    throw new ContextPanelViolation("invalid_chunk");
  }
  return { method: "context.exclude", params: { chunk_id: chunkId } };
}

/** Revoke one chunk — a protocol intent routed through the Core. */
export function revokeIntent(chunkId: string): {
  method: "context.revoke";
  params: Record<string, unknown>;
} {
  if (chunkId.length === 0) {
    throw new ContextPanelViolation("invalid_chunk");
  }
  return { method: "context.revoke", params: { chunk_id: chunkId } };
}
