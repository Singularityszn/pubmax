// POST /api/plans/[id]/usual-drink - a crew member sets their own usual drink
// for the round forecast on the plan card (review item B6).
//
// The same door as presence: the member capability names the seat, so a member
// sets their own choice and nobody else's, and a bearer without a seat is
// refused with nothing written. The choice is one of four closed words
// (lib/planUsualDrink.ts). It feeds a forecast of listed prices and nothing
// else: no payment, settlement or split is derived from it.

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { isPlanId } from "@/lib/plan";
import { planStore } from "@/lib/planStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const limiterKey = `plan-usual-drink:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many updates, slow down.", "PLAN_USUAL_DRINK_RATE_LIMITED", 429, { retryable: true });
  }
  const result = await planStore().updateUsualDrink(id, planMemberCapability(request, body.memberToken), body.usualDrink);
  if (!result.ok) {
    if (result.error === "invalid") return publicApiError("Pick beer, wine, alcohol-free or a soft drink.", "PLAN_USUAL_DRINK_INVALID", 400);
    if (result.error === "not_found") return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
    if (result.error === "forbidden") return publicApiError("That member token isn't valid.", "PLAN_USUAL_DRINK_FORBIDDEN", 403);
    return publicApiError("Could not save your usual.", "PLAN_USUAL_DRINK_UNAVAILABLE", 503, { retryable: true });
  }
  return jsonNoStore(result.plan, { status: 200 });
}
