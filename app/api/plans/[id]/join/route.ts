import { jsonNoStore } from "@/lib/apiResponses";
import { cleanCrewName } from "@/lib/crew";
import { isLimited } from "@/lib/pintDrops";
import { isPlanId } from "@/lib/plan";
import { planStateResult, planStore } from "@/lib/planStore";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { collaborationError } from "@/lib/planCollaborationHttp";
import { attachPlanMemberSession } from "@/lib/planMemberCapability";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey } from "@/lib/planMutationHttp";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  const limiterKey = `plan-join:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return jsonNoStore({ error: "Too many joins, slow down." }, { status: 429 });
  }
  const name = cleanCrewName(body.name);
  if (!name) return jsonNoStore({ error: "Add your name.", code: "PLAN_JOIN_NAME_REQUIRED", retryable: false }, { status: 400 });
  const idempotencyKey = planMutationIdempotencyKey(request, body);
  if (!idempotencyKey) return jsonNoStore(PLAN_IDEMPOTENCY_ERROR, { status: 400 });
  const lookup = await planStateResult(id);
  if (!lookup.ok) return jsonNoStore({ error: "Plan data is temporarily unavailable.", code: "PLAN_JOIN_UNAVAILABLE", retryable: true }, { status: 503 });
  if (!lookup.plan) return jsonNoStore({ error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND", retryable: false }, { status: 404 });
  if (body.inviteToken !== undefined) {
    const joined = await planCollaborationStore().redeemInviteAndJoin(id, body.inviteToken, name, new Date(), { idempotencyKey });
    if (!joined.ok) {
      if (joined.error === "full") return jsonNoStore({ error: "This Plan's crew is full.", code: "PLAN_CREW_FULL", retryable: false }, { status: 409 });
      const failure = collaborationError(joined.error);
      return jsonNoStore(failure.body, { status: failure.status });
    }
    return attachPlanMemberSession(jsonNoStore(joined, { status: 200 }), request, id, joined.memberToken);
  }
  const result = await planStore().join(id, name, { collaborationAuthorized: false, idempotencyKey });
  if (!result.ok) {
    const status = result.error === "invalid" ? 400 : result.error === "not_found" ? 404 : result.error === "full" || result.error === "conflict" ? 409 : 503;
    const error = result.error === "full" ? "This Plan's crew is full." : result.error === "invalid" ? "Add your name." : result.error === "not_found" ? "That Plan doesn't exist." : result.error === "conflict" ? "That request key was already used for a different join." : "Could not join the Plan.";
    return jsonNoStore({ error, code: result.error === "error" ? "PLAN_JOIN_UNAVAILABLE" : result.error === "not_found" ? "PLAN_NOT_FOUND" : result.error === "full" ? "PLAN_CREW_FULL" : result.error === "conflict" ? "PLAN_IDEMPOTENCY_CONFLICT" : "PLAN_JOIN_INVALID", retryable: result.error === "error" }, { status });
  }
  return attachPlanMemberSession(
    jsonNoStore({ plan: result.plan, memberToken: result.memberToken, role: result.role, collaborationAuthorized: result.collaborationAuthorized }, { status: 200 }),
    request,
    id,
    result.memberToken,
  );
}
