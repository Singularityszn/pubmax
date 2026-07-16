import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { isPlanId, PLANNED_NIGHT_STATUSES } from "@/lib/plan";
import { cleanNightContext } from "@/lib/nightPlanning";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { canonicalPlanRoute } from "@/lib/planRoute";
import { planStateResult, planStore } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const lookup = await planStateResult(id);
  if (!lookup.ok) return publicApiError("Plan data is temporarily unavailable.", "PLAN_STORE_UNAVAILABLE", 503, { retryable: true });
  if (!lookup.plan) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  return jsonNoStore(lookup.plan, { status: 200 });
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const status = typeof body.status === "string" && (PLANNED_NIGHT_STATUSES as readonly string[]).includes(body.status) ? body.status as typeof PLANNED_NIGHT_STATUSES[number] : undefined;
  const nightContext = body.context === undefined ? undefined : cleanNightContext(body.context);
  const hasStops = body.stops !== undefined;
  const stops = hasStops ? await canonicalPlanRoute(body.stops) : undefined;
  const expectedRouteRevision = typeof body.expectedRouteRevision === "number" && Number.isInteger(body.expectedRouteRevision) && body.expectedRouteRevision > 0 ? body.expectedRouteRevision : undefined;
  if (body.context !== undefined && !nightContext) return publicApiError("Add a valid Night Context.", "NIGHT_CONTEXT_INVALID", 400);
  if (hasStops && (!stops || expectedRouteRevision === undefined || status)) return publicApiError("Replace the Crawl Route with exactly three distinct Venue Dataset stops and its current route revision.", "PLAN_ROUTE_INVALID", 400);
  if (!hasStops && !status && !nightContext) return publicApiError("Add a valid status or Night Context.", "PLAN_UPDATE_INVALID", 400);
  const result = await planStore().update(id, planMemberCapability(request, body.memberToken), {
    ...(status ? { status } : {}),
    ...(nightContext ? { context: nightContext } : {}),
    ...(stops ? { stops, expectedRouteRevision } : {}),
  });
  if (!result.ok) {
    const unavailable = result.error === "error";
    return publicApiError(
      result.error === "forbidden" ? "That member token cannot edit this Plan." : result.error === "conflict" ? "That Crawl Route has changed. Refresh and try again." : unavailable ? "Plan data is temporarily unavailable." : "Could not update the Plan.",
      unavailable ? "PLAN_UPDATE_UNAVAILABLE" : result.error === "forbidden" ? "PLAN_UPDATE_FORBIDDEN" : result.error === "not_found" ? "PLAN_NOT_FOUND" : result.error === "conflict" ? "PLAN_ROUTE_CONFLICT" : "PLAN_UPDATE_INVALID",
      unavailable ? 503 : result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : result.error === "conflict" ? 409 : 400,
      { retryable: unavailable || result.error === "conflict" },
    );
  }
  return jsonNoStore(result.plan);
}
