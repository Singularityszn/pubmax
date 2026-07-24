import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { cleanCrewName } from "@/lib/crew";
import { isLimited } from "@/lib/pintDrops";
import { isPlanId, type PlanState } from "@/lib/plan";
import { planRouteReady } from "@/lib/planPrivacy";
import { planStateResult, planStore } from "@/lib/planStore";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { collaborationErrorResponse } from "@/lib/planCollaborationHttp";
import { attachPlanMemberSession } from "@/lib/planMemberCapability";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey } from "@/lib/planMutationHttp";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { crewCommittedEventToken } from "@/lib/verifiedAnalytics.server";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

// §4.10: a successful join returns a verified crew_committed delivery token so
// the client can report the north-star Friend proof. The joinId is the new
// member's non-secret crew id — never the member capability. Absent when the
// store returned no plan/crew (nothing to commit).
function crewCommittedToken(plan: PlanState | null): string | undefined {
  const joinId = plan?.crew.at(-1)?.id;
  if (!plan || !joinId) return undefined;
  return crewCommittedEventToken({
    joinId,
    joinedAt: new Date().toISOString(),
    participants: plan.crew.length,
    routeReady: planRouteReady(plan),
  });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const limiterKey = `plan-join:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many joins, slow down.", "PLAN_JOIN_RATE_LIMITED", 429, { retryable: true });
  }
  const name = cleanCrewName(body.name);
  if (!name) return publicApiError("Add your name.", "PLAN_JOIN_NAME_REQUIRED", 400);
  const idempotencyKey = planMutationIdempotencyKey(request, body);
  if (!idempotencyKey) return publicApiError(PLAN_IDEMPOTENCY_ERROR.error, PLAN_IDEMPOTENCY_ERROR.code, 400);
  const lookup = await planStateResult(id);
  if (!lookup.ok) return publicApiError("Plan data is temporarily unavailable.", "PLAN_JOIN_UNAVAILABLE", 503, { retryable: true });
  if (!lookup.plan) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  if (body.inviteToken !== undefined) {
    const joined = await planCollaborationStore().redeemInviteAndJoin(id, body.inviteToken, name, new Date(), { idempotencyKey });
    if (!joined.ok) {
      if (joined.error === "full") return publicApiError("This Plan's crew is full.", "PLAN_CREW_FULL", 409);
      return collaborationErrorResponse(joined.error);
    }
    return attachPlanMemberSession(
      jsonNoStore({ ...joined, crewCommitted: crewCommittedToken(joined.plan) }, { status: 200 }),
      request,
      id,
      joined.memberToken,
    );
  }
  const result = await planStore().join(id, name, { collaborationAuthorized: false, idempotencyKey });
  if (!result.ok) {
    const status = result.error === "invalid" ? 400 : result.error === "not_found" ? 404 : result.error === "full" || result.error === "conflict" ? 409 : 503;
    const error = result.error === "full" ? "This Plan's crew is full." : result.error === "invalid" ? "Add your name." : result.error === "not_found" ? "That Plan doesn't exist." : result.error === "conflict" ? "That request key was already used for a different join." : "Could not join the Plan.";
    return publicApiError(error, result.error === "error" ? "PLAN_JOIN_UNAVAILABLE" : result.error === "not_found" ? "PLAN_NOT_FOUND" : result.error === "full" ? "PLAN_CREW_FULL" : result.error === "conflict" ? "PLAN_IDEMPOTENCY_CONFLICT" : "PLAN_JOIN_INVALID", status, { retryable: result.error === "error" });
  }
  return attachPlanMemberSession(
    jsonNoStore({ plan: result.plan, memberToken: result.memberToken, role: result.role, collaborationAuthorized: result.collaborationAuthorized, crewCommitted: crewCommittedToken(result.plan) }, { status: 200 }),
    request,
    id,
    result.memberToken,
  );
}
