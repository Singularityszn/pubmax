// Morning brief pint module, derived from the map's Area button logic
// (lib/areaButton cheapestDrinksInArea) so both surfaces rank the same pints the
// same way. /today has no map centre, so we precompute the cheapest priced pints
// for every night patch (plus the central default) on the server and hand the
// client a small bundled index. The client then answers the viewer's resolved
// remembered area from that index, otherwise naming the central default, with
// no request-time work and no full venue set shipped to the browser.
//
// Fail-soft throughout: an area with no verified prices yields no module (never
// an empty box). Pure and node-testable — no fs, no serverEnv, no DOM.

import type { Route } from "next";
import { venueCheapestPintObservedAt } from "@/lib/drinks";
import { areaUnderCentre, cheapestDrinksInArea } from "@/lib/areaButton";
import {
  CENTRAL_PATCH,
  NIGHT_PATCHES,
  resolveNightPatch,
  type RememberedArea,
} from "@/lib/nightPatches";
import { venueAreaClaim, type VenueAreaRelation } from "@/lib/venueTruth";
import type { Venue } from "@/lib/venues";
import { venueMapUrl } from "@/lib/venueMapUrl";

/** The morning brief shows a tight five, not the full area list. */
export const TODAY_PINTS_LIMIT = 5;

/** The patch a locationless viewer sees before any area is remembered. */
export const TODAY_PINTS_DEFAULT_PATCH_ID = CENTRAL_PATCH.id;

type TodayPintRow = {
  id: string;
  name: string;
  /** Verified cheapest pint in pounds — always a real number (priced rows only). */
  price: number;
  /** "£4.80", ready to render. */
  priceLabel: string;
  /** Deep link to the venue on the map ({@link venueMapUrl}). */
  mapHref: Route;
  /**
   * Whether this pub is IN the area the card names, or only near it
   * (lib/venueTruth.ts). The area's radius is how far the list reaches, not a
   * claim about where a pub is: the Three Tuns at the LSE student centre sits
   * 0.87 of the way out of Piccadilly & Soho's disc and was printed as being
   * in Soho.
   */
  areaRelation: VenueAreaRelation;
  /** When this pint was last read at its source. Absent or null when it records none. */
  observedAt?: string | null;
};

export type TodayPintsModule = {
  /** The night patch this module answers for (the index key). */
  patchId: string;
  /** The Night Area the pints actually came from, named for the copy + change link. */
  areaName: string;
  /** Up to five cheapest priced pints, cheapest first. */
  rows: TodayPintRow[];
};

/** Small bundled map keyed by patch id, one entry per patch that has priced pints. */
export type TodayPintsIndex = Record<string, TodayPintsModule>;

/**
 * The cheapest priced pints for the area around a patch centre, or null when
 * that area has no verified prices yet. Priced rows only (the area logic already
 * ranks them first), capped at five. Pure over (patch, venues).
 */
export function buildTodayPintsForPatch(
  patch: { id: string; lat: number; lng: number },
  venues: Venue[],
): TodayPintsModule | null {
  const centre: [number, number] = [patch.lng, patch.lat];
  const area = areaUnderCentre("london", centre);
  if (!area) return null;

  // Distances are never printed here, and the patch centre is a map point, so
  // the rows carry the map origin rather than a claim about any reader.
  const priced = cheapestDrinksInArea(
    area,
    venues,
    { point: centre, origin: "map" },
    venues.length,
  )
    .filter((row) => row.price !== null)
    .slice(0, TODAY_PINTS_LIMIT);
  if (priced.length === 0) return null;

  const byId = new Map(venues.map((venue) => [venue.id, venue]));

  return {
    patchId: patch.id,
    areaName: area.name,
    rows: priced.map((row) => {
      const venue = byId.get(row.id);
      return {
        id: row.id,
        name: row.name,
        price: row.price as number,
        priceLabel: row.priceLabel,
        mapHref: venueMapUrl(row.id),
        areaRelation: venue ? venueAreaClaim(venue, [area]).relation : "unplaced",
        observedAt: venue
          ? venueCheapestPintObservedAt({ cheapestPrice: row.price, prices: venue.prices })
          : null,
      };
    }),
  };
}

/**
 * The card's heading, as strong as the rows under it allow.
 *
 * An area is a centre and a radius, and the radius is how far the list reaches
 * rather than where a pub is (lib/venueTruth.ts). A heading that says "in" over
 * a list where most rows say "just outside" argues with itself, and the list is
 * ranked cheapest-first rather than by distance, so it over-samples the rim.
 * The majority decides the preposition; a tie keeps the stronger word, because
 * half the rows really are in the place the heading names.
 */
export function todayPintsHeading(module: Pick<TodayPintsModule, "areaName" | "rows">): string {
  const outside = module.rows.filter((row) => row.areaRelation !== "inside").length;
  const preposition = outside * 2 > module.rows.length ? "around" : "in";
  return `The cheap ones ${preposition} ${module.areaName}.`;
}

/**
 * Precompute the module for every night patch plus the central default. Areas
 * with no priced pints are simply absent from the index, so a lookup that misses
 * degrades to the central default (or to no module) without inventing a list.
 */
export function buildTodayPintsIndex(venues: Venue[]): TodayPintsIndex {
  const out: TodayPintsIndex = {};
  for (const patch of [...NIGHT_PATCHES, CENTRAL_PATCH]) {
    const built = buildTodayPintsForPatch(patch, venues);
    if (built) out[patch.id] = built;
  }
  return out;
}

/**
 * Which precomputed patch a viewer's remembered area maps to. A remembered patch
 * uses its own id when we modelled priced pints there; a remembered borough or no
 * memory falls back to the central default. Returns null only when even the
 * central default has no priced pints (so the caller renders nothing). Never
 * returns an id absent from the index.
 */
export function resolveTodayPintsPatchId(
  remembered: RememberedArea | null,
  index: TodayPintsIndex,
): string | null {
  if (
    remembered?.kind === "patch" &&
    resolveNightPatch(remembered.id) &&
    index[remembered.id]
  ) {
    return remembered.id;
  }
  return index[TODAY_PINTS_DEFAULT_PATCH_ID] ? TODAY_PINTS_DEFAULT_PATCH_ID : null;
}
