import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { copyFactsForVenue, validateVenueRecordCopy } from "@/lib/venueRecordCopy";
import type { Venue } from "@/lib/venues";

let cachedEntries: Record<string, unknown> | undefined;

/** Selected-pub detail only. A missing pack or changed supporting fact shows no copy. */
export async function enrichVenueWithRecordCopy(venue: Venue): Promise<Venue> {
  try {
    if (!cachedEntries) {
      const pack = JSON.parse(await readFile(path.join(process.cwd(), "data/venue_copy/london.json"), "utf8"));
      if (pack.version !== 2 || pack.model !== "gemini-2.5-flash-lite" ||
          !pack.venues || typeof pack.venues !== "object" || Array.isArray(pack.venues)) return venue;
      cachedEntries = pack.venues;
    }
    const recordCopy = validateVenueRecordCopy(copyFactsForVenue(venue), cachedEntries?.[venue.id]);
    return recordCopy ? { ...venue, recordCopy } : venue;
  } catch {
    return venue;
  }
}
