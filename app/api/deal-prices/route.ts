import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedJson } from "@/lib/boundedRequest.server";
import { deriveCommunityPriceActor } from "@/lib/communityPriceActor";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { validateDealPrice } from "@/lib/dealPrice";
import { dealPriceStore } from "@/lib/dealPriceStore";
import { dealIsVisible } from "@/lib/dealSchedule";
import { isLimited } from "@/lib/pintDrops";
import { resolveWritableVenueId } from "@/lib/venueWriteTarget.server";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const venueId = url.searchParams.get("venueId");
  if (!venueId || !/^venue-[a-zA-Z0-9-]+$/.test(venueId)) return publicApiError("Choose a pub.", "INVALID_REQUEST", 400);
  const actor = deriveCommunityPriceActor(request) ?? "anon";
  const key = `deal-read:${actor}`;
  if (await isLimited(key, key, 120, 60_000)) return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  try {
    return jsonNoStore({ deals: await dealPriceStore().read(venueId) });
  } catch {
    return publicApiError("Deals are unavailable right now.", "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await boundedJson(request); } catch { return publicApiError("Could not read the deal.", "MALFORMED_REQUEST", 400); }
  if (body && typeof body === "object" && "action" in body && body.action === "report") {
    const id = "id" in body ? body.id : null;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return publicApiError("Choose a deal to report.", "INVALID_REQUEST", 400);
    const actor = deriveCommunityPriceActor(request);
    if (!actor) return publicApiError("Could not report the deal right now.", "UNAVAILABLE", 503, { retryable: true });
    const key = `deal-report:${actor}`;
    if (await isLimited(key, key, 30, 3_600_000)) return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, { retryable: true });
    try {
      if (!await dealPriceStore().report(id, actor)) return publicApiError("That deal was not found.", "NOT_FOUND", 404);
      return jsonNoStore({ ok: true });
    } catch { return publicApiError("Could not report the deal right now.", "UNAVAILABLE", 503, { retryable: true }); }
  }
  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  const parsed = validateDealPrice(body);
  if (!parsed.ok) return publicApiError(parsed.error, "INVALID_REQUEST", 400);
  if (!dealIsVisible(parsed.value, new Date())) return publicApiError("The end date has passed.", "INVALID_REQUEST", 400);
  const venue = await resolveWritableVenueId(parsed.value.venueId, { pubsOnly: true });
  if (!venue.ok) return publicApiErrorFromStatus(venue.error, venue.status);
  const key = `deal-write:${contributor.actor}`;
  if (await isLimited(key, key, 30, 3_600_000)) return publicApiError("Too many logs, slow down.", "RATE_LIMITED", 429, { retryable: true });
  try {
    const saved = await dealPriceStore().submit({ ...parsed.value, venueId: venue.venueId, accountId: contributor.accountId });
    return jsonNoStore({ deal: saved.deal, visible: !saved.hidden }, { status: 201 });
  } catch {
    return publicApiError("Could not save the deal right now.", "UNAVAILABLE", 503, { retryable: true });
  }
}
