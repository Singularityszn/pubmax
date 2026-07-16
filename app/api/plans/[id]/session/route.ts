import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId } from "@/lib/plan";
import { attachPlanMemberSession, planMemberCapability } from "@/lib/planMemberCapability";
import { planMemberIdentityResult } from "@/lib/planStore";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ active: false }, { status: 404 });
  const token = planMemberCapability(request, undefined);
  if (!token) return jsonNoStore({ active: false }, { status: 200 });
  const result = await planMemberIdentityResult(id, token);
  if (!result.ok) return jsonNoStore({ error: "Plan session temporarily unavailable.", code: "PLAN_SESSION_UNAVAILABLE", retryable: true }, { status: 503 });
  if (!result.identity) return jsonNoStore({ active: false }, { status: 200 });
  return jsonNoStore({
    active: true,
    role: result.identity.role,
    collaborationAuthorized: result.identity.collaborationAuthorized,
  });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ active: false }, { status: 404 });
  const token = planMemberCapability(request, undefined);
  if (!token) return jsonNoStore({ active: false }, { status: 401 });
  const result = await planMemberIdentityResult(id, token);
  if (!result.ok) return jsonNoStore({ error: "Plan session temporarily unavailable.", code: "PLAN_SESSION_UNAVAILABLE", retryable: true }, { status: 503 });
  if (!result.identity) return jsonNoStore({ active: false }, { status: 401 });
  return attachPlanMemberSession(jsonNoStore({
    active: true,
    role: result.identity.role,
    collaborationAuthorized: result.identity.collaborationAuthorized,
  }), request, id, token);
}
