import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { isPlanId } from "@/lib/plan";
import { collaborationErrorResponse } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { isClassicPlanInviteToken } from "@/lib/planCrewInviteUrl";
import { grantPlanMemberCollaboration, planMemberIdentityResult, resolvePlanIdByInviteToken } from "@/lib/planStore";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-invite-redeem:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  // ONE GUEST CAPABILITY (launch review 3.5): the host's classic link is the
  // capability the host chose to share. A guest seated through it before that
  // rule (can_collaborate false) re-opens the same link and is lifted here.
  // The link must be the plan's CURRENT one, so a rotate still shuts it out.
  if (isClassicPlanInviteToken(body.inviteToken)) {
    const memberToken = planMemberCapability(request, body.memberToken);
    const identity = await planMemberIdentityResult(id, memberToken);
    if (!identity.ok) return publicApiError("Plan data is temporarily unavailable.", "PLAN_JOIN_UNAVAILABLE", 503, { retryable: true });
    if (!identity.identity || identity.identity.role !== "guest") return collaborationErrorResponse("forbidden");
    if (!identity.identity.collaborationAuthorized) {
      const resolved = await resolvePlanIdByInviteToken(body.inviteToken);
      if (!resolved.ok) return publicApiError("Plan data is temporarily unavailable.", "PLAN_JOIN_UNAVAILABLE", 503, { retryable: true });
      if (resolved.planId !== id) return publicApiError("That invite link isn't valid for this Plan.", "PLAN_INVITE_INVALID", 403);
      if (!await grantPlanMemberCollaboration(id, memberToken)) {
        return publicApiError("Plan data is temporarily unavailable.", "PLAN_JOIN_UNAVAILABLE", 503, { retryable: true });
      }
    }
    // inviteId stays null: a classic link is not a one-use invite row, so no
    // invite_redeemed event is owed for it.
    return jsonNoStore({ ok: true, collaborationAuthorized: true, inviteId: null });
  }
  const result = await planCollaborationStore().upgradeMemberInvite(id, planMemberCapability(request, body.memberToken), body.inviteToken);
  if (!result.ok) return collaborationErrorResponse(result.error);
  return jsonNoStore(result);
}
