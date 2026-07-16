import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId } from "@/lib/plan";
import { canonicalPlanRoute } from "@/lib/planRoute";
import { collaborationError, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND", retryable: false }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body.", code: "MALFORMED_REQUEST", retryable: false }, { status: 400 }); }
  const stops = await canonicalPlanRoute(body.stops);
  const result = await planCollaborationStore().createProposal(id, planMemberCapability(request, body.memberToken), {
    reason: typeof body.reason === "string" ? body.reason : "",
    expectedRouteRevision: typeof body.expectedRouteRevision === "number" ? body.expectedRouteRevision : 0,
    stops: stops ?? [],
    resolvedConstraintIds: Array.isArray(body.resolvedConstraintIds) ? body.resolvedConstraintIds.filter((value): value is string => typeof value === "string") : [],
    idempotencyKey: collaborationIdempotencyKey(request, body),
  });
  if (!result.ok) { const failure = collaborationError(result.error); return jsonNoStore(failure.body, { status: failure.status }); }
  return jsonNoStore(result, { status: 201 });
}
