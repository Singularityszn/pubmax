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

function parseActionInput(body: Record<string, unknown>): { ok: true; type: PlanActionDTO["type"]; stopPosition: number; idempotencyKey?: never } | { ok: false; response: Response } {
  const type = typeof body.type === "string" && ACTIONS.includes(body.type as PlanActionDTO["type"]) ? body.type as PlanActionDTO["type"] : null;
  const stopPosition = typeof body.stopPosition === "number" && Number.isInteger(body.stopPosition) && body.stopPosition >= 0 && body.stopPosition < 8 ? body.stopPosition : undefined;
  if (!type || stopPosition === undefined) return { ok: false, response: publicApiError("Add a valid stop action.", "PLAN_ACTION_INVALID", 400) };
  return { ok: true, type, stopPosition };
}

const ACTION_ERROR_MAP: Record<string, { status: number; error: string; code: string }> = {
  forbidden: { status: 403, error: "That member token cannot update this Plan.", code: "PLAN_ACTION_FORBIDDEN" },
  not_found: { status: 404, error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND" },
  error:     { status: 503, error: "The Plan update is temporarily unavailable.", code: "PLAN_ACTION_UNAVAILABLE" },
  conflict:  { status: 409, error: "Could not record the action.", code: "PLAN_IDEMPOTENCY_CONFLICT" },
};
const ACTION_ERROR_FALLBACK = { status: 400, error: "Could not record the action.", code: "PLAN_ACTION_INVALID" };

function actionErrorResponse(resultError: string): Response {
  const mapped = ACTION_ERROR_MAP[resultError] ?? ACTION_ERROR_FALLBACK;
  return publicApiError(mapped.error, mapped.code, mapped.status, { retryable: resultError === "error" });
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
  const parsed = parseActionInput(body);
  if (!parsed.ok) return parsed.response;
  const idempotencyKey = planMutationIdempotencyKey(request, body);
  if (!idempotencyKey) return publicApiError(PLAN_IDEMPOTENCY_ERROR.error, PLAN_IDEMPOTENCY_ERROR.code, 400);
  const result = await planStore().addAction(id, planMemberCapability(request, body.memberToken), { type: parsed.type, stopPosition: parsed.stopPosition, idempotencyKey });
  if (!result.ok) return actionErrorResponse(result.error);

  // Quiet Wanted fulfilment when a signed-in owner arrives at a saved stop.
  let wantedNote: string | undefined;
  let wantedFulfilled = 0;
  if (parsed.type === "arrived") {
    const stop = result.plan.stops.find((row) => row.position === parsed.stopPosition);
    if (stop?.venueId) {
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
