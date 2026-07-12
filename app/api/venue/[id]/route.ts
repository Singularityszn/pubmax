// GET /api/venue/[id] — the FULL venue detail (all prices, amenities, curation)
// for a single id, loaded server-side so it never rides in the client bundle.
//
// This is the lazy other half of the SLIM-INDEX split: the map fetches
// /data/venues_slim.json (~400 KB) on load to draw pins, then calls THIS route
// only when a pub is opened. The heavy ~6 MB dataset stays on the server; a
// visitor downloads full detail for at most the handful of venues they open.
//
// Detail is built from a precomputed line-delimited per-venue artifact generated
// alongside venues_slim.json. The route streams to the selected id, parses that
// one line, and then runs the SAME groupVenuePrices used everywhere else on the
// selected pub's rows. That keeps the curation/accessibility logic centralized
// without cold-parsing/grouping the full pint dataset for the first open.
//
// Never throws to a 500 on a read/parse failure — it degrades to an empty index
// so an unknown/absent id returns a friendly 404 instead. Cached hard at the
// edge (immutable-ish detail) with a long SWR window.

import { NextResponse } from "next/server";

import { canGroupGetIn, estimateBusyness, resolveBookingOption } from "@/lib/busyness";
import { getVenueDetail } from "@/lib/venueDetailIndex";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const venue = await getVenueDetail(id);

  if (!venue) {
    return NextResponse.json({ error: "Venue not found." }, { status: 404 });
  }

  const requestedGroupSize = Number(new URL(request.url).searchParams.get("groupSize") ?? 2);
  const groupSize = Number.isFinite(requestedGroupSize)
    ? Math.max(1, Math.min(30, Math.round(requestedGroupSize)))
    : 2;
  const busyness = estimateBusyness({ timeZone: "Europe/London" });
  const booking = resolveBookingOption(venue.bookingLink);
  const getIn = {
    groupSize,
    ...canGroupGetIn({
      groupSize,
      level: busyness.level,
      hasBookingLink: booking.available,
      timeZone: "Europe/London",
    }),
  };

  return NextResponse.json(
    { venue, busyness, getIn, booking },
    {
      status: 200,
      headers: {
        // Venue detail itself is static, but the additive day/time estimate is
        // not. Keep the response briefly cacheable without freezing "busy now"
        // for a full day.
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
