import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { isPlanId } from "@/lib/plan";
import { attachPlanMemberSession, planMemberCapability } from "@/lib/planMemberCapability";
import { planMemberIdentityResult } from "@/lib/planStore";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404, { details: { active: false } });
  const token = planMemberCapability(request, undefined);
  if (!token) return jsonNoStore({ active: false }, { status: 200 });
  const result = await planMemberIdentityResult(id, token);
  if (!result.ok) return publicApiError("Plan session temporarily unavailable.", "PLAN_SESSION_UNAVAILABLE", 503, { retryable: true });
  if (!result.identity) return jsonNoStore({ active: false }, { status: 200 });
  return jsonNoStore({
    active: true,
    role: result.identity.role,
    collaborationAuthorized: result.identity.collaborationAuthorized,
  });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-session:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404, { details: { active: false } });
  const token = planMemberCapability(request, undefined);
  if (!token) return publicApiError("That Plan link is not valid.", "PLAN_SESSION_REQUIRED", 401, { details: { active: false } });
  const result = await planMemberIdentityResult(id, token);
  if (!result.ok) return publicApiError("Plan session temporarily unavailable.", "PLAN_SESSION_UNAVAILABLE", 503, { retryable: true });
  if (!result.identity) return publicApiError("That Plan link is no longer active.", "PLAN_SESSION_FORBIDDEN", 401, { details: { active: false } });
  return attachPlanMemberSession(jsonNoStore({
    active: true,
    role: result.identity.role,
    collaborationAuthorized: result.identity.collaborationAuthorized,
  }), request, id, token);
}
