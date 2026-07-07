// GET /api/venue/[id] — the FULL venue detail (all prices, amenities, curation)
// for a single id, loaded server-side so it never rides in the client bundle.
//
// This is the lazy other half of the SLIM-INDEX split: the map fetches
// /data/venues_slim.json (~140 KB) on load to draw pins, then calls THIS route
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

import { getVenueDetail } from "@/lib/venueDetailIndex";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const venue = await getVenueDetail(id);

  if (!venue) {
    return NextResponse.json({ error: "Venue not found." }, { status: 404 });
  }

  return NextResponse.json(
    { venue },
    {
      status: 200,
      headers: {
        // Detail is derived from a static dataset that only changes on a data
        // refresh — cache hard at the edge, keep serving stale for a week while
        // it revalidates in the background.
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
