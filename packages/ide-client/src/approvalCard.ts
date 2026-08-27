/**
 * Approval card view-model bound to the S05 approval contract (ADR-013).
 * The card displays the request's scope selector or something strictly
 * narrower — never broader; it dies at the TTL and must always present at
 * least the two minimum alternatives including deny. Anything broader,
 * expired or deny-less is a construction error, not a rendering choice.
 */

/** The deny label every card must offer (dark-pattern guard, TM-10). */
export const APPROVAL_DENY_LABEL = "deny";

/** Mirrors the S05 approval request surface the renderer consumes. */
export interface ApprovalRequestView {
  readonly request_id: string;
  readonly action: string;
  /** The exact resource the capability request names. */
  readonly resource: string;
  /** The scope selector S05 will grant; the card may not outscope it. */
  readonly scope: {
    readonly match: "exact" | "prefix";
    readonly resource: string;
  };
  readonly summary: string;
  readonly choices: readonly string[];
  readonly expires_at_ms: number;
}

/** The renderable card. */
export interface ApprovalCard {
  readonly request_id: string;
  readonly action: string;
  readonly displayedScope: string;
  readonly summary: string;
  readonly choices: readonly string[];
  readonly alive: boolean;
}

/** Deterministic card construction failures with stable codes. */
export class ApprovalCardViolation extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Whether `candidate` selects a subset of what `bound` selects. */
function within(candidate: ApprovalRequestView["scope"], bound: ApprovalRequestView["scope"]): boolean {
  const normalize = (resource: string) => (resource.endsWith("/") ? resource.slice(0, -1) : resource);
  if (bound.match === "exact") {
    return candidate.match === "exact" && candidate.resource === bound.resource;
  }
  const boundPrefix = normalize(bound.resource);
  if (candidate.match === "exact") {
    const target = normalize(candidate.resource);
    return target === boundPrefix || target.startsWith(`${boundPrefix}/`);
  }
  const candidatePrefix = normalize(candidate.resource);
  return candidatePrefix === boundPrefix || candidatePrefix.startsWith(`${boundPrefix}/`);
}

/**
 * Construct the displayable approval card. `displayScope` defaults to the
 * request scope; passing anything broader than the request scope is a
 * construction error — the UI can narrow what it emphasizes, never widen
 * what the user believes they are approving.
 */
export function approvalCardFor(
  request: ApprovalRequestView,
  nowUnixMs: number,
  displayScope: ApprovalRequestView["scope"] = request.scope,
): ApprovalCard {
  if (request.request_id.length === 0 || request.action.length === 0) {
    throw new ApprovalCardViolation("invalid_request");
  }
  if (!within(displayScope, request.scope)) {
    throw new ApprovalCardViolation("scope_broader_than_request");
  }
  const labels = request.choices.map((choice) => choice.trim().toLowerCase());
  if (request.choices.length < 2 || !labels.includes(APPROVAL_DENY_LABEL)) {
    throw new ApprovalCardViolation("missing_deny_alternative");
  }
  if (nowUnixMs >= request.expires_at_ms) {
    throw new ApprovalCardViolation("expired");
  }
  return {
    request_id: request.request_id,
    action: request.action,
    displayedScope: displayScope.match === "exact" ? displayScope.resource : `${displayScope.resource}/…`,
    summary: request.summary,
    choices: request.choices,
    alive: true,
  };
}

/**
 * Resolve a card choice into the protocol intent payload for
 * `approval.resolve`. The renderer never grants anything itself; it only
 * forwards the user's selection through the Core boundary.
 */
export function approvalResolveIntent(
  card: ApprovalCard,
  choice: string,
): { method: "approval.resolve"; params: Record<string, unknown> } {
  if (!card.choices.includes(choice)) {
    throw new ApprovalCardViolation("choice_not_offered");
  }
  return {
    method: "approval.resolve",
    params: { request_id: card.request_id, choice },
  };
}
