import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { isPlanId, PLANNED_NIGHT_STATUSES, type PlanState, type PlanStopDTO } from "@/lib/plan";
import { cleanNightContext } from "@/lib/nightPlanning";
import { verifyAnchoredPlanGroundingProofV2, type PlanGroundingRejectionV2 } from "@/lib/planGrounding.server";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
import { resolvePlanProjection } from "@/lib/planPrivacyBoundary.server";
import { canonicalPlanRoute } from "@/lib/planRoute";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planStateResult, planStore, type PlanWriteError } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";
import { planAcceptedEventTokens } from "@/lib/verifiedAnalytics.server";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

/** Every V2 proof rejection on an upgrade is an explicit 422. */
function upgradeProofError(reason: PlanGroundingRejectionV2): { message: string; code: string } {
  switch (reason) {
    case "missing": return { message: "Include the grounding proof from generation.", code: "PLAN_ANCHOR_PROOF_MISSING" };
    case "expired": return { message: "The grounding proof expired. Regenerate the Route and lock it in again.", code: "PLAN_ANCHOR_PROOF_EXPIRED" };
    case "route-mismatch": return { message: "The submitted Stops do not match the grounded Route.", code: "PLAN_ANCHOR_PROOF_ROUTE_MISMATCH" };
    case "operation-mismatch": return { message: "The grounding proof was issued for a different operation.", code: "PLAN_ANCHOR_PROOF_OPERATION_MISMATCH" };
    default: return { message: "That saved route could not be checked.", code: "PLAN_ANCHOR_PROOF_INVALID" };
  }
}

type AnchoredUpgrade = { done: Response } | { groundedUpgrade: boolean; upgradeAnchored: boolean };

/**
 * Gate a route replacement as a grounded upgrade. Only a stops replacement,
 * behind the flag, carrying a valid V2 proof over the exact new order becomes a
 * grounded upgrade; every proof failure returns a 422 the caller forwards.
 */
function checkAnchoredUpgrade(
  stops: PlanStopDTO[] | null | undefined,
  rawProof: unknown,
  rawOperationKey: unknown,
): AnchoredUpgrade {
  const groundingProof = typeof rawProof === "string" ? rawProof : null;
  const operationKey = typeof rawOperationKey === "string" && rawOperationKey.trim().length >= 8 && rawOperationKey.trim().length <= 120
    ? rawOperationKey.trim()
    : null;
  if (!stops || !readTrustedHandoffFlag("anchoredGeneration") || !groundingProof || !operationKey) {
    return { groundedUpgrade: false, upgradeAnchored: false };
  }
  const verdict = verifyAnchoredPlanGroundingProofV2(groundingProof, stops.map((stop) => stop.venueId), operationKey);
  if (!verdict.ok) {
    const mapped = upgradeProofError(verdict.reason);
    return { done: publicApiError(mapped.message, mapped.code, 422) };
  }
  if (verdict.outcome !== "route") {
    return { done: publicApiError("Save all three route stops before continuing.", "PLAN_ANCHOR_OUTCOME_MISMATCH", 422) };
  }
  return { groundedUpgrade: true, upgradeAnchored: verdict.anchored };
}

/** Map a Plan update failure onto its public HTTP envelope. */
function planUpdateError(error: PlanWriteError): Response {
  const unavailable = error === "error";
  return publicApiError(
    error === "forbidden" ? "That member token cannot edit this Plan." : error === "conflict" ? "That route has changed. Refresh and try again." : unavailable ? "Plan data is temporarily unavailable." : "Could not update the Plan.",
    unavailable ? "PLAN_UPDATE_UNAVAILABLE" : error === "forbidden" ? "PLAN_UPDATE_FORBIDDEN" : error === "not_found" ? "PLAN_NOT_FOUND" : error === "conflict" ? "PLAN_ROUTE_CONFLICT" : "PLAN_UPDATE_INVALID",
    unavailable ? 503 : error === "forbidden" ? 403 : error === "not_found" ? 404 : error === "conflict" ? 409 : 400,
    { retryable: unavailable || error === "conflict" },
  );
}

/** Emit the once-per-Plan plan_accepted tokens alongside the upgraded state. */
function acceptedUpgradeResponse(planId: string, state: PlanState, anchored: boolean): Response {
  try {
    const eventTokens = planAcceptedEventTokens({
      planId,
      acceptedAt: state.plan.routeReadyAt ?? state.plan.createdAt,
      anchored,
      source: state.plan.anchorSource ?? "direct-plan",
    });
    return jsonNoStore({ ...state, eventTokens });
  } catch (error) {
    const unavailable = planSigningUnavailableResponse(error);
    if (unavailable) return unavailable;
    throw error;
  }
}

async function safeVibeTally(id: string) {
  try {
    const result = await planCollaborationStore().vibeTally(id);
    return result.ok ? result.tally : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const lookup = await planStateResult(id);
  if (!lookup.ok) return publicApiError("Plan data is temporarily unavailable.", "PLAN_STORE_UNAVAILABLE", 503, { retryable: true });
  if (!lookup.plan) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  // §4.10: a valid host/guest capability (with member rehydration enabled) gets
  // the raw PlanState it always did; everyone else gets the redacted preview.
  const projection = await resolvePlanProjection({
    request,
    planId: id,
    state: lookup.plan,
    vibeTally: await safeVibeTally(id),
  });
  return jsonNoStore(projection.visibility === "member" ? projection.state : projection, { status: 200 });
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
  if (body.context !== undefined && !nightContext) return publicApiError("Add valid Plan details.", "NIGHT_CONTEXT_INVALID", 400);
  if (hasStops && (!stops || expectedRouteRevision === undefined || status)) return publicApiError("Choose exactly three different listed stops and use the latest route version.", "PLAN_ROUTE_INVALID", 400);
  if (!hasStops && !status && !nightContext) return publicApiError("Choose what to update.", "PLAN_UPDATE_INVALID", 400);
  // Anchored upgrade (§3.3): a one-Stop draft rises to a grounded three-Stop
  // route only with a valid V2 proof over the exact new order.
  const upgrade = checkAnchoredUpgrade(stops, body.groundingProof, body.operationKey);
  if ("done" in upgrade) return upgrade.done;
  const result = await planStore().update(id, planMemberCapability(request, body.memberToken), {
    ...(status ? { status } : {}),
    ...(nightContext ? { context: nightContext } : {}),
    ...(stops ? { stops, expectedRouteRevision, groundedUpgrade: upgrade.groundedUpgrade } : {}),
  });
  if (!result.ok) return planUpdateError(result.error);
  // The first grounded three-Stop transition emits plan_accepted once — the
  // token key is planId-scoped, so replays and later route edits never re-count.
  if (upgrade.groundedUpgrade && result.plan.plan.outcome === "route" && result.plan.plan.routeReadyAt) {
    return acceptedUpgradeResponse(id, result.plan, upgrade.upgradeAnchored);
  }
  return jsonNoStore(result.plan);
}
