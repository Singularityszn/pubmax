import "server-only";

import { lookupCanonicalVenue, lookupRetiredIndexedVenue } from "@/lib/venueIndex";
import { yearShareVenueIds, type YearShare } from "@/lib/yearInPints";

// The server half of the Year in Pints share (lib/yearInPints.ts owns the
// rules). A shared year names a pub by its dataset id only, and the card and
// the shared page read its name here, so a link can never put words of its
// own on a card. A pub that has since closed keeps its name, because it was
// still that person's pub. An unknown id omits the favourite line or leaves
// only the first night's date.

async function venueName(id: string): Promise<string | null> {
  try {
    const found = await lookupCanonicalVenue(id);
    if (found.status === "found") return found.venue.name;
    if (found.status === "unknown") return (await lookupRetiredIndexedVenue(id))?.venue.name ?? null;
    return null;
  } catch {
    return null;
  }
}

/** Never throws: an unknown id or a failed read is left out of the answer. */
export async function yearShareVenueNames(share: YearShare): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const id of yearShareVenueIds(share)) {
    const name = await venueName(id);
    if (name?.trim()) names[id] = name.trim();
  }
  return names;
}
