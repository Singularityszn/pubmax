import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { isPlanId } from "@/lib/planId";
import {
  operatePlanLiveLocation,
  type PlanLiveLocationAuthority,
  type PlanLiveLocationFailure,
  type PlanLiveLocationOperation,
} from "@/lib/planLiveLocationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { assertServerEnv } from "@/lib/serverEnv";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialCrewActor } from "@/lib/socialCrewHttp";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };
const PRIVATE = { "Cache-Control": "private, no-store" };

function refusal(error: PlanLiveLocationFailure): Response {
  const status = error === "not_found" ? 404 : error === "invalid" ? 400 : error === "ended" ? 409 : 503;
  const message = error === "not_found" ? "That night is not available."
    : error === "invalid" ? "That location could not be read."
      : error === "ended" ? "Location sharing has ended for this night."
        : "Live locations could not be read. Try again.";
  return publicApiError(message, `PLAN_LIVE_LOCATION_${error.toUpperCase()}`, status, { retryable: status >= 500, headers: PRIVATE });
}

/** `?via=crew` is an Open Crew seat, proved by the signed-in account. Anything else is a Plan seat. */
async function authority(request: Request): Promise<{ ok: true; authority: PlanLiveLocationAuthority | null } | { ok: false; response: Response }> {
  if (new URL(request.url).searchParams.get("via") !== "crew") {
    const token = planMemberCapability(request, undefined);
    return { ok: true, authority: token ? { kind: "plan", token } : null };
  }
  const actor = await socialCrewActor(await requireVerifiedSocialActor(request));
  return actor.ok ? { ok: true, authority: { kind: "crew", accountId: actor.actor.accountId } } : actor;
}

async function handle(request: Request, context: Context, operation: PlanLiveLocationOperation): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return refusal("not_found");
  const key = `plan-live-location:${operation === "read" ? "read" : "write"}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, 240)) {
    return publicApiError("Too many location updates. Wait a moment.", "PLAN_LIVE_LOCATION_RATE_LIMITED", 429, { retryable: true, headers: PRIVATE });
  }
  let body: Record<string, unknown> = {};
  if (operation === "share") {
    try {
      const raw: unknown = await request.json();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return refusal("invalid");
      body = raw as Record<string, unknown>;
    } catch { return refusal("invalid"); }
  }
  const seat = await authority(request);
  if (!seat.ok) return seat.response;
  const result = await operatePlanLiveLocation(id, seat.authority, operation, body);
  if (!result.ok) return refusal(result.error);
  return jsonNoStore(result.view, { headers: PRIVATE });
}

export async function GET(request: Request, context: Context): Promise<Response> { return handle(request, context, "read"); }
export async function PUT(request: Request, context: Context): Promise<Response> { return handle(request, context, "share"); }
export async function DELETE(request: Request, context: Context): Promise<Response> { return handle(request, context, "stop"); }
