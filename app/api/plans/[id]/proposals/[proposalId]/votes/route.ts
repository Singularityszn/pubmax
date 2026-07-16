import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId } from "@/lib/plan";
import { collaborationError, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planCollaborationStore, type PlanVote } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";

type Context = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id, proposalId } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND", retryable: false }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body.", code: "MALFORMED_REQUEST", retryable: false }, { status: 400 }); }
  const result = await planCollaborationStore().vote(id, planMemberCapability(request, body.memberToken), proposalId, body.value as PlanVote["value"], collaborationIdempotencyKey(request, body));
  if (!result.ok) { const failure = collaborationError(result.error); return jsonNoStore(failure.body, { status: failure.status }); }
  return jsonNoStore(result, { status: 201 });
}
