// The reader's own pubs, handed back on Tonight.
//
// Tonight answered every reader with the same city: pubs Londoners keep
// recommending, our listings, the cheapest pints. Somebody who had saved five
// pubs from the map met none of them here, so the one list that was theirs sat
// two taps away on the You tab. This shelf reads those saves back where the
// night is planned, the way a music app opens on what you played last.
//
// THE RULES THIS FILE OWNS.
// 1. A PUB IS ONE ROW. A pub filed under three lists is still one pub, so the
//    shelf keeps it once, under the list it was saved to most recently.
// 2. NEWEST FIRST, AND A FEW OF THEM. The shelf is a way back in, not the
//    list: it holds TONIGHT_YOUR_PUBS_LIMIT rows and counts the rest, and the
//    full list stays on the profile.
// 3. NOTHING SAVED, NOTHING SHOWN. An empty read is not a prompt to save: the
//    surface simply is not there, so a stranger's Tonight is unchanged and
//    asks for nothing.
// The rows' names come from the reader's own saves (the account store
// resolves them server-side) or from the map's own venue detail for a save
// that lives on this device. A name that cannot be resolved is left off
// rather than shown as an id (app/tonight/TonightYourPubs.tsx).

import type { Route } from "next";

import { profilePath } from "@/lib/appLink";

export const TONIGHT_YOUR_PUBS_TITLE = "Your pubs";
export const TONIGHT_YOUR_PUBS_LIMIT = 4;
/**
 * How many of this device's saves may be looked up to fill those rows. A save
 * the map no longer names (a closed pub, a retired id) is left off, and the
 * next one takes its row, so the shelf asks for a few more than it shows and
 * never more than this.
 */
export const TONIGHT_YOUR_PUBS_LOOKUP_LIMIT = 8;
export const TONIGHT_YOUR_PUBS_DEVICE_NOTE = "Saved on this device.";

/** One save as either store holds it: a pub, the list it is in, and when. */
export type YourPubSave = {
  venueId: string;
  listType: string;
  savedAt: string;
};

export type YourPubPicks = {
  /** The newest saves, one per pub, at most `limit` of them. */
  picks: YourPubSave[];
  /** How many different pubs are saved in all. */
  total: number;
};

function savedAtMs(save: YourPubSave): number {
  const ms = Date.parse(save.savedAt);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * The shelf's rows: one per pub, kept under its most recent save, newest
 * first. Saves with no venue id are dropped. Pure, so both read paths share it.
 */
export function tonightYourPubPicks(
  saves: readonly YourPubSave[],
  limit: number = TONIGHT_YOUR_PUBS_LIMIT,
): YourPubPicks {
  const newestByVenue = new Map<string, YourPubSave>();
  for (const save of saves) {
    if (!save.venueId) continue;
    const held = newestByVenue.get(save.venueId);
    if (!held || savedAtMs(save) > savedAtMs(held)) newestByVenue.set(save.venueId, save);
  }
  const ordered = [...newestByVenue.values()].sort((a, b) => savedAtMs(b) - savedAtMs(a));
  return { picks: ordered.slice(0, Math.max(0, limit)), total: ordered.length };
}

/**
 * Where the shelf's foot link goes and what it says. The full list lives on
 * the reader's profile; with no handle that is the You tab, which shows this
 * device's saves.
 */
export function tonightYourPubsFoot(
  handle: string | null,
  total: number,
  shown: number,
): { href: Route; label: string } {
  const href = handle ? profilePath(handle) : ("/u/you" as Route);
  return { href, label: total > shown ? `All ${total} saved pubs` : "Your lists" };
}
