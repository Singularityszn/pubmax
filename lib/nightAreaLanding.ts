import { formatObservedDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { namedLegacyPintPriceSource } from "@/lib/drinks";
import { haversineKm } from "@/lib/haversine";
import {
  NIGHT_AREAS,
  isNightAreaRouteReady,
  type NightArea,
} from "@/lib/nightAreas";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

export const NIGHT_AREA_LANDING_PUBLICATION_FLOOR = 10;
export const NIGHT_AREA_LANDING_ROW_LIMIT = 10;

export type NightAreaLandingPublisher = {
  label: string;
  url: string;
};

export type NightAreaLandingRow = {
  venueId: string;
  name: string;
  borough: string;
  priceGbp: number;
  pintName: string;
  publisher: NightAreaLandingPublisher;
};

export type NightAreaLandingModel = {
  slug: string;
  name: string;
  description: string;
  totalPricedVenues: number;
  collectedLabel: string;
  rows: NightAreaLandingRow[];
};

export type NightAreaLandingOptions = {
  areas?: readonly NightArea[];
  now?: Date;
  publicationFloor?: number;
  rowLimit?: number;
};

type AssignedVenue = {
  area: NightArea;
  venue: Venue;
};

/** Assign one Venue to the nearest Night Area whose declared radius contains it. */
export function assignVenueToNightArea(
  venue: Pick<Venue, "latitude" | "longitude">,
  areas: readonly NightArea[] = NIGHT_AREAS,
): NightArea | null {
  if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) return null;
  const coordinate: [number, number] = [venue.longitude, venue.latitude];
  return (
    areas
      .map((area) => ({
        area,
        distanceKm: haversineKm(coordinate, [area.centre.lng, area.centre.lat]),
      }))
      .filter(({ area, distanceKm }) => distanceKm <= area.radiusKm)
      .sort(
        (left, right) =>
          left.distanceKm - right.distanceKm ||
          left.area.slug.localeCompare(right.area.slug, "en-GB"),
      )[0]?.area ?? null
  );
}

function exactPublisherBackedRow(venue: Venue): NightAreaLandingRow | null {
  if (!isPubVenueKind(venue.kind)) return null;
  const price = venue.cheapestPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  for (const exact of venue.prices) {
    if (exact.price_gbp !== price) continue;
    const publisher = namedLegacyPintPriceSource(exact);
    if (!publisher) continue;
    return {
      venueId: venue.id,
      name: venue.name,
      borough: venue.primaryBorough,
      priceGbp: price,
      pintName: exact.pint_name.trim() || "Pint",
      publisher,
    };
  }
  return null;
}

function compareRows(left: NightAreaLandingRow, right: NightAreaLandingRow): number {
  return (
    left.priceGbp - right.priceGbp ||
    left.name.localeCompare(right.name, "en-GB") ||
    left.venueId.localeCompare(right.venueId, "en-GB")
  );
}

function modelForArea(
  area: NightArea,
  assigned: readonly AssignedVenue[],
  options: Required<Pick<NightAreaLandingOptions, "now" | "publicationFloor" | "rowLimit">>,
): NightAreaLandingModel | null {
  if (!isNightAreaRouteReady(area, options.now)) return null;
  const eligible = assigned
    .filter((entry) => entry.area.slug === area.slug)
    .flatMap((entry) => {
      const row = exactPublisherBackedRow(entry.venue);
      return row ? [row] : [];
    })
    .sort(compareRows);
  if (eligible.length < options.publicationFloor) return null;
  return {
    slug: area.slug,
    name: area.name,
    description: area.description,
    totalPricedVenues: eligible.length,
    collectedLabel: `Prices last collected ${formatObservedDate(PINT_DATASET_OBSERVED_AT)}.`,
    rows: eligible.slice(0, options.rowLimit),
  };
}

/** Build every publishable Night Area from one unique Venue assignment pass. */
export function buildNightAreaLandingModels(
  venues: readonly Venue[],
  options: NightAreaLandingOptions = {},
): NightAreaLandingModel[] {
  const areas = options.areas ?? NIGHT_AREAS;
  const resolved = {
    now: options.now ?? new Date(),
    publicationFloor: Math.max(
      1,
      options.publicationFloor ?? NIGHT_AREA_LANDING_PUBLICATION_FLOOR,
    ),
    rowLimit: Math.max(1, options.rowLimit ?? NIGHT_AREA_LANDING_ROW_LIMIT),
  };
  const assigned = venues.flatMap((venue): AssignedVenue[] => {
    const area = assignVenueToNightArea(venue, areas);
    return area ? [{ area, venue }] : [];
  });
  return areas.flatMap((area) => {
    const model = modelForArea(area, assigned, resolved);
    return model ? [model] : [];
  });
}

/** Build one governed Night Area page model, or null when it cannot publish. */
export function buildNightAreaLandingModel(
  slug: string,
  venues: readonly Venue[],
  options: NightAreaLandingOptions = {},
): NightAreaLandingModel | null {
  return (
    buildNightAreaLandingModels(venues, options).find((model) => model.slug === slug) ??
    null
  );
}
