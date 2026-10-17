// The way back to a pub this browser already saved, for a reader returning to
// Tonight. Pure: it reads the saves handed to it and the ids the map can open,
// and decides whether there is one defensible pub to point at.
//
// A save carries only an id, a list label, an optional private note and a date.
// The cue shows none of them: no venue name we would have to look up, no list
// label, no note, no id. It only links to the existing map route for the newest
// save the map can actually open, and says plainly where the saves came from.

import type { Route } from "next";

import { isListType } from "@/lib/savedPubs";
import { venueMapUrl } from "@/lib/venueMapUrl";

export const TONIGHT_RETURN_CUE_TITLE = "Your saved pubs";

export const TONIGHT_RETURN_CUE_LABEL = "Open your saved pub on the map";

/** Where the saves were read from. True for every reader, signed in or not. */
export const TONIGHT_RETURN_CUE_SOURCE_LINE =
  "From saves kept in this browser on this device, not from an account.";

export type TonightReturnCue = {
  href: Route;
};

/**
 * The cue, or null when there is nothing honest to say. Null when the map's
 * openable ids are unknown, because a link we cannot vouch for is worse than
 * no link.
 */
export function tonightReturnCue(
  records: unknown,
  selectableVenueIds: ReadonlySet<string> | null | undefined,
): TonightReturnCue | null {
  if (!selectableVenueIds || !Array.isArray(records)) return null;
  let latest: { venueId: string; savedAt: number } | null = null;
  for (const record of records) {
    if (!record || typeof record !== "object") return null;
    const { venueId, listType, savedAt } = record as Record<string, unknown>;
    if (typeof venueId !== "string" || !venueId || !isListType(listType)) return null;
    const at = typeof savedAt === "string" ? Date.parse(savedAt) : Number.NaN;
    if (Number.isNaN(at)) return null;
    if (selectableVenueIds.has(venueId) && (!latest || at > latest.savedAt)) {
      latest = { venueId, savedAt: at };
    }
  }
  return latest ? { href: venueMapUrl(latest.venueId) } : null;
}
