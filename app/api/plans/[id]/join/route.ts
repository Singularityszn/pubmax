import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerUserId } from "@/lib/authServer";
import { formFriendEdgesForPlanJoin } from "@/lib/crewFriendEdges";
import { cleanCrewName, joinCommitsCrewNight } from "@/lib/crew";
import { isLimited } from "@/lib/pintDrops";
import { londonDayKey } from "@/lib/pintContributions";
import { isPlanId, type PlanState } from "@/lib/plan";
import { isClassicPlanInviteToken } from "@/lib/planCrewInviteUrl";
import { planRouteReady } from "@/lib/planPrivacy";
import {
  planMemberIdentity,
  planStateResult,
  planStore,
  resolvePlanIdByInviteToken,
  type PlanWriteError,
} from "@/lib/planStore";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { collaborationErrorResponse } from "@/lib/planCollaborationHttp";
import { attachPlanMemberSession } from "@/lib/planMemberCapability";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey, planWriteErrorToStatus } from "@/lib/planMutationHttp";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { crewCommittedEventToken } from "@/lib/verifiedAnalytics.server";

/** Best-effort friend-graph byproduct after a committed join. Never fails the join. */
async function maybeFormCrewFriendEdges(
  planId: string,
  memberToken: string,
  userId: string | null,
): Promise<number> {
  try {
    if (!userId) return 0;
    const identity = await planMemberIdentity(planId, memberToken);
    if (!identity?.memberId) return 0;
    const result = await formFriendEdgesForPlanJoin({
      planId,
      joinerUserId: userId,
      joinerMemberId: identity.memberId,
    });
    return result.formed;
  } catch {
    return 0;
  }
}

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

// §4.10: a successful join returns a verified crew_committed delivery token so
// the client can report the north-star Friend proof.
//
// The token rides ONE join per plan per night: the one that took the roster to
// the crew-night threshold. Every join used to get its own token, so a plan
// that reached four people reported three crew nights, and the biggest crews
// were overcounted the most (issue #1253). A later join gets no token, so the
// client sends no beacon at all. The plan id and its night stay inside the
// signed subject and never ride on the event, which keeps §7 id hygiene.
// Absent when the store returned no plan (nothing to commit).
function crewCommittedToken(plan: PlanState | null): string | undefined {
  if (!plan || !joinCommitsCrewNight(plan.crew.length)) return undefined;
  return crewCommittedEventToken({
    planId: plan.plan.id,
    nightKey: londonDayKey(plan.plan.startTime) || "unscheduled",
    committedAt: new Date().toISOString(),
    participants: plan.crew.length,
    routeReady: planRouteReady(plan),
  });
}

const JOIN_ERROR_MAP: Record<string, { message: string; code: string }> = {
  full:             { message: "This Plan's crew is full.", code: "PLAN_CREW_FULL" },
  not_found:        { message: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND" },
  account_conflict: { message: "This account is already in the Plan.", code: "PLAN_ACCOUNT_ALREADY_MEMBER" },
  conflict:         { message: "That request key was already used for a different join.", code: "PLAN_IDEMPOTENCY_CONFLICT" },
  error:            { message: "Could not join the Plan.", code: "PLAN_JOIN_UNAVAILABLE" },
  invalid:          { message: "Add your name.", code: "PLAN_JOIN_INVALID" },
};
const JOIN_ERROR_FALLBACK = { message: "Could not join the Plan.", code: "PLAN_JOIN_INVALID" };

/** Map a failed join store result to the appropriate API error response. */
function joinErrorResponse(result: { error: string }): Response {
  const { message, code } = JOIN_ERROR_MAP[result.error] ?? JOIN_ERROR_FALLBACK;
  return publicApiError(message, code, planWriteErrorToStatus(result.error as PlanWriteError), { retryable: result.error === "error" });
}

/** Handle the classic multi-use invite token join flow. */
async function handleClassicInviteJoin(
  request: Request,
  id: string,
  name: string,
  inviteToken: string,
  idempotencyKey: string,
  userId: string | null,
): Promise<Response> {
  const resolved = await resolvePlanIdByInviteToken(inviteToken);
  if (!resolved.ok) {
    return publicApiError("Plan data is temporarily unavailable.", "PLAN_JOIN_UNAVAILABLE", 503, { retryable: true });
  }
  if (resolved.planId !== id) {
    return publicApiError("That invite link isn't valid for this Plan.", "PLAN_INVITE_INVALID", 403);
  }
  const result = await planStore().join(id, name, {
    collaborationAuthorized: false,
    idempotencyKey,
    userId: userId ?? undefined,
  });
  if (!result.ok) {
    return joinErrorResponse(result);
  }
  const friendEdgesFormed = await maybeFormCrewFriendEdges(
    id,
    result.memberToken,
    userId,
  );
  return attachPlanMemberSession(
    jsonNoStore(
      {
        plan: result.plan,
        memberToken: result.memberToken,
        role: result.role,
        collaborationAuthorized: result.collaborationAuthorized,
        crewCommitted: crewCommittedToken(result.plan),
        friendEdgesFormed,
      },
      { status: 200 },
    ),
    request,
    id,
    result.memberToken,
  );
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
  const userId = await callerUserId(request);
  // Invite-only: a bare plan id must never join the crew or return PlanState.
  // Open join was an IDOR (know the UUID → read stops/names and stuff the crew).
  // Two invite shapes are accepted:
  //   - classic multi-use plans.invite_token (WhatsApp / ShareBar #invite=)
  //   - collaboration one-use invite (PlanCollaborationPanel #invite=)
  const inviteToken =
    typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";
  if (!inviteToken) {
    return publicApiError(
      "This Plan needs an invite link to join.",
      "PLAN_INVITE_REQUIRED",
      403,
    );
  }

  if (isClassicPlanInviteToken(inviteToken)) {
    return handleClassicInviteJoin(request, id, name, inviteToken, idempotencyKey, userId);
  }

  const joined = await planCollaborationStore().redeemInviteAndJoin(
    id,
    inviteToken,
    name,
    new Date(),
    { idempotencyKey, userId: userId ?? undefined },
  );
  if (!joined.ok) {
    if (joined.error === "account_conflict") {
      return publicApiError(
        "This account is already in the Plan.",
        "PLAN_ACCOUNT_ALREADY_MEMBER",
        409,
      );
    }
    if (joined.error === "full") {
      return publicApiError("This Plan's crew is full.", "PLAN_CREW_FULL", 409);
    }
    return collaborationErrorResponse(joined.error);
  }
  const friendEdgesFormed = await maybeFormCrewFriendEdges(
    id,
    joined.memberToken,
    userId,
  );
  return attachPlanMemberSession(
    jsonNoStore(
      {
        ...joined,
        crewCommitted: crewCommittedToken(joined.plan),
        friendEdgesFormed,
      },
      { status: 200 },
    ),
    request,
    id,
    joined.memberToken,
  );
}
