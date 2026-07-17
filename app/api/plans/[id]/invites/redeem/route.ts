import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { isPlanId } from "@/lib/plan";
import { collaborationErrorResponse } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const result = await planCollaborationStore().upgradeMemberInvite(id, planMemberCapability(request, body.memberToken), body.inviteToken);
  if (!result.ok) return collaborationErrorResponse(result.error);
  return jsonNoStore(result);
}
