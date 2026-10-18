// Names for the saves that live on this device.
//
// A save made without an account is kept in localStorage as a venue id and a
// list (lib/savedPubs.ts). The account store resolves names server-side, but
// the device list has no venue index of its own, so the profile used to print
// the id itself ("venue-s2ppfm") as the pub's name: the one defect a saved list
// may never show, because the list is the reader's own and they know the pub.
//
// Each name is read from the map's own venue detail (lib/warmVenueDetail.ts),
// the session cache the map's sheet opens from, so a tap through to the pub
// lands warm. A pub that has since closed keeps its real name here: it is the
// reader's list, and the venue route answers a retired pub by name for the map
// (lib/prefetchVenue.ts). An id the map cannot name at all reads as
// SAVED_VENUE_FALLBACK_NAME, the label the account store already uses for the
// same case, and never as the id.
//
// The read is bounded twice: at most SAVED_VENUE_NAME_LOOKUP_LIMIT lookups per
// page (the venue route allows 120 a minute per reader, and the map shares
// that), and at most SAVED_VENUE_NAME_CONCURRENCY in flight at once.

import { SAVED_VENUE_FALLBACK_NAME } from "@/lib/savedPubs";
import { warmVenueDetail, type VenueDetailLookupResult } from "@/lib/warmVenueDetail";

export const SAVED_VENUE_NAME_LOOKUP_LIMIT = 24;
export const SAVED_VENUE_NAME_CONCURRENCY = 4;

type Lookup = (venueId: string) => Promise<VenueDetailLookupResult>;

/**
 * Resolve display names for the given venue ids, newest saves first in the
 * order given. Ids past the lookup limit, ids the map cannot name, and a read
 * cut short by `signal` all answer the fallback label.
 */
export async function resolveSavedVenueNames(
  venueIds: readonly string[],
  {
    signal,
    lookup = warmVenueDetail,
    limit = SAVED_VENUE_NAME_LOOKUP_LIMIT,
    concurrency = SAVED_VENUE_NAME_CONCURRENCY,
  }: { signal?: AbortSignal; lookup?: Lookup; limit?: number; concurrency?: number } = {},
): Promise<Map<string, string>> {
  const unique = [...new Set(venueIds.filter(Boolean))];
  const names = new Map<string, string>(unique.map((id) => [id, SAVED_VENUE_FALLBACK_NAME]));
  const queue = unique.slice(0, Math.max(0, limit));
  let next = 0;
  async function worker(): Promise<void> {
    while (next < queue.length && !signal?.aborted) {
      const id = queue[next++]!;
      const result = await lookup(id);
      if (result.status === "found" && result.venue.name.trim()) names.set(id, result.venue.name);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return names;
}
