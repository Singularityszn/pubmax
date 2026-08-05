import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { getVenueIndex } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { isLimited } from "@/lib/pintDrops";
import { hashActor } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return Response.json({ code: access.code, error: access.error }, { status: access.status, headers });
  const limitKey = `social-venue-search:${hashActor(access.actor.profileId)}`;
  if (await isLimited(limitKey, limitKey, 60, 60_000)) return Response.json({ code: "RATE_LIMITED", error: "Venue search is busy. Try again shortly." }, { status: 429, headers });
  const query = new URL(request.url).searchParams.get("q")?.trim().toLocaleLowerCase("en-GB") ?? "";
  if (query.length < 2 || query.length > 80) return Response.json({ venues: [] }, { headers });
  try {
    const venues = [...(await getVenueIndex()).values()]
      .filter((venue) => isPubVenueKind(venue.kind) && `${venue.name} ${venue.borough}`.toLocaleLowerCase("en-GB").includes(query))
      .slice(0, 8).map(({ id, name, borough }) => ({ id, name, borough }));
    return Response.json({ venues }, { headers });
  } catch { return Response.json({ code: "VENUE_LOOKUP_UNAVAILABLE", error: "Venue search is unavailable right now." }, { status: 503, headers }); }
}
