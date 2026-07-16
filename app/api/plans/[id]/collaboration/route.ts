import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId } from "@/lib/plan";
import { collaborationError } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND", retryable: false }, { status: 404 });
  const result = await planCollaborationStore().list(id, planMemberCapability(request, undefined));
  if (!result.ok) { const failure = collaborationError(result.error); return jsonNoStore(failure.body, { status: failure.status }); }
  return jsonNoStore(result);
}
