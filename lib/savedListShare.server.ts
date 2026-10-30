import "server-only";

// The one read behind a shared saved list: the page at
// /u/[handle]/lists/[listType], its metadata and its opengraph-image all ask
// here, so the page and the card it previews cannot disagree about whether the
// list may be shown or what is on it.
//
// PUBLIC LISTS ONLY. A private account's list answers `hidden`, and every
// caller turns that into the existing not-found, so a stranger cannot learn
// from the card what the page would refuse them. Ownership and mates do not
// open it here: a share card is read by a crawler with no session, and the
// owner reads their own lists on their own profile.

import { isKnownTestHandle } from "@/lib/accountPublicAccess.server";
import { accountIsPrivate } from "@/lib/accountVisibility";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";
import { cleanListType, savedPubsStore, type SavedPubDTO } from "@/lib/savedPubsStore";
import type { VenueKind } from "@/lib/venues";

/** How many pubs the share card names. */
export const SAVED_LIST_CARD_PUBS = 5;

export type SavedListCardPub = {
  venueId: string;
  name: string;
  /** The same cheapest listed figure the map's plaque prints, or null. */
  priceGbp: number | null;
  kind: VenueKind | undefined;
};

export type PublicSavedListRead =
  | { status: "invalid"; ownerHandle: string; listType: string }
  | { status: "hidden" }
  | { status: "ok"; ownerHandle: string; listType: string; venues: SavedPubDTO[] };

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export type SavedListShareDependencies = {
  isPrivateOwner: (handle: string) => Promise<boolean>;
  listSaved: (handle: string) => Promise<SavedPubDTO[]>;
};

const defaultDependencies: SavedListShareDependencies = {
  async isPrivateOwner(handle) {
    const profile = await profileStore().getByHandle(handle);
    return accountIsPrivate(profile?.visibility);
  },
  listSaved: (handle) => savedPubsStore().listSaved({ handle }),
};

/** Resolve the route params to a list a stranger may see, or why not. */
export async function readPublicSavedList(
  rawHandle: string,
  rawListType: string,
  dependencies: SavedListShareDependencies = defaultDependencies,
): Promise<PublicSavedListRead> {
  const ownerHandle = normalizeHandle(rawHandle);
  if (isKnownTestHandle(ownerHandle)) return { status: "hidden" };
  const listType = cleanListType(decodeParam(rawListType)) ?? "";
  if (!ownerHandle || !listType) return { status: "invalid", ownerHandle, listType };
  if (await dependencies.isPrivateOwner(ownerHandle)) return { status: "hidden" };
  const saved = await dependencies.listSaved(ownerHandle);
  return {
    status: "ok",
    ownerHandle,
    listType,
    venues: saved.filter((venue) => venue.listType === listType),
  };
}

/**
 * The first pubs of a list with the plaque figure the map prints. A venue the
 * index cannot find keeps its saved name and no price: a card never invents a
 * figure, and an empty plaque says nothing rather than something wrong.
 */
export async function savedListCardPubs(
  venues: readonly SavedPubDTO[],
  limit = SAVED_LIST_CARD_PUBS,
): Promise<SavedListCardPub[]> {
  return Promise.all(
    venues.slice(0, limit).map(async (venue) => {
      try {
        const lookup = await lookupCanonicalVenue(venue.venueId);
        if (lookup.status === "found") {
          const price = lookup.slimVenue.cheapestPrice;
          return {
            venueId: venue.venueId,
            name: lookup.slimVenue.name || venue.venueName,
            priceGbp: typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null,
            kind: lookup.slimVenue.kind,
          };
        }
      } catch {
        // An index that cannot be read is no price, never a failed card.
      }
      return { venueId: venue.venueId, name: venue.venueName, priceGbp: null, kind: undefined };
    }),
  );
}

export type SavedListCoverRead = {
  venueName: string;
  /** The venue's own photo, drawn through the existing venue image path, or "". */
  imageUrl: string;
  kind: VenueKind | undefined;
};

/**
 * The first pub's photo for the list's head, from the same venue record the
 * pub page draws its picture from. No photo is an honest answer: the head
 * then paints the placeholder tinted by the pub's kind.
 */
export async function savedListCover(
  venues: readonly SavedPubDTO[],
): Promise<SavedListCoverRead | null> {
  const first = venues[0];
  if (!first) return null;
  try {
    const read = await lookupVenueDetail(first.venueId);
    if (read.status === "found") {
      return {
        venueName: read.venue.name || first.venueName,
        imageUrl: read.venue.imageUrl ?? "",
        kind: read.venue.kind,
      };
    }
  } catch {
    // An unreadable detail is no photo, never a failed page.
  }
  return { venueName: first.venueName, imageUrl: "", kind: undefined };
}
