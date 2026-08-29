import "server-only";

import { canonicalOsmId } from "@/lib/harvestFold";
import { lookupCanonicalVenueWithOsm, type VenueRef } from "@/lib/venueIndex";

export type HarvestOverlayVenueResolution =
  | { status: "resolved"; venueId: string; venue?: VenueRef }
  | { status: "unknown" }
  | { status: "unavailable" };

export async function resolveHarvestOverlayVenue(
  venueId: string,
): Promise<HarvestOverlayVenueResolution> {
  const osmId = canonicalOsmId(venueId);
  if (osmId) return { status: "resolved", venueId: osmId };

  const lookup = await lookupCanonicalVenueWithOsm(venueId);
  if (lookup.status === "unavailable") return { status: "unavailable" };
  if (lookup.status === "unknown" || !lookup.venue.osmId) return { status: "unknown" };
  return { status: "resolved", venueId: lookup.venue.osmId, venue: lookup.venue };
}
