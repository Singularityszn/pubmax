import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { cleanEndingSelection, isPlanId, type CrawlEnding } from "@/lib/plan";
import { planCompletionResult, planStateResult, planStore } from "@/lib/planStore";
import { canonicalEndingSelection } from "@/lib/planEndingSelection.server";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { cleanText } from "@/lib/textClean";

type Context = { params: Promise<{ id: string }> };
const ENDINGS: CrawlEnding[] = ["food", "get_home", "keep_going"];

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const [planLookup, completionLookup] = await Promise.all([planStateResult(id), planCompletionResult(id)]);
  if (!planLookup.ok || !completionLookup.ok) return publicApiError("Plan completion data is temporarily unavailable.", "PLAN_COMPLETION_UNAVAILABLE", 503, { retryable: true });
  if (!planLookup.plan) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  return jsonNoStore({ completion: completionLookup.completion });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const ending = typeof body.ending === "string" && ENDINGS.includes(body.ending as CrawlEnding) ? body.ending as CrawlEnding : null;
  const memberToken = planMemberCapability(request, body.memberToken);
  const terminalVenueId = cleanText(body.terminalVenueId, 80);
  const endingSelection = ending ? cleanEndingSelection(body.endingSelection, ending) : null;
  if (body.finalPintDropId !== undefined) return publicApiError("A final Pint Drop cannot be attached until Plan member ownership is verifiable.", "FINAL_PINT_DROP_FORBIDDEN", 400);
  const expectedRouteRevision = typeof body.expectedRouteRevision === "number" && Number.isInteger(body.expectedRouteRevision) && body.expectedRouteRevision > 0 ? body.expectedRouteRevision : null;
  if (!ending || !memberToken || !expectedRouteRevision) return publicApiError("Add a valid Crawl Ending, member capability, and canonical route revision.", "PLAN_COMPLETION_INVALID", 400);
  if (!endingSelection) return publicApiError("Choose a valid grounded ending option.", "PLAN_ENDING_SELECTION_INVALID", 400);
  if (ending === "food" && !terminalVenueId) return publicApiError("Include the current route stop before completing this Plan with food.", "PLAN_FOOD_TERMINAL_REQUIRED", 400);
  const planLookup = await planStateResult(id);
  if (!planLookup.ok) return publicApiError("Plan completion data is temporarily unavailable.", "PLAN_COMPLETION_UNAVAILABLE", 503, { retryable: true });
  if (!planLookup.plan) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const canonicalSelection = await canonicalEndingSelection(planLookup.plan, endingSelection, terminalVenueId);
  if (!canonicalSelection) {
    return publicApiError("That ending option is no longer supported by current evidence.", "PLAN_ENDING_EVIDENCE_STALE", 409);
  }
  const result = await planStore().complete(id, memberToken, {
    expectedRouteRevision,
    ending,
    ...(terminalVenueId ? { terminalVenueId } : {}),
    endingSelection: canonicalSelection,
  });
  if (!result.ok) return publicApiError(
    result.error === "forbidden" ? "That member capability cannot complete this Plan." : result.error === "conflict" ? "That Crawl Route has changed. Refresh and try again." : result.error === "error" ? "Plan completion data is temporarily unavailable." : "Could not complete this Plan.",
    result.error === "error" ? "PLAN_COMPLETION_UNAVAILABLE" : result.error === "forbidden" ? "PLAN_COMPLETION_FORBIDDEN" : result.error === "not_found" ? "PLAN_NOT_FOUND" : result.error === "conflict" ? "PLAN_ROUTE_CONFLICT" : "PLAN_COMPLETION_INVALID",
    result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : result.error === "conflict" ? 409 : result.error === "error" ? 503 : 400,
    { retryable: result.error === "error" || result.error === "conflict" },
  );
  return jsonNoStore({ plan: result.plan, completion: result.completion }, { status: result.created ? 201 : 200 });
}
