import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { haversineKm } from "@/lib/haversine";
import {
  NIGHT_AREAS,
  isNightAreaRouteReady,
  type NightArea,
  type NightAreaSlug,
} from "@/lib/nightAreas";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue, VenuePrice } from "@/lib/venues";

export const NIGHT_AREA_LANDING_PRICE_FLOOR = 10;

export type NightAreaPricePublisher = {
  name: "Pint Prices";
  url: string;
};

export type NightAreaLandingPrice = {
  rank: number;
  venueId: string;
  venueName: string;
  pintName: string;
  priceGbp: number;
  publisher: NightAreaPricePublisher | null;
};

export type NightAreaLanding = {
  slug: NightAreaSlug;
  name: string;
  description: string;
  transportAnchors: string[];
  pricedPubCount: number;
  collectedAt: string;
  prices: NightAreaLandingPrice[];
};

function validVenuePoint(venue: Venue): boolean {
  return Number.isFinite(venue.latitude) && Number.isFinite(venue.longitude);
}

/** Assign one Venue to its nearest containing area across the supplied catalogue. */
export function assignVenueToNightArea(
  venue: Venue,
  areas: readonly NightArea[] = NIGHT_AREAS,
): NightArea | null {
  if (!validVenuePoint(venue)) return null;
  return areas
    .map((area) => ({
      area,
      distanceKm: haversineKm(
        [venue.longitude, venue.latitude],
        [area.centre.lng, area.centre.lat],
      ),
    }))
    .filter(({ area, distanceKm }) => distanceKm <= area.radiusKm)
    .sort((left, right) =>
      left.distanceKm - right.distanceKm || left.area.slug.localeCompare(right.area.slug))
    [0]?.area ?? null;
}

/** Publisher comes only from the exact price row that owns the displayed figure. */
export function nightAreaPricePublisher(row: VenuePrice): NightAreaPricePublisher | null {
  if (typeof row.pub_url !== "string") return null;
  try {
    const url = new URL(row.pub_url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLocaleLowerCase();
    if (host !== "pint-prices.com" && host !== "www.pint-prices.com") return null;
    return { name: "Pint Prices", url: url.toString() };
  } catch {
    return null;
  }
}

function exactCheapestPriceRow(venue: Venue): VenuePrice | null {
  if (typeof venue.cheapestPrice !== "number" || !Number.isFinite(venue.cheapestPrice)) return null;
  return venue.prices
    .filter((row) => row.price_gbp === venue.cheapestPrice)
    .slice()
    .sort((left, right) =>
      left.app_price_id.localeCompare(right.app_price_id)
      || left.pint_name.localeCompare(right.pint_name))
    [0] ?? null;
}

function assignedPriceRows(
  area: NightArea,
  venues: readonly Venue[],
  areas: readonly NightArea[],
): Omit<NightAreaLandingPrice, "rank">[] {
  return venues.flatMap((venue) => {
    if (!isPubVenueKind(venue.kind)) return [];
    if (assignVenueToNightArea(venue, areas)?.slug !== area.slug) return [];
    const priceRow = exactCheapestPriceRow(venue);
    if (!priceRow || typeof priceRow.price_gbp !== "number" || priceRow.price_gbp <= 0) return [];
    return [{
      venueId: venue.id,
      venueName: venue.name,
      pintName: priceRow.pint_name,
      priceGbp: priceRow.price_gbp,
      publisher: nightAreaPricePublisher(priceRow),
    }];
  }).sort((left, right) =>
    left.priceGbp - right.priceGbp
    || left.venueName.localeCompare(right.venueName)
    || left.venueId.localeCompare(right.venueId));
}

export function buildNightAreaLanding(
  area: NightArea,
  venues: readonly Venue[],
  areas: readonly NightArea[] = NIGHT_AREAS,
  now = new Date(),
): NightAreaLanding | null {
  if (!isNightAreaRouteReady(area, now)) return null;
  const ranked = assignedPriceRows(area, venues, areas);
  if (ranked.length < NIGHT_AREA_LANDING_PRICE_FLOOR) return null;
  return {
    slug: area.slug,
    name: area.name,
    description: area.description,
    transportAnchors: [...area.transportAnchors],
    pricedPubCount: ranked.length,
    collectedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
    prices: ranked.map((row, index) => ({ ...row, rank: index + 1 })),
  };
}

export function listNightAreaLandings(
  venues: readonly Venue[],
  areas: readonly NightArea[] = NIGHT_AREAS,
  now = new Date(),
): NightAreaLanding[] {
  return areas.flatMap((area) => {
    const landing = buildNightAreaLanding(area, venues, areas, now);
    return landing ? [landing] : [];
  });
}
