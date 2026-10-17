// The way back to a pub this browser already saved, for a reader returning to
// Tonight. Pure: it reads the saves handed to it and the ids the map can open,
// and decides whether there is one defensible pub to point at.
//
// A save carries only an id, a list label, an optional private note and a date.
// The cue shows none of them: no venue name we would have to look up, no list
// label, no note, no id. It only links to the existing map route for the newest
// save the map can actually open, and says plainly where the saves came from.

import type { Route } from "next";

import type { SavedPub } from "@/lib/savedPubs";
import { venueMapUrl } from "@/lib/venueMapUrl";

export const TONIGHT_RETURN_CUE_TITLE = "Your saved pubs";

/** Where the saves were read from. True for every reader, signed in or not. */
export const TONIGHT_RETURN_CUE_SOURCE_LINE =
  "From saves kept in this browser on this device, not from an account.";

export type TonightReturnCue = {
  href: Route;
  /** Distinct saved pubs the map can open. Never a list or row count. */
  pubCount: number;
};

export function tonightReturnCueLabel(pubCount: number): string {
  return pubCount > 1 ? "Open your latest save on the map" : "Open your saved pub on the map";
}

/**
 * The cue, or null when there is nothing honest to say. Null when the map's
 * openable ids are unknown, because a link we cannot vouch for is worse than
 * no link. A pub saved to several lists counts once, under its newest save.
 */
export function tonightReturnCue(
  saved: readonly SavedPub[],
  selectableVenueIds: ReadonlySet<string> | null | undefined,
): TonightReturnCue | null {
  if (!selectableVenueIds) return null;
  const newestByVenue = new Map<string, string>();
  for (const entry of saved) {
    if (!entry.venueId || !selectableVenueIds.has(entry.venueId)) continue;
    const held = newestByVenue.get(entry.venueId);
    if (held === undefined || entry.savedAt > held) {
      newestByVenue.set(entry.venueId, entry.savedAt);
    }
  }
  let latest: { venueId: string; savedAt: string } | null = null;
  for (const [venueId, savedAt] of newestByVenue) {
    if (!latest || savedAt > latest.savedAt) latest = { venueId, savedAt };
  }
  if (!latest) return null;
  return { href: venueMapUrl(latest.venueId), pubCount: newestByVenue.size };
}
