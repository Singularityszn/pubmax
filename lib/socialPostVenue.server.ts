import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export type SocialVenueResolution =
  | { ok: true; venueId: string }
  | { ok: false; unavailable: boolean };

export async function resolveSocialVenueId(
  requestedVenueId: string,
): Promise<SocialVenueResolution> {
  const lookup = await lookupCanonicalVenue(requestedVenueId);
  if (lookup.status === "unavailable") return { ok: false, unavailable: true };
  if (lookup.status !== "found" || !isPubVenueKind(lookup.venue.kind)) {
    return { ok: false, unavailable: false };
  }
  return { ok: true, venueId: lookup.canonicalId };
}
