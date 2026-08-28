import "server-only";

import { canonicalOsmId } from "@/lib/harvestFold";
import { resolveVenue } from "@/lib/venueIndex";

export async function resolveHarvestOverlayVenueId(venueId: string): Promise<string> {
  return canonicalOsmId(venueId) ?? (await resolveVenue(venueId))?.osmId ?? venueId;
}
