import "server-only";

import { loadLondonHuntPints } from "@/lib/cheapestHunt.server";
import { readSpoonsValue } from "@/lib/spoonsValue.server";
import {
  tonightCheapPintCandidates,
  tonightCheapPints,
  tonightWetherspoonVenueIds,
} from "@/lib/tonightCheapPints";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import { matchedWetherspoonsVenueIds } from "@/lib/wetherspoonsMatch.server";

export async function loadLondonPintRanking(limit: number) {
  const [pints, spoons] = await Promise.all([
    loadLondonHuntPints(),
    readSpoonsValue(),
  ]);
  if (pints.length === 0) return [];
  const venues = await getPricedVenues();
  const directoryMatches = await matchedWetherspoonsVenueIds(venues.map((venue) => ({
    id: venue.id,
    name: venue.name,
    lat: venue.latitude,
    lng: venue.longitude,
  })));
  const wetherspoonIds = tonightWetherspoonVenueIds(
    directoryMatches,
    new Set(spoons.byVenueId.keys()),
  );
  return tonightCheapPints(tonightCheapPintCandidates(
    pints,
    new Map(venues.map((venue) => [venue.id, venue])),
    wetherspoonIds,
  ), limit);
}
