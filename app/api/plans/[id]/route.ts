import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId, PLANNED_NIGHT_STATUSES } from "@/lib/plan";
import { cleanNightContext } from "@/lib/nightPlanning";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { canonicalPlanRoute } from "@/lib/planRoute";
import { planStore } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  const plan = await planStore().get(id);
  if (!plan) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  return jsonNoStore(plan, { status: 200 });
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); }
  const status = typeof body.status === "string" && (PLANNED_NIGHT_STATUSES as readonly string[]).includes(body.status) ? body.status as typeof PLANNED_NIGHT_STATUSES[number] : undefined;
  const nightContext = body.context === undefined ? undefined : cleanNightContext(body.context);
  const hasStops = body.stops !== undefined;
  const stops = hasStops ? await canonicalPlanRoute(body.stops) : undefined;
  const expectedRouteRevision = typeof body.expectedRouteRevision === "number" && Number.isInteger(body.expectedRouteRevision) && body.expectedRouteRevision > 0 ? body.expectedRouteRevision : undefined;
  if (body.context !== undefined && !nightContext) return jsonNoStore({ error: "Add a valid Night Context." }, { status: 400 });
  if (hasStops && (!stops || expectedRouteRevision === undefined || status)) return jsonNoStore({ error: "Replace the Crawl Route with exactly three distinct Venue Dataset stops and its current route revision." }, { status: 400 });
  if (!hasStops && !status && !nightContext) return jsonNoStore({ error: "Add a valid status or Night Context." }, { status: 400 });
  const result = await planStore().update(id, planMemberCapability(request, body.memberToken), {
    ...(status ? { status } : {}),
    ...(nightContext ? { context: nightContext } : {}),
    ...(stops ? { stops, expectedRouteRevision } : {}),
  });
  if (!result.ok) return jsonNoStore({ error: result.error === "forbidden" ? "That member token cannot edit this Plan." : result.error === "conflict" ? "That Crawl Route has changed. Refresh and try again." : "Could not update the Plan." }, { status: result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : result.error === "conflict" ? 409 : 400 });
  return jsonNoStore(result.plan);
}
