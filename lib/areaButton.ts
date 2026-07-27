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
  drinkLensUnknownRowLabel,
  type CategoryPriceIndexStatus,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import {
  getNightAreasForCity,
  isNightAreaRouteReady,
  type NightArea,
} from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";

/** Top of the area's pub list — the ten cheapest, mirroring the plan intake. */
export const AREA_PUB_LIMIT = 10;

/**
 * Radius of the ad-hoc "area" the sheet derives around a locality/borough
 * centroid — the place a map-search result flies to that is NOT one of the
 * modelled Night Areas. A modelled area carries its own `radiusKm`; a plain
 * place does not, so search borrows this tight, walkable ring (~a 15-minute
 * stroll) to gather the pubs the arrival should show.
 */
export const LOCALITY_RADIUS_KM = 1.2;

/** Default camera zoom a modelled-area fly settles on when the option names no
 *  deeper zoom of its own (a locality search result flies a notch deeper). */
export const DEFAULT_AREA_FLY_ZOOM = 14;

/**
 * How long the Area sheet waits after a search-driven fly before it opens, so
 * the pubs appear AS the camera settles rather than mid-flight. Mirrors the
 * cinematic fly duration the canvas uses for an area focus. Reduced-motion
 * jumps the camera instantly, so the sheet opens on the next tick instead.
 */
export const AREA_SHEET_SETTLE_MS = 900;

/** The delay before the Area sheet opens after a search select: the fly's
 *  settle time normally, ~immediate (0) when the camera jumps under
 *  reduced-motion so the pubs never trail an instant camera. */
export function areaSheetOpenDelay(reducedMotion: boolean): number {
  return reducedMotion ? 0 : AREA_SHEET_SETTLE_MS;
}

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
function verifiedPrice(
  venue: Venue,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null,
): number | null {
  const price =
    lensPrices === null
      ? venue.latestContributorPrice ?? venue.cheapestPrice
      : lensPrices.get(venue.id)?.priceGbp ?? null;
  return typeof price === "number" && Number.isFinite(price) && price > 0
    ? price
    : null;
}

function withinRadius(
  centre: { lng: number; lat: number },
  radiusKm: number,
  venue: Venue,
): boolean {
  if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) {
    return false;
  }
  return (
    haversineKm([venue.longitude, venue.latitude], [centre.lng, centre.lat]) <=
    radiusKm
  );
}

export type AreaPubRow = {
  id: string;
  name: string;
  /** Verified price for active drink lens, or null when none is priced yet. */
  price: number | null;
  /** "£5.20" or the honest fail-soft copy — never a fabricated number. */
  priceLabel: string;
  distanceKm: number;
  distanceLabel: string;
};

/**
 * Rank active drink prices inside a ring: priced venues first, cheapest
 * ascending; venues with no verified price follow (nearest to `origin` first)
 * so a thin ring still fills the list honestly rather than hiding pubs. Ties
 * break on name for a stable, deterministic order. Shared by both the modelled
 * area sheet and the ad-hoc locality/borough ring so the two never disagree.
 */
function rankCheapestDrinks(
  centre: { lng: number; lat: number },
  radiusKm: number,
  venues: Venue[],
  origin: [number, number],
  limit: number,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null,
  lensCategoryLabel: string,
  lensStatus: CategoryPriceIndexStatus,
): AreaPubRow[] {
  const ranked = venues
    .filter((venue) => withinRadius(centre, radiusKm, venue))
    .map((venue) => ({
      venue,
      price: verifiedPrice(venue, lensPrices),
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
      price,
      priceLabel:
        price !== null
          ? lensPrices === null
            ? `£${price.toFixed(2)}`
            : `${lensCategoryLabel} · £${price.toFixed(2)}`
          : lensPrices === null
            ? "no priced pints yet"
            : drinkLensUnknownRowLabel(
                lensCategoryLabel.toLowerCase(),
                lensStatus,
              ),
      distanceKm,
      distanceLabel: formatAreaDistance(distanceKm),
    }));
}

/**
 * Modelled area's cheapest drinks, measured from live map centre (or
 * area centre before the map settles) so the distances read honestly.
 */
