// GET /api/plans/[id]/pals: Pals walk together. A caller holding this plan's
// member capability (the plan's own HttpOnly session, or a member token)
// learns the Pub Pals of the OTHER members of this plan who chose "Show my
// Pal to my crew" and did not hide their Pal, so the plan's map can walk them
// beside the caller's own. Anyone else gets the preview marker and nothing
// about the crew. It names the Pal, never its owner: no account id, crew
// seat id or handle leaves here (lib/crewPals.ts,
// docs/security/PERMISSION_MATRIX.md "Crew Pals").

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { CREW_PALS_MAX, crewPalFrom } from "@/lib/crewPals";
import { isLimited } from "@/lib/pintDrops";
import { isPlanId } from "@/lib/plan";
import { planCrewUserIds } from "@/lib/planCrewIdentity";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planMemberIdentityResult } from "@/lib/planStore";
import { listCrewVisiblePalsResult } from "@/lib/pubPalStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

function unavailable(): Response {
  return publicApiError("Crew Pals are temporarily unavailable.", "PLAN_PALS_UNAVAILABLE", 503, { retryable: true });
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const limiterKey = `plan-pals:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "PLAN_PALS_RATE_LIMITED", 429, { retryable: true });
  }
  const member = await planMemberIdentityResult(id, planMemberCapability(request, undefined));
  if (!member.ok) return unavailable();
  if (!member.identity) return jsonNoStore({ visibility: "preview" }, { status: 200 });

  const seats = await planCrewUserIds(id);
  if (!seats.ok) return unavailable();
  // The caller's own Pal walks from their own device, never from here.
  const others = seats.value.filter((seat) => seat.memberId !== member.identity!.memberId);
  const order = new Map(others.map((seat, index) => [seat.userId, index]));
  const listed = await listCrewVisiblePalsResult(others.map((seat) => seat.userId));
  if (!listed.ok) return unavailable();
  const pals = [...listed.value]
    .sort((a, b) => (order.get(a.ownerId) ?? 0) - (order.get(b.ownerId) ?? 0))
    .slice(0, CREW_PALS_MAX)
    .map(crewPalFrom);
  return jsonNoStore({ visibility: "member", pals }, { status: 200 });
}
