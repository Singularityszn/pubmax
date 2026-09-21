// Observed soft-drink (and any drink) subtype prices: classify labels, rank
// venues, and never invent a figure the data cannot back.
//
// Pure + browser-safe. Community rows stay category-wide; only menu text and
// attributed drink-price updates can name a subtype.

import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { drinkSubtypeFromText, findSubtype, type DrinkSubtype } from "@/lib/drinkSubtypes";
import { namedLegacyPintPriceSource } from "@/lib/drinks";
import type { PricedLandingPublisher } from "@/lib/pricedLanding";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { venueGroupingKey, type Venue, type VenuePrice } from "@/lib/venues";

/** Launch chips for the Soft drinks and water view; generic component accepts any subtype. */
export const SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS = [
  "soft-drink-coke-zero",
  "soft-drink-diet-coke",
  "soft-drink-still-water",
] as const;

export type SoftDrinksWaterLaunchSubtypeId =
  (typeof SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS)[number];

export type ObservedSubtypePrice = {
  drinkLabel: string;
  priceGbp: number;
  /** ISO-8601 observation day or instant from the lane that produced the row. */
  observedAt: string;
  publisher: PricedLandingPublisher | null;
  /** Which lane carried this row, for tests and debugging only. */
  lane: "venue-price" | "drink-price-update";
};

export type SubtypePricedVenueRow = {
  venueId: string;
  venueName: string;
  borough: string;
  latitude: number;
  longitude: number;
  observed: ObservedSubtypePrice | null;
};

export function drinkLabelMatchesSubtype(
  drinkLabel: string,
  subtype: DrinkSubtype,
): boolean {
  const hit = drinkSubtypeFromText(drinkLabel, subtype.category);
  return hit?.id === subtype.id;
}

function publisherFromDrinkUpdate(update: DrinkPriceUpdate): PricedLandingPublisher {
  return {
    label: update.source.label,
    url: update.source.url,
  };
}

function observedFromVenuePrice(
  price: VenuePrice,
  subtype: DrinkSubtype,
): ObservedSubtypePrice | null {
  if (typeof price.price_gbp !== "number" || !Number.isFinite(price.price_gbp) || price.price_gbp <= 0) {
    return null;
  }
  if (!drinkLabelMatchesSubtype(price.pint_name, subtype)) return null;
  const observedAt = PINT_DATASET_OBSERVED_AT.toISOString();
  return {
    drinkLabel: price.pint_name,
    priceGbp: price.price_gbp,
    observedAt,
    publisher: namedLegacyPintPriceSource(price),
    lane: "venue-price",
  };
}

function observedFromDrinkUpdate(
  update: DrinkPriceUpdate,
  subtype: DrinkSubtype,
): ObservedSubtypePrice | null {
  if (update.category !== subtype.category) return null;
  if (!drinkLabelMatchesSubtype(update.drinkName, subtype)) return null;
  if (!Number.isFinite(update.priceGbp) || update.priceGbp <= 0) return null;
  return {
    drinkLabel: update.drinkName,
    priceGbp: update.priceGbp,
    observedAt: update.observedAt,
    publisher: publisherFromDrinkUpdate(update),
    lane: "drink-price-update",
  };
}

/** Cheapest matching observation for one venue, or null when none exists. */
function venueDrinkUpdateKey(venue: Venue): string | null {
  const lead = venue.prices[0];
  if (!lead) return null;
  return venueGroupingKey(lead);
}

export function selectObservedSubtypePriceForVenue(
  venue: Venue,
  subtypeId: string,
  drinkUpdates: readonly DrinkPriceUpdate[] = [],
): ObservedSubtypePrice | null {
  const subtype = findSubtype(subtypeId);
  if (!subtype) return null;

  const candidates: ObservedSubtypePrice[] = [];
  for (const price of venue.prices) {
    const hit = observedFromVenuePrice(price, subtype);
    if (hit) candidates.push(hit);
  }
  const venueKey = venueDrinkUpdateKey(venue);
  if (venueKey) {
    for (const update of drinkUpdates) {
      if (update.venueKey !== venueKey) continue;
      const hit = observedFromDrinkUpdate(update, subtype);
      if (hit) candidates.push(hit);
    }
  }

  if (candidates.length === 0) return null;
  return candidates.sort(compareObservedSubtypePrices)[0] ?? null;
}

function compareObservedSubtypePrices(
  left: ObservedSubtypePrice,
  right: ObservedSubtypePrice,
): number {
  return (
    left.priceGbp - right.priceGbp ||
    Date.parse(right.observedAt || "0") - Date.parse(left.observedAt || "0") ||
    left.drinkLabel.localeCompare(right.drinkLabel)
  );
}

export function compareSubtypePricedVenueRows(
  left: SubtypePricedVenueRow,
  right: SubtypePricedVenueRow,
): number {
  const leftPrice = left.observed?.priceGbp ?? Number.POSITIVE_INFINITY;
  const rightPrice = right.observed?.priceGbp ?? Number.POSITIVE_INFINITY;
  if (leftPrice !== rightPrice) return leftPrice - rightPrice;
  if (left.observed && right.observed) {
    const dateCmp =
      Date.parse(right.observed.observedAt || "0") -
      Date.parse(left.observed.observedAt || "0");
    if (dateCmp !== 0) return dateCmp;
  }
  if (left.observed && !right.observed) return -1;
  if (!left.observed && right.observed) return 1;
  return left.venueName.localeCompare(right.venueName) || left.venueId.localeCompare(right.venueId);
}

export function buildSubtypePricedVenueRows(
  venues: readonly Venue[],
  subtypeId: string,
  drinkUpdates: readonly DrinkPriceUpdate[] = [],
  limit = 200,
): SubtypePricedVenueRow[] {
  const subtype = findSubtype(subtypeId);
  if (!subtype) return [];

  const rows: SubtypePricedVenueRow[] = [];
  for (const venue of venues) {
    if (!isPubVenueKind(venue.kind)) continue;
    const observed = selectObservedSubtypePriceForVenue(venue, subtypeId, drinkUpdates);
    rows.push({
      venueId: venue.id,
      venueName: venue.name,
      borough: venue.primaryBorough,
      latitude: venue.latitude,
      longitude: venue.longitude,
      observed,
    });
  }

  return rows.sort(compareSubtypePricedVenueRows).slice(0, limit);
}

export function countObservedSubtypePrices(
  venues: readonly Venue[],
  subtypeId: string,
  drinkUpdates: readonly DrinkPriceUpdate[] = [],
): number {
  let count = 0;
  for (const venue of venues) {
    if (!isPubVenueKind(venue.kind)) continue;
    if (selectObservedSubtypePriceForVenue(venue, subtypeId, drinkUpdates)) count += 1;
  }
  return count;
}

export function drinkSubtypePricedMapHref(input: {
  subtypeId: string;
  venueId?: string | null;
  log?: boolean;
}): string {
  const params = new URLSearchParams();
  params.set("drink", "soft-drink");
  params.set("sub", input.subtypeId);
  if (input.venueId) params.set("sel", input.venueId);
  if (input.log) params.set("log", "1");
  return `/map?${params.toString()}`;
}
