// Observed soft-drink (and any drink) subtype prices: classify labels, rank
// venues, and never invent a figure the data cannot back.
//
// Pure + browser-safe. Community rows stay category-wide; only menu text and
// attributed drink-price updates can name a subtype.

import type { Route } from "next";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import {
  drinkSubtypeFamilyParentId,
  drinkSubtypeFromText,
  drinkSubtypeMembers,
  findSubtype,
  subtypesForCategory,
  type DrinkSubtype,
} from "@/lib/drinkSubtypes";
import { legacyPintPriceObservedAt, namedLegacyPintPriceSource } from "@/lib/drinks";
import type { PricedLandingPublisher } from "@/lib/pricedLanding";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { venueGroupingKey, type Venue, type VenuePrice } from "@/lib/venues";

const SOFT_DRINK_ZERO_SUGAR_COLA_FAMILY_ID = "soft-drink-zero-sugar-cola";

/** Launch chips for the Soft drinks and water view; generic component accepts any subtype. */
export const SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS = [
  SOFT_DRINK_ZERO_SUGAR_COLA_FAMILY_ID,
  "soft-drink-still-water",
] as const;

/** Subtype lens after folding legacy zero-sugar cola leaf ?sub= values to the family chip. */
export function softDrinksWaterSubtypeIdFromParam(sub?: string | null): string {
  const hit = findSubtype(sub?.trim());
  if (!hit || hit.category !== "soft-drink") {
    return SOFT_DRINK_ZERO_SUGAR_COLA_FAMILY_ID;
  }
  return drinkSubtypeFamilyParentId(hit.id) ?? hit.id;
}

/** When set, replace the URL to this subtype id (legacy leaf links). */
export function softDrinksWaterLegacyLeafRedirectSubtypeId(
  sub?: string | null,
): string | null {
  const trimmed = sub?.trim();
  if (!trimmed) return null;
  const hit = findSubtype(trimmed);
  if (!hit || hit.category !== "soft-drink") return null;
  const parent = drinkSubtypeFamilyParentId(hit.id);
  if (!parent) return null;
  return parent;
}

/** Chip order for the soft-drinks view; leaf cola brands stay classifiable but not chip-visible. */
export function softDrinksWaterChipSubtypes(
  launchSubtypeIds: readonly string[] = SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS,
): readonly DrinkSubtype[] {
  const launch = launchSubtypeIds
    .map((id) => findSubtype(id))
    .filter((hit): hit is DrinkSubtype => hit !== null);
  const rest = subtypesForCategory("soft-drink").filter(
    (subtype) =>
      !launchSubtypeIds.includes(subtype.id) && !drinkSubtypeFamilyParentId(subtype.id),
  );
  return [...launch, ...rest];
}

/** True when this chip should appear selected for the active subtype lens. */
export function softDrinksWaterChipSelected(
  chipSubtypeId: string,
  activeSubtypeId: string,
): boolean {
  if (chipSubtypeId === activeSubtypeId) return true;
  return drinkSubtypeFamilyParentId(activeSubtypeId) === chipSubtypeId;
}

export type ObservedSubtypePrice = {
  drinkLabel: string;
  priceGbp: number;
  /** ISO-8601 observation day or instant from the lane that produced the row, empty when it states no read. */
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
  return {
    drinkLabel: price.pint_name,
    priceGbp: price.price_gbp,
    observedAt: legacyPintPriceObservedAt(price) ?? "",
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
  const members = drinkSubtypeMembers(subtype);

  const candidates: ObservedSubtypePrice[] = [];
  for (const price of venue.prices) {
    for (const member of members) {
      const hit = observedFromVenuePrice(price, member);
      if (hit) candidates.push(hit);
    }
  }
  const venueKey = venueDrinkUpdateKey(venue);
  if (venueKey) {
    for (const update of drinkUpdates) {
      if (update.venueKey !== venueKey) continue;
      for (const member of members) {
        const hit = observedFromDrinkUpdate(update, member);
        if (hit) candidates.push(hit);
      }
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

function compareSubtypePricedVenueRows(
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
}): Route {
  const params = new URLSearchParams();
  params.set("drink", "soft-drink");
  params.set("sub", input.subtypeId);
  if (input.venueId) params.set("sel", input.venueId);
  if (input.log) params.set("log", "1");
  return `/map?${params.toString()}`;
}
