import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerUserId } from "@/lib/authServer";
import { parseCityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { inferNightContext } from "@/lib/nightPlanning";
import { isLimited } from "@/lib/pintDrops";
import { cleanPlanAnchor } from "@/lib/plan";
import { planStopResolver } from "@/lib/planRoute";
import { resolvePlanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence.server";
import { cleanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import { claimPlanMembership } from "@/lib/planCrewIdentity";
import { planMemberIdentity, planRequestDigest, planStore, replayPlanCreation } from "@/lib/planStore";
import {
  readPlanGroundingClaimsV2,
  verifyAnchoredPlanGroundingProofV2,
  verifyPlanGroundingProof,
  wasPlanGroundedAtCreation,
  planGroundingRejectionError,
} from "@/lib/planGrounding.server";
import { planSigningPreflightResponse, planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
import { attachPlanMemberSession } from "@/lib/planMemberCapability";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey } from "@/lib/planMutationHttp";
import { PLAN_SHORTLIST_MAX } from "@/lib/planShortlist";
import { shortlistCandidates, shortlistFilters } from "@/lib/planShortlistCandidates.server";
import { shortlistWriteGate } from "@/lib/planShortlistHttp.server";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { planAcceptedEventTokens, planDraftSavedEventToken, planLoopEventTokens } from "@/lib/verifiedAnalytics.server";

assertServerEnv();

function createEventTokens(input: {
  anchor: ReturnType<typeof cleanPlanAnchor>;
  anchorAnchored: boolean;
  createdAt: string;
  grounded: boolean;
  planId: string;
  routeReadyAt: string | null;
  stopCount: number;
}): Record<string, string> {
  if (!input.anchor) {
    return planLoopEventTokens({
      planId: input.planId,
      createdAt: input.createdAt,
      stops: input.stopCount,
      grounded: input.grounded,
    });
  }
  if (input.anchor.outcome === "anchor-only") {
    return {
      planDraftSaved: planDraftSavedEventToken({
        planId: input.planId,
        savedAt: input.createdAt,
        source: input.anchor.source,
      }),
      planAccepted: "",
      meaningfulCoreAction: "",
    };
  }
  return {
    planDraftSaved: "",
    ...planAcceptedEventTokens({
      planId: input.planId,
      acceptedAt: input.routeReadyAt ?? input.createdAt,
      anchored: input.anchorAnchored,
      source: input.anchor.source,
    }),
  };
}

async function claimSignedInPlanCreator(
  request: Request,
  planId: string,
  memberToken: string,
): Promise<void> {
  try {
    const hostUserId = await callerUserId(request);
    if (!hostUserId) return;
    const hostIdentity = await planMemberIdentity(planId, memberToken);
    if (!hostIdentity?.memberId) return;
    await claimPlanMembership(planId, hostIdentity.memberId, hostUserId);
  } catch {
    // Plan creation still succeeds. Account claim retries from ActivePlanMarker.
  }
}

async function createShortlist(
  request: Request,
  input: unknown,
  startTime: unknown,
  idempotencyKey: string,
): Promise<Response> {
  const refusal = await shortlistWriteGate(request, "create");
  if (refusal) return refusal;
  const body = input as { filters?: string; venueIds?: unknown[]; budgetLimitPence?: unknown } | null;
  const ids = body?.venueIds;
  const budget = body?.budgetLimitPence;
  const filters = typeof body?.filters === "string" && body.filters.length <= 512
    ? shortlistFilters(new URLSearchParams(body.filters))
    : null;
  if (!filters || !Array.isArray(ids) || ids.length < 1 || ids.length > PLAN_SHORTLIST_MAX
      || !ids.every((id) => typeof id === "string") || new Set(ids).size !== ids.length
      || typeof startTime !== "string" || !Number.isFinite(Date.parse(startTime))) {
    return publicApiError("Choose up to three listed pubs.", "INVALID_REQUEST", 400);
  }
  if (budget != null && (typeof budget !== "number" || !Number.isInteger(budget) || budget < 500 || budget > 50_000)) {
    return publicApiError("Enter an outing budget between £5 and £500 per person.", "INVALID_REQUEST", 400);
  }
  const requestHash = planRequestDigest({
    shortlist: { filters: body?.filters, venueIds: ids, budgetLimitPence: budget ?? null }, startTime,
  });
  let created = await replayPlanCreation(idempotencyKey, requestHash);
  if (!created) {
    const suggested = await shortlistCandidates(filters);
    const options = suggested.filter((option) => ids.includes(option.venueId));
    if (options.length !== ids.length) {
      return publicApiError("Some options have changed. Find pubs again.", "CONFLICT", 409);
    }
    const context = { ...inferNightContext("evening").context, nightArea: filters.area.slug, budgetLimitPence: budget ?? null };
    created = await planStore().create(
      { title: "Group night", creatorName: "Organiser", startTime, stops: options, context },
      { idempotencyKey, shortlist: { options, requestHash } },
    );
  }
  if (!created.ok) {
    if (created.error === "invalid") return publicApiError("Could not read the shortlist.", "INVALID_REQUEST", 400);
    if (created.error === "conflict") return publicApiError("This request key was used for a different shortlist.", "CONFLICT", 409);
    return publicApiError("Could not create the shortlist. Try again.", "UNAVAILABLE", 503, { retryable: true });
  }
  const planId = created.plan.plan.id;
  await claimSignedInPlanCreator(request, planId, created.memberToken);
  return attachPlanMemberSession(
    jsonNoStore({ planId, created: created.created }, { status: 201 }),
    request, planId, created.memberToken,
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const idempotencyKey = planMutationIdempotencyKey(request, body);
  if (!idempotencyKey) return publicApiError(PLAN_IDEMPOTENCY_ERROR.error, PLAN_IDEMPOTENCY_ERROR.code, 400);
  const signingUnavailable = planSigningPreflightResponse();
  if (signingUnavailable) return signingUnavailable;
  if ("shortlist" in body) return createShortlist(request, body.shortlist, body.startTime, idempotencyKey);
  return createClassicPlan(request, body, idempotencyKey);
}

async function createClassicPlan(request: Request, body: Record<string, unknown>, idempotencyKey: string): Promise<Response> {
  const limiterKey = `plan-create:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, undefined, undefined, { failClosed: true })) {
    return publicApiError("Too many Plans, slow down.", "PLAN_CREATE_RATE_LIMITED", 429, { retryable: true });
  }
  const rawCity = typeof body.cityId === "string" ? body.cityId : undefined;
  const cityId = rawCity ? parseCityId(rawCity) : DEFAULT_CITY_ID;
  if (!cityId) return publicApiError("Choose a listed city.", "CITY_INVALID", 400);
  const submittedStops = Array.isArray(body.stops) ? body.stops : [];
  // One rule for what a Stop id may be, shared with route replacement: a listed
  // venue, or a `place:<poi id>` meeting point. Free text resolves to nothing.
  const resolveStop = await planStopResolver(cityId);
  const resolvedStops = submittedStops.map((raw) => resolveStop(raw));
  if (resolvedStops.some((stop) => stop === null)) {
    return publicApiError("Choose listed venues.", "PLAN_VENUES_INVALID", 400);
  }
  const idempotencyStops = (resolvedStops as NonNullable<(typeof resolvedStops)[number]>[]).map((stop, position) => {
    const raw = submittedStops[position];
    const hint = cleanSelectedDrinkPriceEvidence(
      raw && typeof raw === "object" ? (raw as Record<string, unknown>).selectedDrinkPriceEvidence : null,
    );
    return { ...stop, ...(hint ? { selectedDrinkPriceEvidence: hint } : {}) };
  });
  const stops = await resolvePlanSelectedDrinkPriceEvidence(
    resolvedStops as NonNullable<(typeof resolvedStops)[number]>[], submittedStops, body.context,
  );
  const acceptedVenueIds = stops.flatMap((stop) => stop ? [stop.venueId] : []);
  const groundingProofDigest = typeof body.groundingProof === "string" && body.groundingProof
    ? planRequestDigest(body.groundingProof)
    : undefined;
  // Anchored lock (§3.3): an accepted anchor must carry a valid V2 grounding
  // proof whose exact ordered Stops match this Plan. Every proof failure is an
  // explicit 422; a same-key replay with a changed anchor or proof is resolved
  // to a 409 by the store's idempotency hash below.
  const anchorSupplied = Object.prototype.hasOwnProperty.call(body, "anchor");
  const anchor = cleanPlanAnchor(body.anchor);
  if (anchorSupplied && !anchor) {
    return publicApiError("Include the accepted pub and where it came from.", "PLAN_ANCHOR_INVALID", 422);
  }
  if (!anchor && readPlanGroundingClaimsV2(body.groundingProof)) {
    return publicApiError("Include the accepted pub for this route.", "PLAN_ANCHOR_REQUIRED", 422);
  }
  let anchorAnchored = false;
  if (anchor) {
    const verdict = verifyAnchoredPlanGroundingProofV2(body.groundingProof, acceptedVenueIds, idempotencyKey);
    if (!verdict.ok) {
      const mapped = planGroundingRejectionError(verdict.reason);
      return publicApiError(mapped.message, mapped.code, 422);
    }
    if (verdict.outcome !== anchor.outcome) {
      return publicApiError("That saved route does not match this plan.", "PLAN_ANCHOR_OUTCOME_MISMATCH", 422);
    }
    if (verdict.anchorVenueId !== anchor.venueId) {
      return publicApiError("That saved pub does not match this plan.", "PLAN_ANCHOR_VENUE_MISMATCH", 422);
    }
    if (verdict.anchorSource !== anchor.source) {
      return publicApiError("That pub came from somewhere else than this plan says.", "PLAN_ANCHOR_SOURCE_MISMATCH", 422);
    }
    anchorAnchored = verdict.anchored;
  }
  const result = await planStore().create(
    { ...body, stops },
    { idempotencyKey, idempotencyStops, ...(groundingProofDigest ? { groundingProofDigest } : {}), ...(anchor ? { anchor } : {}) },
  );
  if (!result.ok) {
    return publicApiError(
      result.error === "invalid" ? "Add a start time, your name, and at least one venue."
        : result.error === "conflict" ? "That request key was already used for a different Plan."
          : "Could not create the Plan.",
      result.error === "invalid" ? "PLAN_CREATE_INVALID" : result.error === "conflict" ? "PLAN_IDEMPOTENCY_CONFLICT" : "PLAN_CREATE_UNAVAILABLE",
      result.error === "invalid" ? 400 : result.error === "conflict" ? 409 : 503,
      { retryable: result.error === "error" },
    );
  }
  // An anchored Plan is grounded by its verified V2 proof; legacy creation keeps
  // the V1 candidate-set derivation.
  const grounded = anchor
    ? true
    : result.created
      ? verifyPlanGroundingProof(body.groundingProof, acceptedVenueIds, idempotencyKey)
      : wasPlanGroundedAtCreation(
          body.groundingProof,
          acceptedVenueIds,
          idempotencyKey,
          result.plan.plan.createdAt,
        );
  let eventTokens: Record<string, string>;
  try {
    eventTokens = createEventTokens({
      anchor,
      anchorAnchored,
      createdAt: result.plan.plan.createdAt,
      grounded,
      planId: result.plan.plan.id,
      routeReadyAt: result.plan.plan.routeReadyAt ?? null,
      stopCount: result.plan.stops.length,
    });
  } catch (error) {
    const unavailable = planSigningUnavailableResponse(error);
    if (unavailable) return unavailable;
    throw error;
  }
  // Bind a signed-in creator to the host membership and Plan in one write.
  // A public handle is not required to keep Plan ownership after signup.
  await claimSignedInPlanCreator(request, result.plan.plan.id, result.memberToken);

  return attachPlanMemberSession(
    jsonNoStore({
      plan: result.plan,
      memberToken: result.memberToken,
      role: result.role,
      created: result.created,
      // The signature binds the accepted venue ids to a server-generated
      // candidate set. Client grounding flags and edited proofs are ignored.
      grounded,
      eventTokens,
    }, { status: 201 }),
    request,
    result.plan.plan.id,
    result.memberToken,
  );
}
