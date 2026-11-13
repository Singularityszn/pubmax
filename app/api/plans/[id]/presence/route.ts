import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { isPlanId } from "@/lib/plan";
import { planCrewArrivedReceipts } from "@/lib/planCrewArrived.server";
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
  const limiterKey = `plan-presence:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many updates, slow down.", "PLAN_PRESENCE_RATE_LIMITED", 429, { retryable: true });
  }
  const memberToken = planMemberCapability(request, body.memberToken);
  if (!memberToken) {
    return publicApiError("Your crew session needs refreshing.", "PLAN_PRESENCE_REQUIRED", 401);
  }
  const result = await planStore().updatePresence(id, memberToken, body.status);
  if (!result.ok) {
    if (result.error === "closed") return publicApiError("This Plan has ended.", "PLAN_CLOSED", 409, { retryable: false });
    const status = result.error === "invalid" ? 400 : result.error === "not_found" ? 404 : result.error === "forbidden" ? 403 : 503;
    const error = result.error === "forbidden" ? "That member token isn't valid." : result.error === "invalid" ? "Choose a valid crew status." : result.error === "not_found" ? "That Plan doesn't exist." : "Could not update presence.";
    return publicApiError(error, result.error === "error" ? "PLAN_PRESENCE_UNAVAILABLE" : result.error === "not_found" ? "PLAN_NOT_FOUND" : result.error === "forbidden" ? "PLAN_PRESENCE_FORBIDDEN" : "PLAN_PRESENCE_INVALID", status, { retryable: result.error === "error" });
  }
  // P0 item 7: the night's arrival bands ride back on every successful status
  // write, from any member, so a consented device can report them. The rule
  // and its dedupe live in lib/planCrewArrived.server.ts.
  const crewArrived = planCrewArrivedReceipts(result.plan);
  return jsonNoStore(crewArrived.length > 0 ? { ...result.plan, crewArrived } : result.plan, { status: 200 });
}
