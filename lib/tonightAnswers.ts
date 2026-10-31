// The three answers /tonight opens with (design V1, 30 Oct 2026): the cheapest
// pint near the reader, one thing on tonight, and the last train. PURE: the
// client hands in what it already read and gets back what a card may say.
//
// The "On tonight" card is a CONFIRMED listing or nothing. When the what's-on
// read has no listing to show, the card hands over to the regular-nights block
// (lib/regularNights.ts), which carries its own label and its own read date and
// never borrows the word "tonight's listing".

import { haversineKm } from "@/lib/haversine";
import { WALKABLE_RADIUS_KM } from "@/lib/nearMeAnswer";
import { walkMinutes } from "@/lib/tonight";
import type { TonightCheapPint } from "@/lib/tonightCheapPints";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";
import type { WhatsOnRow } from "@/lib/whatsOn";

type Coord = { lat: number; lng: number };

/** What the "Cheapest near you" card prints. */
export type TonightCheapestAnswer = {
  venueId: string;
  name: string;
  priceGbp: number;
  /** When that price was read at its source; null when the record names no day. */
  observedAt: string | null;
  /** "~6 min walk", "Around Soho" or the borough. */
  placeLine: string;
  /** How the pub was chosen, so the card never claims "near you" it cannot back. */
  basis: "walk" | "area" | "city";
};

/** The fields a slim venue carries that the pick reads. */
export type TonightCheapestCandidate = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  priceObservedAt?: string;
  kind?: VenueKind;
  retired?: true;
};

/**
 * The cheapest listed pint within a walk of `near`, cheaper first and nearer
 * on a tie. Null when no priced pub is within the walk. Pubs only: a hotel bar
 * or a members' club is never "the cheapest pint near you".
 */
export function cheapestPintNear(
  venues: readonly TonightCheapestCandidate[],
  near: Coord,
  radiusKm: number = WALKABLE_RADIUS_KM,
): { venue: TonightCheapestCandidate; km: number } | null {
  let best: { venue: TonightCheapestCandidate; km: number } | null = null;
  for (const venue of venues) {
    if (venue.retired || typeof venue.cheapestPrice !== "number") continue;
    if (!Number.isFinite(venue.cheapestPrice) || venue.cheapestPrice <= 0) continue;
    if (!isPublicRankablePub(venue)) continue;
    const km = haversineKm([near.lng, near.lat], [venue.lng, venue.lat]);
    if (!Number.isFinite(km) || km > radiusKm) continue;
    if (
      best === null ||
      venue.cheapestPrice < (best.venue.cheapestPrice as number) ||
      (venue.cheapestPrice === best.venue.cheapestPrice && km < best.km)
    ) {
      best = { venue, km };
    }
  }
  return best;
}

/**
 * One answer for the card, in order of what we can back: a pub within a walk
 * of the reader's own position, else the cheapest around the area they chose,
 * else the city's cheapest listed pint.
 */
export function tonightCheapestAnswer(input: {
  origin: Coord | null;
  patch: { label: string; near: Coord } | null;
  nearby: readonly TonightCheapestCandidate[];
  cityRows: readonly TonightCheapPint[];
}): TonightCheapestAnswer | null {
  const { origin, patch, nearby, cityRows } = input;
  if (origin) {
    const pick = cheapestPintNear(nearby, origin);
    if (pick) {
      const minutes = walkMinutes(origin, { lat: pick.venue.lat, lng: pick.venue.lng });
      return {
        venueId: pick.venue.id,
        name: pick.venue.name,
        priceGbp: pick.venue.cheapestPrice as number,
        observedAt: pick.venue.priceObservedAt ?? null,
        placeLine: minutes === null ? "Within a walk" : `~${minutes} min walk`,
        basis: "walk",
      };
    }
  } else if (patch) {
    const pick = cheapestPintNear(nearby, patch.near);
    if (pick) {
      return {
        venueId: pick.venue.id,
        name: pick.venue.name,
        priceGbp: pick.venue.cheapestPrice as number,
        observedAt: pick.venue.priceObservedAt ?? null,
        placeLine: `Around ${patch.label}`,
        basis: "area",
      };
    }
  }
  const city = cityRows[0];
  if (!city) return null;
  return {
    venueId: city.venueId,
    name: city.name,
    priceGbp: city.priceGbp,
    observedAt: city.observedAt ?? null,
    placeLine: city.borough,
    basis: "city",
  };
}

/** The card's heading, as strong as the basis allows. */
export function tonightCheapestHeading(basis: TonightCheapestAnswer["basis"]): string {
  if (basis === "walk") return "Cheapest near you";
  if (basis === "area") return "Cheapest around here";
  return "Cheapest in London";
}

/**
 * The one confirmed listing the "On tonight" card leads with: the first row
 * of the ordered list that is a night out rather than a drinks offer, else the
 * first row. Null when the read holds no listing at all.
 */
export function tonightOnTonightListing(rows: readonly WhatsOnRow[]): WhatsOnRow | null {
  return rows.find((row) => row.kind !== "deal") ?? rows[0] ?? null;
}
