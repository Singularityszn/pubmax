// GET /api/venue/[id] — the FULL venue detail (all prices, amenities, curation)
// for a single id, loaded server-side so it never rides in the client bundle.
//
// This is the lazy other half of the SLIM-INDEX split: the map fetches
// /data/venues_slim.json (~140 KB) on load to draw pins, then calls THIS route
// only when a pub is opened. The heavy ~6 MB dataset stays on the server; a
// visitor downloads full detail for at most the handful of venues they open.
//
// Detail is built by the SAME groupVenuePrices used everywhere else, memoized
// per-process (mirroring lib/venueIndex.ts): the first request groups the
// dataset once, all later requests reuse the id→Venue map. Ids match the
// "venue-…" ids the slim index carries, so a slim pin resolves here directly.
//
// Never throws to a 500 on a read/parse failure — it degrades to an empty index
// so an unknown/absent id returns a friendly 404 instead. Cached hard at the
// edge (immutable-ish detail) with a long SWR window.

import { promises as fs } from "fs";
import path from "path";

import { NextResponse } from "next/server";

import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

let cached: Map<string, Venue> | null = null;

// Read + group the dataset once, memoized. A read/parse failure yields an empty
// map so this route 404s (friendly) rather than 500-ing.
async function getVenueDetailIndex(): Promise<Map<string, Venue>> {
  if (cached) return cached;
  const index = new Map<string, Venue>();
  try {
    const file = path.join(
      process.cwd(),
      "public",
      "data",
      "pint_prices_app_dataset.json",
    );
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    for (const venue of groupVenuePrices(Array.isArray(rows) ? rows : [])) {
      index.set(venue.id, venue);
    }
  } catch {
    // leave `index` empty — degrade to 404s, never a 500
  }
  cached = index;
  return cached;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const venue = (await getVenueDetailIndex()).get(id);

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
