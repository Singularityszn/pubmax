import { jsonNoStore } from "@/lib/apiResponses";
import { parseCityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { isLimited } from "@/lib/pintDrops";
import { planStore } from "@/lib/planStore";
import { attachPlanMemberSession } from "@/lib/planMemberCapability";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey } from "@/lib/planMutationHttp";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  const idempotencyKey = planMutationIdempotencyKey(request, body);
  if (!idempotencyKey) return jsonNoStore(PLAN_IDEMPOTENCY_ERROR, { status: 400 });
  const limiterKey = `plan-create:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, undefined, undefined, { failClosed: true })) {
    return jsonNoStore({ error: "Too many Plans, slow down." }, { status: 429 });
  }
  const rawCity = typeof body.cityId === "string" ? body.cityId : undefined;
  const cityId = rawCity ? parseCityId(rawCity) : DEFAULT_CITY_ID;
  if (!cityId) return jsonNoStore({ error: "cityId is invalid." }, { status: 400 });
  const submittedStops = Array.isArray(body.stops) ? body.stops : [];
  const venues = await loadConciergeVenues(cityId);
  const venuesById = new Map(venues.map((venue) => [venue.id, venue]));
  const stops = submittedStops.map((raw) => {
    const venueId = raw && typeof raw === "object" ? (raw as Record<string, unknown>).venueId : undefined;
    const venue = typeof venueId === "string" ? venuesById.get(venueId) : undefined;
    return venue ? { venueId: venue.id, venueName: venue.name } : null;
  });
  if (stops.some((stop) => stop === null)) {
    return jsonNoStore({ error: "Choose venues from the Venue Dataset." }, { status: 400 });
  }
  const result = await planStore().create({ ...body, stops }, { idempotencyKey });
  if (!result.ok) {
    return jsonNoStore(
      {
        error: result.error === "invalid" ? "Add a start time, your name, and at least one venue."
          : result.error === "conflict" ? "That request key was already used for a different Plan."
            : "Could not create the Plan.",
        code: result.error === "invalid" ? "PLAN_CREATE_INVALID" : result.error === "conflict" ? "PLAN_IDEMPOTENCY_CONFLICT" : "PLAN_CREATE_UNAVAILABLE",
        retryable: result.error === "error",
      },
      { status: result.error === "invalid" ? 400 : result.error === "conflict" ? 409 : 503 },
    );
  }
  return attachPlanMemberSession(
    jsonNoStore({ plan: result.plan, memberToken: result.memberToken, role: result.role }, { status: 201 }),
    request,
    result.plan.plan.id,
    result.memberToken,
  );
}
