import type { SlimVenue } from "@/lib/venuesSlim";
import { groundOffsetPx, MAP_OPENING_PREVIEW_CAMERA, projectAtCamera } from "@/lib/mapOpeningPreview";
import { pubsToGeoJSON } from "@/components/map/canvas/geojson";
import { slimVenuesToPins } from "@/lib/slimPins";
import { defaultVenueKindVisibility, filterVenuesByKind, isPubVenue } from "@/lib/venueKindFilters";

export type OpeningPricedVenue = {
  id: string;
  name: string;
  figure: string;
  x: number;
  y: number;
  aging: boolean;
  priority: number;
};

export function openingPricedVenues(rows: readonly SlimVenue[]): OpeningPricedVenue[] {
  const venues = filterVenuesByKind(
    slimVenuesToPins([...rows]),
    defaultVenueKindVisibility(),
  ).filter(isPubVenue);
  const features = pubsToGeoJSON(venues, new Map(), null).features;
  const candidates = features.flatMap((feature) => {
    const properties = feature.properties;
    if (!properties || typeof properties.id !== "string" || !properties.id ||
      typeof properties.name !== "string" || !properties.name ||
      typeof properties.clusterPrice !== "number" || typeof properties.priceLabel !== "string") return [];
    const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
    if (typeof lng !== "number" || !Number.isFinite(lng) || typeof lat !== "number" || !Number.isFinite(lat)) return [];
    const { x, y } = groundOffsetPx(lng, lat, MAP_OPENING_PREVIEW_CAMERA);
    const story = properties.story === true;
    const priority = story ? 1 : typeof properties.bucket === "number" && properties.bucket < 3 ? 2 : 3;
    return [{
      id: String(properties.id),
      name: String(properties.name),
      figure: properties.priceLabel,
      x, y,
      lng, lat,
      aging: properties.aging === true,
      priority,
    }];
  }).sort((a, b) => a.priority - b.priority);
  const points: { x: number; y: number }[] = [];
  const result: OpeningPricedVenue[] = [];
  for (const venue of candidates) {
    const point = projectAtCamera(venue.lng, venue.lat, MAP_OPENING_PREVIEW_CAMERA, 390, 844);
    if (point.x < 40 || point.x > 350 || point.y < 40 || point.y > 804) continue;
    if (points.some((other) => Math.abs(point.x - other.x) < 72 && Math.abs(point.y - other.y) < 72)) continue;
    points.push(point);
    result.push({ id: venue.id, name: venue.name, figure: venue.figure, x: venue.x, y: venue.y, aging: venue.aging, priority: venue.priority });
  }
  return result;
}
