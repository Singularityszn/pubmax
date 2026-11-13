// Public invite writes require a classic plan. Crew-bound or missing plans
// return 404. A public-page redirect must not authorise crew RSVPs or reactions.

import { publicApiError } from "@/lib/apiError";
import { planStateResult, resolvePlanIdByInviteToken } from "@/lib/planStore";

export type ResolvedInvitePlan =
  | { planId: string }
  | { response: Response };

/**
 * Resolve a public invite token to a classic (non-Crew-bound) plan id, or a
 * ready-to-return Response. Store outages stay 503; unknown / Crew-bound stay 404.
 */
export async function resolveClassicInvitePlan(token: string): Promise<ResolvedInvitePlan> {
  const lookup = await resolvePlanIdByInviteToken(token);
  if (!lookup.ok) {
    return { response: publicApiError("This invite is unavailable.", "UNAVAILABLE", 503, { retryable: true }) };
  }
  if (!lookup.planId) {
    return { response: publicApiError("This invite link isn't valid.", "NOT_FOUND", 404) };
  }
  const state = await planStateResult(lookup.planId);
  if (!state.ok) {
    return { response: publicApiError("This invite is unavailable.", "UNAVAILABLE", 503, { retryable: true }) };
  }
  if (!state.plan) {
    return { response: publicApiError("This invite link isn't valid.", "NOT_FOUND", 404) };
  }
  return { planId: lookup.planId };
}
