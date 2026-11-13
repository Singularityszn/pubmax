import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { isPlanId, type PlanActionDTO } from "@/lib/plan";
import { planStore } from "@/lib/planStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey } from "@/lib/planMutationHttp";
import { assertServerEnv } from "@/lib/serverEnv";
import { fulfilWantedsAtVenue } from "@/lib/wantedFulfil.server";
import { wantedFulfilledLine } from "@/lib/wanted";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };
const ACTIONS: PlanActionDTO["type"][] = ["arrived", "skipped", "swapped"];

function actionFailure(error: string): Response {
  if (error === "closed") return publicApiError("This Plan has ended.", "PLAN_CLOSED", 409, { retryable: false });
  const status = error === "forbidden" ? 403 : error === "not_found" ? 404 : error === "error" ? 503 : error === "conflict" ? 409 : 400;
  const message = error === "forbidden" ? "That member token cannot update this Plan." : error === "not_found" ? "That Plan doesn't exist." : error === "error" ? "The Plan update is temporarily unavailable." : "Could not record the action.";
  const code = error === "forbidden" ? "PLAN_ACTION_FORBIDDEN" : error === "not_found" ? "PLAN_NOT_FOUND" : error === "error" ? "PLAN_ACTION_UNAVAILABLE" : error === "conflict" ? "PLAN_IDEMPOTENCY_CONFLICT" : "PLAN_ACTION_INVALID";
  return publicApiError(message, code, status, { retryable: error === "error" });
}

const PLAN_ROUTE_CHANGED_MESSAGE = "The route changed. Review the stops and try again.";

/**
 * A bound action conflicts both on an idempotency replay and when the route
 * moved on. The store answers "conflict" for both, so read the Plan to tell a
 * changed route (new revision, or another pub in that slot) from a replay.
 */
async function routeChangedSince(
  id: string,
  stopPosition: number,
  binding: { expectedRouteRevision?: number; venueId?: string },
): Promise<boolean> {
  const current = await planStore().read(id).catch(() => null);
  if (current?.status !== "found") return false;
  const revision = current.state.plan.routeRevision ?? 1;
  const stop = current.state.stops.find((row) => row.position === stopPosition);
  return revision !== binding.expectedRouteRevision || stop?.venueId !== binding.venueId;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-actions:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const type = typeof body.type === "string" && ACTIONS.includes(body.type as PlanActionDTO["type"]) ? body.type as PlanActionDTO["type"] : null;
  const stopPosition = typeof body.stopPosition === "number" && Number.isInteger(body.stopPosition) && body.stopPosition >= 0 && body.stopPosition < 8 ? body.stopPosition : undefined;
  if (!type || stopPosition === undefined) return publicApiError("Add a valid stop action.", "PLAN_ACTION_INVALID", 400);
  const bound = body.expectedRouteRevision !== undefined || body.venueId !== undefined;
  if (bound && (!Number.isInteger(body.expectedRouteRevision) || Number(body.expectedRouteRevision) < 1
    || typeof body.venueId !== "string" || !body.venueId.trim())) {
    return publicApiError("Add the original route revision and venue.", "PLAN_ACTION_INVALID", 400);
  }
  const binding = bound ? { expectedRouteRevision: body.expectedRouteRevision as number, venueId: body.venueId as string } : {};
  const idempotencyKey = planMutationIdempotencyKey(request, body);
  if (!idempotencyKey) return publicApiError(PLAN_IDEMPOTENCY_ERROR.error, PLAN_IDEMPOTENCY_ERROR.code, 400);
  const result = await planStore().addAction(id, planMemberCapability(request, body.memberToken), { type, stopPosition, idempotencyKey, ...binding });
  if (!result.ok) {
    if (result.error === "conflict" && bound && await routeChangedSince(id, stopPosition, binding)) {
      return publicApiError(PLAN_ROUTE_CHANGED_MESSAGE, "PLAN_ROUTE_CHANGED", 409, { retryable: false });
    }
    return actionFailure(result.error);
  }

  // Quiet Wanted fulfilment when a signed-in owner arrives at a saved stop.
  let wantedNote: string | undefined;
  let wantedFulfilled = 0;
  if (type === "arrived" && bound) {
    const stop = result.plan.stops.find((row) => row.position === stopPosition);
    if (stop?.venueId && stop.venueId === binding.venueId) {
      const contributor = await resolveContributionIdentity(request);
      if (contributor.ok) {
        const fulfilled = await fulfilWantedsAtVenue(contributor.actor, stop.venueId);
        wantedFulfilled = fulfilled.length;
        if (fulfilled[0]) wantedNote = wantedFulfilledLine(fulfilled[0].venueName);
      }
    }
  }

  return jsonNoStore(
    {
      ...result.plan,
      ...(wantedFulfilled > 0 ? { wantedFulfilled, wantedNote } : {}),
    },
    { status: 201 },
  );
}
