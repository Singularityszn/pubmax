// Pure derivations behind the map's Area button (the top-bar control that names
// the Night Area under the map centre and opens a sheet of that area's cheapest
// pints + a "go somewhere else" grid).
//
// House pattern (see lib/mapVenueList.ts): all the logic lives here, hermetic
// and node-testable, so the React shell in components/map/AreaButton.tsx is a
// thin render over these models. No fs, no serverEnv, no route imports — safe
// to import on the client and to unit test without a DOM.

import type { CityId } from "@/lib/cities";
import { haversineKm } from "@/lib/haversine";
import {
  getNightAreasForCity,
  isNightAreaRouteReady,
  type NightArea,
} from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";

/** Top of the area's pub list — the ten cheapest, mirroring the plan intake. */
export const AREA_PUB_LIMIT = 10;

/**
 * The Night Area whose region contains the map centre.
 *
 * A Night Area's region is the circle of `radiusKm` around its `centre`. When
 * the centre point sits inside more than one region the nearest area centre
 * wins; when it sits between areas (inside none) we fall back to the nearest
 * area overall, so the label is never blank while panning open country. Invalid
 * coordinates and cities with no modelled areas return null.
 */
export function areaUnderCentre(
  cityId: CityId,
  center: [number, number],
): NightArea | null {
  const [lng, lat] = center;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const areas = getNightAreasForCity(cityId);
  if (areas.length === 0) return null;

  let containing: NightArea | null = null;
  let containingKm = Number.POSITIVE_INFINITY;
  let nearest: NightArea | null = null;
  let nearestKm = Number.POSITIVE_INFINITY;
  for (const area of areas) {
    const km = haversineKm([lng, lat], [area.centre.lng, area.centre.lat]);
    if (km < nearestKm) {
      nearest = area;
      nearestKm = km;
    }
    if (km <= area.radiusKm && km < containingKm) {
      containing = area;
      containingKm = km;
    }
  }
  return containing ?? nearest;
}

/** One-line distance from the map centre, direct register, no fake precision. */
export function formatAreaDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 0.1) return "right here";
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km.toFixed(1)} km away`;
}

/**
 * The price the map's pins already show for a venue: a contributor's verified
 * drop overrides the baseline. Zero / non-finite / null all read as "no price"
 * so the row fails soft rather than inventing a number.
 */
function verifiedPrice(venue: Venue): number | null {
  const price = venue.latestContributorPrice ?? venue.cheapestPrice;
  return typeof price === "number" && Number.isFinite(price) && price > 0
    ? price
    : null;
}

function withinArea(area: NightArea, venue: Venue): boolean {
  if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) {
    return false;
  }
  return (
    haversineKm(
      [venue.longitude, venue.latitude],
      [area.centre.lng, area.centre.lat],
    ) <= area.radiusKm
  );
}

export type AreaPubRow = {
  id: string;
  name: string;
  /** Verified cheapest pint in pounds, or null when none is priced yet. */
  cheapestPrice: number | null;
  /** "£5.20" or the honest fail-soft copy — never a fabricated number. */
  priceLabel: string;
  distanceKm: number;
  distanceLabel: string;
};

/**
 * The area's cheapest pints, ranked. Priced venues come first, cheapest
 * ascending; venues with no verified price follow (nearest to the map centre
 * first) so a thin area still fills the list honestly rather than hiding pubs.
 * Ties break on name for a stable, deterministic order.
 */
export function cheapestPintsInArea(
  area: NightArea,
  venues: Venue[],
  center: [number, number],
  limit: number = AREA_PUB_LIMIT,
): AreaPubRow[] {
  const [lng, lat] = center;
  const origin: [number, number] =
    Number.isFinite(lng) && Number.isFinite(lat)
      ? [lng, lat]
      : [area.centre.lng, area.centre.lat];

  const ranked = venues
    .filter((venue) => withinArea(area, venue))
    .map((venue) => ({
      venue,
      price: verifiedPrice(venue),
      distanceKm: haversineKm([venue.longitude, venue.latitude], origin),
    }))
    .sort((left, right) => {
      if (left.price !== null && right.price !== null) {
        return (
          left.price - right.price ||
          left.venue.name.localeCompare(right.venue.name)
        );
      }
      if (left.price !== null) return -1;
      if (right.price !== null) return 1;
      return (
        left.distanceKm - right.distanceKm ||
        left.venue.name.localeCompare(right.venue.name)
      );
    });

  return ranked
    .slice(0, Math.max(0, limit))
    .map(({ venue, price, distanceKm }) => ({
      id: venue.id,
      name: venue.name,
      cheapestPrice: price,
      priceLabel: price !== null ? `£${price.toFixed(2)}` : "no priced pints yet",
      distanceKm,
      distanceLabel: formatAreaDistance(distanceKm),
    }));
}

export type AreaCoverageTone = "review" | "capture" | "discovery" | "paused";
export type AreaCoverageLabel = { label: string; tone: AreaCoverageTone } | null;

/**
 * The honest evidence label the plan intake shows, condensed to a chip. Route
 * ready areas return null (no warning needed); everything else names the
 * confidence the same way lib/nightAreas coverage + the plan composer do.
 */
export function areaCoverageLabel(
  area: NightArea,
  now: Date = new Date(),
): AreaCoverageLabel {
  if (isNightAreaRouteReady(area, now)) return null;
  switch (area.coverageStatus) {
    case "captured":
      return { label: "Plan with warnings", tone: "capture" };
    case "reviewed":
      return { label: "Plan with warnings", tone: "review" };
    case "discovered":
      return { label: "Low confidence", tone: "discovery" };
    case "paused":
      return { label: "Review expired", tone: "paused" };
    default:
      return { label: "Plan with warnings", tone: "review" };
  }
}

export type AreaElsewhereOption = {
  slug: string;
  name: string;
  /** [lng, lat] the map flies to — GeoJSON order, matching the camera helpers. */
  center: [number, number];
  coverage: AreaCoverageLabel;
};

/** The modelled Night Areas for the city as a compact "go somewhere else" grid. */
export function areaElsewhereOptions(
  cityId: CityId,
  now: Date = new Date(),
): AreaElsewhereOption[] {
  return getNightAreasForCity(cityId).map((area) => ({
    slug: area.slug,
    name: area.name,
    center: [area.centre.lng, area.centre.lat],
    coverage: areaCoverageLabel(area, now),
  }));
}

export type AreaSheetModel = {
  /** Empty when the centre resolved to no area (fail-soft, never "undefined"). */
  areaName: string;
  pubs: AreaPubRow[];
  elsewhere: AreaElsewhereOption[];
};

/** Everything the area sheet renders, derived once and hermetically testable. */
export function buildAreaSheetModel(
  cityId: CityId,
  area: NightArea | null,
  venues: Venue[],
  center: [number, number],
  now: Date = new Date(),
): AreaSheetModel {
  return {
    areaName: area ? area.name : "",
    pubs: area ? cheapestPintsInArea(area, venues, center) : [],
    elsewhere: areaElsewhereOptions(cityId, now),
  };
}
