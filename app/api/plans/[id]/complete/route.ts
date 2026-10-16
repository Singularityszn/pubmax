import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { cleanEndingSelection, isPlanId, type CrawlEnding, type PlanCompletionDTO, type PlanState } from "@/lib/plan";
import { planCompletionResult, planMemberIdentityResult, planStateResult, planStore, type PlanWriteError } from "@/lib/planStore";
import { CREW_NIGHT_MIN_PARTICIPANTS } from "@/lib/crew";
import { canonicalEndingSelection } from "@/lib/planEndingSelection.server";
import { planSigningPreflightResponse, planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { cleanText } from "@/lib/textClean";
import { completionLoopEventTokens } from "@/lib/verifiedAnalytics.server";

type Context = { params: Promise<{ id: string }> };
const ENDINGS: CrawlEnding[] = ["food", "get_home", "keep_going"];

// Whether the night that just ended had a crew, read off the roster the store
// already answered with. It reads the SAME threshold `crew_committed` is
// minted on (lib/crew.ts), so the two halves of the crew-night ratio cannot
// come to mean different things, and it travels as `eventProps` beside the
// tokens because the browser has to send the props the receipt was signed
// over. Never a roster count and never a plan id: docs/analytics/METRICS.md
// §2.2 and ADR 0009.
function completionEventProps(plan: PlanState): { crewNight: boolean } {
  return { crewNight: plan.crew.length >= CREW_NIGHT_MIN_PARTICIPANTS };
}

function completionResponse(
  plan: PlanState,
  completion: PlanCompletionDTO,
  created: boolean,
): Record<string, unknown> {
  const eventProps = completionEventProps(plan);
  return {
    plan,
    completion,
    created,
    eventProps,
    eventTokens: completionLoopEventTokens({
      completionId: completion.id,
      completedAt: completion.completedAt,
      ending: completion.ending,
      crewNight: eventProps.crewNight,
    }),
  };
}

function verifiedCompletionResponse(
  plan: PlanState,
  completion: PlanCompletionDTO,
  created: boolean,
  status = 200,
): Response {
  try {
    return jsonNoStore(completionResponse(plan, completion, created), { status });
  } catch (error) {
    const unavailable = planSigningUnavailableResponse(error);
    if (unavailable) return unavailable;
    throw error;
  }
}

const COMPLETION_INVALID = { message: "Could not complete this Plan.", code: "PLAN_COMPLETION_INVALID", status: 400, retryable: false };

// One public answer per store refusal. Every refusal not named here is invalid.
const COMPLETION_REFUSALS: Partial<Record<PlanWriteError, typeof COMPLETION_INVALID>> = {
  forbidden: { message: "Only the Plan host can complete this Plan.", code: "PLAN_COMPLETION_FORBIDDEN", status: 403, retryable: false },
  conflict: { message: "That route has changed. Refresh and try again.", code: "PLAN_ROUTE_CONFLICT", status: 409, retryable: true },
  arrival_required: { message: "Mark at least one route stop as arrived before completing this Plan.", code: "PLAN_ARRIVAL_REQUIRED", status: 400, retryable: false },
  error: { message: "Plan completion is temporarily unavailable.", code: "PLAN_COMPLETION_UNAVAILABLE", status: 503, retryable: true },
  not_found: { ...COMPLETION_INVALID, code: "PLAN_NOT_FOUND", status: 404 },
};

function completionRefusal(error: PlanWriteError): Response {
  const { message, code, status, retryable } = COMPLETION_REFUSALS[error] ?? COMPLETION_INVALID;
  return publicApiError(message, code, status, { retryable });
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const [planLookup, completionLookup] = await Promise.all([planStateResult(id), planCompletionResult(id)]);
  if (!planLookup.ok || !completionLookup.ok) return publicApiError("Plan completion data is temporarily unavailable.", "PLAN_COMPLETION_UNAVAILABLE", 503, { retryable: true });
  if (!planLookup.plan) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  return jsonNoStore({ completion: completionLookup.completion });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-complete:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const ending = typeof body.ending === "string" && ENDINGS.includes(body.ending as CrawlEnding) ? body.ending as CrawlEnding : null;
  const memberToken = planMemberCapability(request, body.memberToken);
  const terminalVenueId = cleanText(body.terminalVenueId, 80);
  const endingSelection = ending ? cleanEndingSelection(body.endingSelection, ending) : null;
  if (body.finalPintDropId !== undefined) return publicApiError("We can't attach a final Pint Drop until we can confirm you're on this Plan.", "FINAL_PINT_DROP_FORBIDDEN", 400);
  const expectedRouteRevision = typeof body.expectedRouteRevision === "number" && Number.isInteger(body.expectedRouteRevision) && body.expectedRouteRevision > 0 ? body.expectedRouteRevision : null;
  if (!ending || !memberToken || !expectedRouteRevision) return publicApiError("Choose an ending and use the latest Plan link.", "PLAN_COMPLETION_INVALID", 400);
  if (!endingSelection) return publicApiError("Choose an ending from this route.", "PLAN_ENDING_SELECTION_INVALID", 400);
  if (ending === "food" && !terminalVenueId) return publicApiError("Include the current route stop before completing this Plan with food.", "PLAN_FOOD_TERMINAL_REQUIRED", 400);
  const signingUnavailable = planSigningPreflightResponse();
  if (signingUnavailable) return signingUnavailable;
  const [planLookup, completionLookup] = await Promise.all([
    planStateResult(id),
    planCompletionResult(id),
  ]);
  if (!planLookup.ok || !completionLookup.ok) return publicApiError("Plan completion data is temporarily unavailable.", "PLAN_COMPLETION_UNAVAILABLE", 503, { retryable: true });
  if (!planLookup.plan) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  if (completionLookup.completion) {
    const identityLookup = await planMemberIdentityResult(id, memberToken);
    if (!identityLookup.ok) return publicApiError("Plan completion data is temporarily unavailable.", "PLAN_COMPLETION_UNAVAILABLE", 503, { retryable: true });
    if (identityLookup.identity?.role !== "host") return publicApiError("Only the Plan host can complete this Plan.", "PLAN_COMPLETION_FORBIDDEN", 403);
    return verifiedCompletionResponse(planLookup.plan, completionLookup.completion, false);
  }
  const canonicalSelection = await canonicalEndingSelection(planLookup.plan, endingSelection, terminalVenueId);
  if (!canonicalSelection) {
    return publicApiError("That ending is no longer available. Choose another.", "PLAN_ENDING_EVIDENCE_STALE", 409);
  }
  const result = await planStore().complete(id, memberToken, {
    expectedRouteRevision,
    ending,
    ...(terminalVenueId ? { terminalVenueId } : {}),
    endingSelection: canonicalSelection,
  });
  if (!result.ok) return completionRefusal(result.error);
  return verifiedCompletionResponse(result.plan, result.completion, result.created, result.created ? 201 : 200);
}
