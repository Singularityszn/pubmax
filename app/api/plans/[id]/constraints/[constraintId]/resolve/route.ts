import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId } from "@/lib/plan";
import { collaborationError, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planCollaborationStore, type PlanConstraintEvidence } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";

type Context = { params: Promise<{ id: string; constraintId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id, constraintId } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND", retryable: false }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body.", code: "MALFORMED_REQUEST", retryable: false }, { status: 400 }); }
  const evidence = body.evidence && typeof body.evidence === "object" ? body.evidence as PlanConstraintEvidence : {} as PlanConstraintEvidence;
  const result = await planCollaborationStore().resolveConstraint(id, planMemberCapability(request, body.memberToken), constraintId, { evidence, idempotencyKey: collaborationIdempotencyKey(request, body) });
  if (!result.ok) { const failure = collaborationError(result.error); return jsonNoStore(failure.body, { status: failure.status }); }
  return jsonNoStore(result);
}
