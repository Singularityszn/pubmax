// GET /api/venue/[id] - the full venue detail (prices or typed anchors,
// amenities, and curation)
// for a single id, loaded server-side so it never rides in the client bundle.
//
// This is the lazy other half of the SLIM-INDEX split: the map fetches
// /data/venues_slim.json (~400 KB) on load to draw pins, then calls THIS route
// only when a venue is opened. Heavy source data stays on the server; a
// visitor downloads full detail for at most the handful of venues they open.
//
// Detail is built from a precomputed line-delimited per-venue artifact generated
// alongside venues_slim.json. The route streams to the selected id, parses that
// one line, then resolves either grouped pub-price rows or a curated venue seed
// through the same detail boundary. That avoids cold-parsing all source data on
// first open while keeping each venue kind's price meaning intact.
//
import { NextResponse } from "next/server";

import { canGroupGetIn, estimateBusyness, resolveBookingOption } from "@/lib/busyness";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const lookup = await lookupVenueDetail(id);

  if (lookup.status === "missing") {
    return NextResponse.json({ error: "Venue not found." }, { status: 404 });
  }
  if (lookup.status === "unavailable") {
    return NextResponse.json({ error: "Venue details unavailable." }, { status: 503 });
  }
  const { venue } = lookup;

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