export function cheapestDrinksInArea(
  area: NightArea,
  venues: Venue[],
  center: [number, number],
  limit: number = AREA_PUB_LIMIT,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null = null,
  lensCategoryLabel: string = "Pint",
  lensStatus: CategoryPriceIndexStatus = "ready",
): AreaPubRow[] {
  const [lng, lat] = center;
  const origin: [number, number] =
    Number.isFinite(lng) && Number.isFinite(lat)
      ? [lng, lat]
      : [area.centre.lng, area.centre.lat];
  return rankCheapestDrinks(
    area.centre,
    area.radiusKm,
    venues,
    origin,
    limit,
    lensPrices,
    lensCategoryLabel,
    lensStatus,
  );
}

/**
 * Cheapest drinks within a walkable ring of an arbitrary place centroid - a
 * locality or borough a map search flew to that is not a modelled Night Area.
 * Distances are measured from the centroid itself (the place the camera lands
 * on). Returns [] when no priced-or-unpriced venue sits inside the ring, which
 * the sheet renders as its honest "no priced pints nearby yet" line.
 */
export function cheapestDrinksNearPoint(
  center: [number, number],
  venues: Venue[],
  radiusKm: number = LOCALITY_RADIUS_KM,
  limit: number = AREA_PUB_LIMIT,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null = null,
  lensCategoryLabel: string = "Pint",
  lensStatus: CategoryPriceIndexStatus = "ready",
): AreaPubRow[] {
  const [lng, lat] = center;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
  return rankCheapestDrinks(
    { lng, lat },
    radiusKm,
    venues,
    center,
    limit,
    lensPrices,
    lensCategoryLabel,
    lensStatus,
  );
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
  /** Optional camera zoom for the fly; undefined lets the map keep its default
   *  area zoom. A locality search result flies a notch deeper than an area. */
  zoom?: number;
  /** What was chosen. A modelled Night Area ("area") opens the sheet as-is; a
   *  "locality"/"borough" opens the ad-hoc radius ring around its centroid.
   *  Undefined (the Area-button "go somewhere else" grid) is always an area. */
  kind?: "area" | "locality" | "borough";
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
    pubs: area ? cheapestDrinksInArea(area, venues, center) : [],
    elsewhere: areaElsewhereOptions(cityId, now),
  };
}

/**
 * What the Area sheet should show when a map-search suggestion is chosen. A
 * modelled Night Area is named by `slug` (the shell resolves it to the curated
 * area, coverage chip and all); a locality/borough carries the centroid + ring
 * the sheet derives its pubs from directly.
 */
export type AreaSheetTarget =
  | { kind: "area"; slug: string; name: string }
  | { kind: "place"; name: string; center: [number, number]; radiusKm: number };

/**
 * The whole search-select journey as one hermetic transition: choosing an area
 * suggestion collapses the search UI, flies the camera, and opens the Area
 * sheet on the chosen target. The React shell is a thin driver over this — it
 * bumps the fly token to `camera`, sets the sheet `target`, and (because
 * `collapseSearch`/`openSheet` are always set) closes the input and opens the
 * sheet as the camera settles. Kept pure so the journey is node-testable.
 */
export type AreaSelectJourney = {
  /** The fly the canvas performs — a modelled area keeps the default zoom, a
   *  locality flies to its own deeper `zoom`. */
  camera: { center: [number, number]; zoom: number };
  /** What the sheet shows on arrival. */
  target: AreaSheetTarget;
  /** Always true: the suggestions panel + input collapse on any select. */
  collapseSearch: true;
  /** Always "area": the pubs display opens once the fly settles. */
  openSheet: "area";
};

export function planAreaSelect(
  option: AreaElsewhereOption,
  radiusKm: number = LOCALITY_RADIUS_KM,
): AreaSelectJourney {
  const kind = option.kind ?? "area";
  const camera = {
    center: option.center,
    zoom: option.zoom ?? DEFAULT_AREA_FLY_ZOOM,
  };
  const target: AreaSheetTarget =
    kind === "area"
      ? { kind: "area", slug: option.slug, name: option.name }
      : { kind: "place", name: option.name, center: option.center, radiusKm };
  return { camera, target, collapseSearch: true, openSheet: "area" };
}
