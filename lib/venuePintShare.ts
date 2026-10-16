// A pub's own listed pint, as a share (lib/pintShare.ts owns the rules).
//
// ONE READING for the sheet and for the card: `resolveNearPriceTrust` finds the
// row carrying the pub's exact cheapest figure and names its publisher and its
// own read, the same reading the /near answer makes. The venue sheet asks it on
// the client and the pint card route asks it on the server, so the figure a
// reader shares and the figure the preview draws are one figure.
//
// Kept apart from lib/pintShare.ts because the price-row reading pulls the
// drinks vocabulary behind it, and the share button needs none of that.

import type { NearMeCard } from "@/lib/nearMeAnswer";
import {
  resolveNearPriceTrust,
  type NearPriceTrustResponse,
  type NearPriceTrustVenue,
} from "@/lib/nearPriceTrust";
import { pintShareFrom, type PintShare } from "@/lib/pintShare";
import { priceBand, type PriceBandArea } from "@/lib/priceBand";
import type { PriceStanding } from "@/lib/priceTier";
import { venueAreaLabel, type VenueAreaSource } from "@/lib/venueDisplay";

export type PintShareVenue = NearPriceTrustVenue & VenueAreaSource & { name: string };

/** The pub's listed pint with its source and day, or null when any is missing. */
export function venuePintShare(venue: PintShareVenue): PintShare | null {
  const evidence = resolveNearPriceTrust(venue);
  if (!evidence) return null;
  return pintShareFrom({
    venueId: venue.id,
    name: venue.name,
    area: venueAreaLabel(venue),
    priceGbp: evidence.price,
    publisher: evidence.publisher,
    observedAt: evidence.observedAt,
  });
}

/**
 * The pub sheet's share: only a CHEAP pint (its price band) LISTED by a named
 * publisher (its standing) on a known day, and only when the figure the share
 * carries is the figure the sheet's baseline block prints. Anything less and
 * the block offers no share.
 */
export function listedCheapPintShare(
  venue: PintShareVenue,
  lane: { standing: PriceStanding; cheapestPrice: number },
  bandArea: PriceBandArea,
): PintShare | null {
  if (lane.standing !== "listed") return null;
  if (priceBand(lane.cheapestPrice, bandArea) !== "cheap") return null;
  const share = venuePintShare(venue);
  return share && share.priceGbp === lane.cheapestPrice ? share : null;
}

/**
 * The /near top answer's pint, as a share, when the trust read names the
 * publisher and the read day of its exact figure. Null while that read is
 * loading or when it says neither, and then no share is offered.
 */
export function nearTopPintShare(
  cards: readonly Pick<NearMeCard, "id" | "name" | "borough" | "cheapestPrice">[],
  priceTrust: "loading" | NearPriceTrustResponse | undefined,
): PintShare | null {
  const top = cards[0];
  if (!top || !priceTrust || priceTrust === "loading") return null;
  const match = priceTrust.results.find(
    (item) => item.venueId === top.id && item.price === top.cheapestPrice,
  );
  if (!match) return null;
  return pintShareFrom({
    venueId: top.id,
    name: top.name,
    area: top.borough,
    priceGbp: match.price,
    publisher: match.publisher,
    observedAt: match.observedAt,
  });
}
