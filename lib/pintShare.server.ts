import "server-only";

import type { PintShare } from "@/lib/pintShare";
import { isVenueDetailId, lookupVenueDetail } from "@/lib/venueDetailIndex";
import { venueAreaLabel } from "@/lib/venueDisplay";
import { venuePintShare } from "@/lib/venuePintShare";

// The server half of the pint share (lib/pintShare.ts owns the rules). The
// card route reads the pint from the venue dataset through `venuePintShare`,
// the same exact-figure reading the /near answer and the pub's own sheet make,
// so a preview cannot show a pint the app would not. Only the card route reads
// it: the `/map` document twin stays free of the venue packs.

export type ResolvedPintShare = {
  /** The pub, when the id names one. */
  venue: { id: string; name: string; area: string } | null;
  /** Its listed pint with source and day, or null when the record lacks any of them. */
  share: PintShare | null;
};

const NOTHING: ResolvedPintShare = { venue: null, share: null };

/** Never throws: an unknown id, a retired pub and a failed read all answer nothing. */
export async function resolvePintShare(venueId: string): Promise<ResolvedPintShare> {
  const id = venueId.trim();
  if (!id || !isVenueDetailId(id)) return NOTHING;
  try {
    const read = await lookupVenueDetail(id);
    if (read.status !== "found") return NOTHING;
    const { venue } = read;
    const area = venueAreaLabel(venue);
    const share = venuePintShare(venue);
    return { venue: { id: venue.id, name: venue.name, area }, share };
  } catch {
    return NOTHING;
  }
}
