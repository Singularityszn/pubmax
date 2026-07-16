import { jsonNoStore } from "@/lib/apiResponses";
import { isPlanId, type CrawlEnding } from "@/lib/plan";
import { planCompletionResult, planStateResult, planStore } from "@/lib/planStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { cleanText } from "@/lib/textClean";

type Context = { params: Promise<{ id: string }> };
const ENDINGS: CrawlEnding[] = ["food", "get_home", "keep_going"];

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  const [planLookup, completionLookup] = await Promise.all([planStateResult(id), planCompletionResult(id)]);
  if (!planLookup.ok || !completionLookup.ok) return jsonNoStore({ error: "Plan completion data is temporarily unavailable.", code: "PLAN_COMPLETION_UNAVAILABLE", retryable: true }, { status: 503 });
  if (!planLookup.plan) return jsonNoStore({ error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND", retryable: false }, { status: 404 });
  return jsonNoStore({ completion: completionLookup.completion });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); }
  const ending = typeof body.ending === "string" && ENDINGS.includes(body.ending as CrawlEnding) ? body.ending as CrawlEnding : null;
  const memberToken = planMemberCapability(request, body.memberToken);
  const terminalVenueId = cleanText(body.terminalVenueId, 80);
  if (body.finalPintDropId !== undefined) return jsonNoStore({ error: "A final Pint Drop cannot be attached until Plan member ownership is verifiable." }, { status: 400 });
  const expectedRouteRevision = typeof body.expectedRouteRevision === "number" && Number.isInteger(body.expectedRouteRevision) && body.expectedRouteRevision > 0 ? body.expectedRouteRevision : null;
  if (!ending || !memberToken || !expectedRouteRevision) return jsonNoStore({ error: "Add a valid Crawl Ending, member capability, and canonical route revision." }, { status: 400 });
  if (ending === "food" && !terminalVenueId) return jsonNoStore({ error: "Include the current route stop before completing this Plan with food." }, { status: 400 });
  const result = await planStore().complete(id, memberToken, { expectedRouteRevision, ending, ...(terminalVenueId ? { terminalVenueId } : {}) });
  if (!result.ok) return jsonNoStore({
    error: result.error === "forbidden" ? "That member capability cannot complete this Plan." : result.error === "conflict" ? "That Crawl Route has changed. Refresh and try again." : result.error === "error" ? "Plan completion data is temporarily unavailable." : "Could not complete this Plan.",
    code: result.error === "error" ? "PLAN_COMPLETION_UNAVAILABLE" : result.error === "forbidden" ? "PLAN_COMPLETION_FORBIDDEN" : result.error === "not_found" ? "PLAN_NOT_FOUND" : result.error === "conflict" ? "PLAN_ROUTE_CONFLICT" : "PLAN_COMPLETION_INVALID",
    retryable: result.error === "error" || result.error === "conflict",
  }, { status: result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : result.error === "conflict" ? 409 : result.error === "error" ? 503 : 400 });
  return jsonNoStore({ plan: result.plan, completion: result.completion }, { status: result.created ? 201 : 200 });
}
