import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId } from "@/lib/plan";
import { collaborationError, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planStore } from "@/lib/planStore";

type Context = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id, proposalId } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND", retryable: false }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body.", code: "MALFORMED_REQUEST", retryable: false }, { status: 400 }); }
  const memberToken = planMemberCapability(request, body.memberToken);
  const decision = body.decision === "accepted" ? "accepted" : body.decision === "rejected" ? "rejected" : null;
  if (!decision) return jsonNoStore({ error: "Choose accepted or rejected.", code: "PLAN_COLLAB_INVALID", retryable: false }, { status: 400 });
  const result = await planCollaborationStore().decideProposal(id, memberToken, proposalId, decision, collaborationIdempotencyKey(request, body), async (proposal) => {
    const applied = await planStore().update(id, memberToken, { stops: proposal.stops, expectedRouteRevision: proposal.expectedRouteRevision });
    return applied.ok;
  });
  if (!result.ok) { const failure = collaborationError(result.error); return jsonNoStore(failure.body, { status: failure.status }); }
  return jsonNoStore(result);
}
