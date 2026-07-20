import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { parseCityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { isLimited } from "@/lib/pintDrops";
import { planRequestDigest, planStore } from "@/lib/planStore";
import { verifyPlanGroundingProof, wasPlanGroundedAtCreation } from "@/lib/planGrounding.server";
import { attachPlanMemberSession } from "@/lib/planMemberCapability";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey } from "@/lib/planMutationHttp";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { planLoopEventTokens } from "@/lib/verifiedAnalytics.server";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const idempotencyKey = planMutationIdempotencyKey(request, body);
  if (!idempotencyKey) return publicApiError(PLAN_IDEMPOTENCY_ERROR.error, PLAN_IDEMPOTENCY_ERROR.code, 400);
  const limiterKey = `plan-create:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, undefined, undefined, { failClosed: true })) {
    return publicApiError("Too many Plans, slow down.", "PLAN_CREATE_RATE_LIMITED", 429, { retryable: true });
  }
  const rawCity = typeof body.cityId === "string" ? body.cityId : undefined;
  const cityId = rawCity ? parseCityId(rawCity) : DEFAULT_CITY_ID;
  if (!cityId) return publicApiError("cityId is invalid.", "CITY_INVALID", 400);
  const submittedStops = Array.isArray(body.stops) ? body.stops : [];
  const venues = await loadConciergeVenues(cityId);
  const venuesById = new Map(venues.map((venue) => [venue.id, venue]));
  const stops = submittedStops.map((raw) => {
    const venueId = raw && typeof raw === "object" ? (raw as Record<string, unknown>).venueId : undefined;
    const venue = typeof venueId === "string" ? venuesById.get(venueId) : undefined;
    return venue ? { venueId: venue.id, venueName: venue.name } : null;
  });
  if (stops.some((stop) => stop === null)) {
    return publicApiError("Choose venues from the Venue Dataset.", "PLAN_VENUES_INVALID", 400);
  }
  const acceptedVenueIds = stops.flatMap((stop) => stop ? [stop.venueId] : []);
  const groundingProofDigest = typeof body.groundingProof === "string" && body.groundingProof
    ? planRequestDigest(body.groundingProof)
    : undefined;
  const result = await planStore().create(
    { ...body, stops },
    { idempotencyKey, ...(groundingProofDigest ? { groundingProofDigest } : {}) },
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
  const grounded = result.created
    ? verifyPlanGroundingProof(body.groundingProof, acceptedVenueIds, idempotencyKey)
    : wasPlanGroundedAtCreation(
        body.groundingProof,
        acceptedVenueIds,
        idempotencyKey,
        result.plan.plan.createdAt,
      );
  return attachPlanMemberSession(
    jsonNoStore({
      plan: result.plan,
      memberToken: result.memberToken,
      role: result.role,
      created: result.created,
      // The signature binds the accepted venue ids to a server-generated
      // candidate set. Client grounding flags and edited proofs are ignored.
      grounded,
      eventTokens: planLoopEventTokens({
        planId: result.plan.plan.id,
        createdAt: result.plan.plan.createdAt,
        stops: result.plan.stops.length,
        grounded,
      }),
    }, { status: 201 }),
    request,
    result.plan.plan.id,
    result.memberToken,
  );
}
