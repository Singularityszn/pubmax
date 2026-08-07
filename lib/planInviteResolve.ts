// Shared invite-token → classic-plan resolution for public invite write routes.
// Matches the page gate: a token for a Crew-bound (or missing) plan must 404,
// never write orphan RSVPs/reactions after the invite surface has gone dark.

import { jsonNoStore } from "@/lib/apiResponses";
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
    return { response: jsonNoStore({ error: "This invite is unavailable." }, { status: 503 }) };
  }
  if (!lookup.planId) {
    return { response: jsonNoStore({ error: "This invite link isn't valid." }, { status: 404 }) };
  }
  const state = await planStateResult(lookup.planId);
  if (!state.ok) {
    return { response: jsonNoStore({ error: "This invite is unavailable." }, { status: 503 }) };
  }
  if (!state.plan) {
    return { response: jsonNoStore({ error: "This invite link isn't valid." }, { status: 404 }) };
  }
  return { planId: lookup.planId };
}
