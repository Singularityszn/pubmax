import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { isPlanId } from "@/lib/plan";
import { collaborationErrorResponse, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planStore } from "@/lib/planStore";

type Context = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id, proposalId } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const memberToken = planMemberCapability(request, body.memberToken);
  const decision = body.decision === "accepted" ? "accepted" : body.decision === "rejected" ? "rejected" : null;
  if (!decision) return publicApiError("Choose accepted or rejected.", "PLAN_COLLAB_INVALID", 400);
  const result = await planCollaborationStore().decideProposal(id, memberToken, proposalId, decision, collaborationIdempotencyKey(request, body), async (proposal) => {
    const applied = await planStore().update(id, memberToken, { stops: proposal.stops, expectedRouteRevision: proposal.expectedRouteRevision });
    return applied.ok;
  });
  if (!result.ok) return collaborationErrorResponse(result.error);
  return jsonNoStore(result);
}
