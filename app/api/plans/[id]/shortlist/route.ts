import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId } from "@/lib/plan";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { shortlistMutationResponse, shortlistWriteGate } from "@/lib/planShortlistHttp.server";
import { mutatePlanShortlist, readPlanShortlist } from "@/lib/planShortlistStore";
import { planMemberIdentityResult, planStateResult } from "@/lib/planStore";

type Context = { params: Promise<{ id: string }> };

async function requireOrganiser(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isPlanId(id)) return { response: shortlistMutationResponse({ status: "missing" }) };
  const member = await planMemberIdentityResult(id, planMemberCapability(request, null));
  if (!member.ok) return { response: shortlistMutationResponse({ status: "unavailable" }) };
  if (member.identity?.role !== "host") return { response: shortlistMutationResponse({ status: "forbidden" }) };
  return { id, hostId: member.identity.memberId };
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const organiser = await requireOrganiser(request, context);
  if (organiser.response) return organiser.response;
  const [result, plan] = await Promise.all([readPlanShortlist(organiser.id), planStateResult(organiser.id)]);
  if (!plan.ok) return shortlistMutationResponse({ status: "unavailable" });
  if (result.status === "found" && result.organiserId !== organiser.hostId) {
    return shortlistMutationResponse({ status: "forbidden" });
  }
  return result.status === "found"
    ? jsonNoStore({
      shortlist: result.view,
      token: result.inviteToken,
      budgetLimitPence: plan.plan?.context?.budgetLimitPence ?? null,
      expired: result.expired,
    })
    : shortlistMutationResponse({ status: result.status });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const refusal = await shortlistWriteGate(request, "confirm");
  if (refusal) return refusal;
  const organiser = await requireOrganiser(request, context);
  if (organiser.response) return organiser.response;
  const body = await request.json().catch(() => null);
  const start = typeof body?.startTime === "string" ? Date.parse(body.startTime) : NaN;
  if (typeof body?.venueId !== "string" || body.venueId.length > 120 || !Number.isFinite(start)) {
    return publicApiError("Choose a shortlisted pub and a future time.", "INVALID_REQUEST", 400);
  }
  return shortlistMutationResponse(await mutatePlanShortlist(organiser.id, {
    kind: "confirm", venueId: body.venueId, startTime: new Date(start).toISOString(), hostId: organiser.hostId,
  }));
}
