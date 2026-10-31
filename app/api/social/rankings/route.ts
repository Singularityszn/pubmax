import { publicApiError } from "@/lib/apiError";
import { boundedJson } from "@/lib/boundedRequest.server";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { SocialPubRankingError, socialPubRankingStore } from "@/lib/socialPubRankingStore";
import { isSocialPubBand, socialPubRankingEntries } from "@/lib/socialPubRankings";
import { resolveSocialVenueId } from "@/lib/socialPostVenue.server";
import { hashActor } from "@/lib/supabase";
import { readShareToLot, tellYourLot, tellYourLotRankBody } from "@/lib/tellYourLot.server";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const WRITE_LIMIT = 60;
const WRITE_WINDOW_MS = 60 * 60_000;

type Access = Extract<Awaited<ReturnType<typeof requireVerifiedSocialActor>>, { ok: true }>;

async function verified(request: Request): Promise<Access | Response> {
  const access = await requireVerifiedSocialActor(request);
  return access.ok
    ? access
    : publicApiError(access.error, access.code, access.status, { retryable: access.retryable === true, headers: NO_STORE });
}

/** A listed pub's name and the cheapest price the map lists for it, or null. */
async function venueFacts(venueId: string): Promise<{ venueId: string; venueName: string; listedPrice: number | null } | null> {
  const lookup = await lookupCanonicalVenue(venueId);
  if (lookup.status !== "found" || !isPubVenueKind(lookup.venue.kind)) return null;
  const price = lookup.slimVenue?.cheapestPrice;
  return {
    venueId: lookup.canonicalId,
    venueName: lookup.venue.name,
    listedPrice: typeof price === "number" && Number.isFinite(price) ? price : null,
  };
}

/**
 * The list, each pub with its name and listed price. With `subjectVenueId`
 * (GET ?venue=), the pub being ranked rides along so the rank card can show
 * its price beside the one it is compared with.
 */
async function listFor(access: Access, subjectVenueId?: string | null): Promise<Response> {
  const rows = await socialPubRankingStore().read(access.actor);
  const names = new Map<string, string>();
  const prices = new Map<string, number | null>();
  await Promise.all(rows.map(async (row) => {
    const venue = await venueFacts(row.venueId);
    if (!venue) return;
    names.set(row.venueId, venue.venueName);
    prices.set(row.venueId, venue.listedPrice);
  }));
  const entries = socialPubRankingEntries(rows, names)
    .map((entry) => ({ ...entry, listedPrice: prices.get(entry.venueId) ?? null }));
  const subject = subjectVenueId ? await venueFacts(subjectVenueId) : null;
  return Response.json(subject ? { entries, subject } : { entries }, { headers: NO_STORE });
}

function optionalVenue(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.length >= 1 && value.length <= 100 ? value : undefined;
}

async function writeGate(request: Request): Promise<{ access: Access; input: Record<string, unknown> } | Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const access = await verified(request);
  if (access instanceof Response) return access;
  const key = `social-pub-ranking:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, WRITE_LIMIT, WRITE_WINDOW_MS)) {
    return publicApiError("Too many changes for now. Try again later.", "RATE_LIMITED", 429, { retryable: true, headers: NO_STORE });
  }
  let input: unknown;
  try {
    input = await boundedJson(request);
  } catch {
    return publicApiError("Ranking request is not valid.", "MALFORMED_REQUEST", 400, { headers: NO_STORE });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return publicApiError("Ranking request is not valid.", "MALFORMED_REQUEST", 400, { headers: NO_STORE });
  }
  return { access, input: input as Record<string, unknown> };
}

/**
 * GET /api/social/rankings[?venue=<id>]: your pubs in your own order, with
 * place, 0-10 score and listed price; `?venue=` adds that pub as `subject`.
 */
export async function GET(request: Request): Promise<Response> {
  const access = await verified(request);
  if (access instanceof Response) return access;
  const subject = new URL(request.url).searchParams.get("venue");
  try {
    return await listFor(access, subject && subject.length <= 100 ? subject : null);
  } catch {
    return publicApiError("Your ranking is unavailable right now.", "RANKING_UNAVAILABLE", 503, { retryable: true, headers: NO_STORE });
  }
}

/**
 * POST /api/social/rankings { venueId, band, aboveVenueId, belowVenueId, shareToLot? }:
 * places a pub where the browser's comparisons landed it. A list that moved
 * since the questions were asked answers 409 and the browser asks again.
 * `shareToLot: true` ("Tell your lot") also writes one mutuals-only post in
 * the session's own name: "@x ranked <pub> above <the pub just below it>".
 * The answer carries `shared` only when it was asked for.
 */
export async function POST(request: Request): Promise<Response> {
  const gate = await writeGate(request);
  if (gate instanceof Response) return gate;
  const { access, input } = gate;
  const keys = Object.keys(input);
  const above = optionalVenue(input.aboveVenueId);
  const below = optionalVenue(input.belowVenueId);
  const shareToLot = readShareToLot(input.shareToLot);
  if (keys.some((key) => !["venueId", "band", "aboveVenueId", "belowVenueId", "shareToLot"].includes(key)) ||
    typeof input.venueId !== "string" || !isSocialPubBand(input.band) || above === undefined || below === undefined ||
    shareToLot === null) {
    return publicApiError("Ranking request is not valid.", "INVALID_RANKING", 400, { headers: NO_STORE });
  }
  try {
    const venue = await resolveSocialVenueId(input.venueId);
    if (!venue.ok) {
      return venue.unavailable
        ? publicApiError("Venue search is unavailable right now.", "VENUE_LOOKUP_UNAVAILABLE", 503, { retryable: true, headers: NO_STORE })
        : publicApiError("Choose a pub from the search.", "INVALID_VENUE", 400, { headers: NO_STORE });
    }
    await socialPubRankingStore().place(access.actor, venue.venueId, input.band, above, below);
    const listed = await listFor(access);
    if (!shareToLot) return listed;
    // The author is the verified actor of this session and nobody else: the
    // body names no handle and an unknown key is refused above.
    const belowVenue = below ? await resolveSocialVenueId(below) : null;
    const shared = await tellYourLot(access.actor, {
      body: tellYourLotRankBody(access.actor.handle, venue.venueName, belowVenue?.ok ? belowVenue.venueName : null),
      venueId: venue.venueId,
    });
    const body = (await listed.json()) as Record<string, unknown>;
    return Response.json({ ...body, shared }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SocialPubRankingError) {
      return publicApiError(error.message, error.code, error.code === "STALE_RANKING" ? 409 : 400, { headers: NO_STORE });
    }
    return publicApiError("Your ranking is unavailable right now.", "RANKING_UNAVAILABLE", 503, { retryable: true, headers: NO_STORE });
  }
}

/** DELETE /api/social/rankings { venueId }: takes a pub off your list. */
export async function DELETE(request: Request): Promise<Response> {
  const gate = await writeGate(request);
  if (gate instanceof Response) return gate;
  const { access, input } = gate;
  if (Object.keys(input).some((key) => key !== "venueId") || typeof input.venueId !== "string" || input.venueId.length > 100) {
    return publicApiError("Ranking request is not valid.", "INVALID_RANKING", 400, { headers: NO_STORE });
  }
  try {
    await socialPubRankingStore().remove(access.actor, input.venueId);
    return await listFor(access);
  } catch {
    return publicApiError("Your ranking is unavailable right now.", "RANKING_UNAVAILABLE", 503, { retryable: true, headers: NO_STORE });
  }
}
