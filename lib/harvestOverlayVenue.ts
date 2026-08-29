import "server-only";

import { canonicalOsmId } from "@/lib/harvestFold";
import { lookupCanonicalVenue } from "@/lib/venueIndex";

export type HarvestOverlayVenueResolution =
  | { status: "resolved"; venueId: string }
  | { status: "unknown" }
  | { status: "unavailable" };

export async function resolveHarvestOverlayVenue(
  venueId: string,
): Promise<HarvestOverlayVenueResolution> {
  const osmId = canonicalOsmId(venueId);
  if (osmId) return { status: "resolved", venueId: osmId };

  const lookup = await lookupCanonicalVenue(venueId);
  if (lookup.status === "unavailable") return { status: "unavailable" };
  if (lookup.status === "unknown" || !lookup.venue.osmId) return { status: "unknown" };
  return { status: "resolved", venueId: lookup.venue.osmId };
}
