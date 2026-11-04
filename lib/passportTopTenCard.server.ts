import "server-only";

// What a top-ten share link shows: the signed ten, in the order they were
// signed, each with its name and the band of its listed pint. Read by the page
// and by its card, so the two cannot disagree. No score and no price figure:
// the band travels as a word and a colour, the place as the only number.

import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { verifyTopTenShare } from "@/lib/passportTopTenShare.server";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { priceBand, priceBandAreaForVenue, type PriceBand } from "@/lib/priceBand";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";
import { storedVenueName } from "@/lib/storedVenueRef";
import { resolveStoredVenue } from "@/lib/venueIndex";

type TopTenCardRow = { place: number; venueId: string; venueName: string; band: PriceBand | null };
export type TopTenCard = { handle: string; rows: TopTenCardRow[] };

/** The card for a share token, or null for a token that is not ours or an account that left. */
export async function readTopTenCard(rawHandle: string, token: unknown): Promise<TopTenCard | null> {
  const handle = normalizeHandle(rawHandle);
  const verified = verifyTopTenShare(token, handle);
  if (!verified) return null;
  try {
    if ((await withdrawnHandles([handle])).has(handle)) return null;
    const profile = await profileStore().getByHandle(handle);
    if (!profile || profile.tombstonedAt) return null;
  } catch {
    return null;
  }
  const priced = await loadPintPriceLandingVenues().catch(() => []);
  const cheapest = new Map(priced.map((venue) => [venue.id, venue.cheapestPrice ?? null]));
  const rows = await Promise.all(
    verified.venueIds.map(async (venueId, index) => {
      const venue = await resolveStoredVenue(venueId).catch(() => null);
      return {
        place: index + 1,
        venueId,
        venueName: venue ? storedVenueName(venue) : "A London pub",
        band: priceBand(cheapest.get(venueId) ?? null, priceBandAreaForVenue(venueId)),
      };
    }),
  );
  return { handle, rows };
}
