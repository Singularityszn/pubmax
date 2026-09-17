import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { cleanEndingSelection, isPlanId, type CrawlEnding, type PlanCompletionDTO, type PlanState } from "@/lib/plan";
import { planCompletionResult, planMemberIdentityResult, planStateResult, planStore, type PlanWriteError } from "@/lib/planStore";
import { canonicalEndingSelection } from "@/lib/planEndingSelection.server";
import { planSigningPreflightResponse, planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { cleanText } from "@/lib/textClean";
import { planWriteErrorToStatus } from "@/lib/planMutationHttp";
import { completionLoopEventTokens } from "@/lib/verifiedAnalytics.server";

type Context = { params: Promise<{ id: string }> };
const ENDINGS: CrawlEnding[] = ["food", "get_home", "keep_going"];

function completionResponse(
  plan: PlanState,
  completion: PlanCompletionDTO,
  created: boolean,
): Record<string, unknown> {
  return {
    plan,
    completion,
    created,
    eventTokens: completionLoopEventTokens({
      completionId: completion.id,
      completedAt: completion.completedAt,
      ending: completion.ending,
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

type CompletionInput =
  | { ok: true; ending: CrawlEnding; memberToken: string; terminalVenueId: string | null; endingSelection: NonNullable<ReturnType<typeof cleanEndingSelection>>; expectedRouteRevision: number }
  | { ok: false; response: Response };

function parseCompletionInput(request: Request, body: Record<string, unknown>): CompletionInput {
  const ending = typeof body.ending === "string" && ENDINGS.includes(body.ending as CrawlEnding) ? body.ending as CrawlEnding : null;
  const memberToken = planMemberCapability(request, body.memberToken);
  const terminalVenueId = cleanText(body.terminalVenueId, 80);
  const endingSelection = ending ? cleanEndingSelection(body.endingSelection, ending) : null;
  if (body.finalPintDropId !== undefined) return { ok: false, response: publicApiError("A final Pint Drop cannot be attached until Plan member ownership is verifiable.", "FINAL_PINT_DROP_FORBIDDEN", 400) };
  const expectedRouteRevision = typeof body.expectedRouteRevision === "number" && Number.isInteger(body.expectedRouteRevision) && body.expectedRouteRevision > 0 ? body.expectedRouteRevision : null;
  if (!ending || !memberToken || !expectedRouteRevision) return { ok: false, response: publicApiError("Choose an ending and use the latest Plan link.", "PLAN_COMPLETION_INVALID", 400) };
  if (!endingSelection) return { ok: false, response: publicApiError("Choose an ending from this route.", "PLAN_ENDING_SELECTION_INVALID", 400) };
  if (ending === "food" && !terminalVenueId) return { ok: false, response: publicApiError("Include the current route stop before completing this Plan with food.", "PLAN_FOOD_TERMINAL_REQUIRED", 400) };
  return { ok: true, ending, memberToken, terminalVenueId, endingSelection, expectedRouteRevision };
}

const COMPLETION_ERROR_MAP: Record<string, { message: string; code: string }> = {
  forbidden:        { message: "Only the Plan host can complete this Plan.", code: "PLAN_COMPLETION_FORBIDDEN" },
  conflict:         { message: "That route has changed. Refresh and try again.", code: "PLAN_ROUTE_CONFLICT" },
  arrival_required: { message: "Mark at least one route stop as arrived before completing this Plan.", code: "PLAN_ARRIVAL_REQUIRED" },
  error:            { message: "Plan completion is temporarily unavailable.", code: "PLAN_COMPLETION_UNAVAILABLE" },
  not_found:        { message: "Could not complete this Plan.", code: "PLAN_NOT_FOUND" },
};
const COMPLETION_ERROR_FALLBACK = { message: "Could not complete this Plan.", code: "PLAN_COMPLETION_INVALID" };

function completionErrorResponse(error: string): Response {
  const { message, code } = COMPLETION_ERROR_MAP[error] ?? COMPLETION_ERROR_FALLBACK;
  return publicApiError(message, code, planWriteErrorToStatus(error as PlanWriteError), { retryable: error === "error" || error === "conflict" });
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
  const input = parseCompletionInput(request, body);
  if (!input.ok) return input.response;
  const { ending, memberToken, terminalVenueId, endingSelection, expectedRouteRevision } = input;
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
  if (!result.ok) return completionErrorResponse(result.error);
  return verifiedCompletionResponse(result.plan, result.completion, result.created, result.created ? 201 : 200);
}
