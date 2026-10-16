// The opening discs, as data: what each cluster the map's first frame draws
// at the opening camera says and where it sits. lib/mapOpeningPreview.ts owns
// why this exists and the three promises it keeps; this module only answers.
//
// Pure: it takes the eager cell's rows, so a test hands it rows and the server
// loader (lib/mapOpeningPreview.server.ts) hands it the shipped file.

import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS_PX } from "@/components/map/canvas/buildScene";
import { CLUSTER_PRICE_NONE } from "@/components/map/canvas/filters";
import { formatPinPriceLabel, pubsToGeoJSON } from "@/components/map/canvas/geojson";
import { DONUT_BADGE_MIN, formatDonutCount } from "@/lib/donutClusterGeometry";
import {
  clusterAtZoom,
  groundOffsetPx,
  MAP_OPENING_PREVIEW_CAMERA,
} from "@/lib/mapOpeningPreview";
import { slimVenuesToPins } from "@/lib/slimPins";
import type { SlimVenue } from "@/lib/venuesSlim";
import { defaultVenueKindVisibility, filterVenuesByKind } from "@/lib/venueKindFilters";

/** The band counts and cheapest figure a disc reduces, as the source does. */
type DiscProps = {
  b: [number, number, number, number];
  minPrice: number;
};

export type OpeningPreviewDisc = {
  /** The cluster id MapLibre gives this disc, so a test can find its twin. */
  id: number;
  lng: number;
  lat: number;
  /** Ground-plane offset from the camera's centre, in px at its zoom. */
  x: number;
  y: number;
  /** The cheapest price in the disc, in pounds. */
  priceGbp: number;
  /** The figure the disc prints, written the way a pin writes it. */
  figure: string;
  /** Pubs in the disc. */
  count: number;
  /** The rim count, from DONUT_BADGE_MIN pubs up, or null. */
  badge: string | null;
  /**
   * The ring a phone's GL disc wears: the most common KNOWN band, 3 for none
   * (the rule `clusterRingColorExpr` in lib/mapBasemapTaste.ts paints).
   */
  ringBand: 0 | 1 | 2 | 3;
  /** The desktop disc's ring: each band's share of the pubs, b0..b3. */
  shares: [number, number, number, number];
};

/** The most common known band, by the GL ring's own tie rules. */
function ringBandFor([cheap, middle, dear]: DiscProps["b"]): OpeningPreviewDisc["ringBand"] {
  if (cheap > 0 && cheap >= middle && cheap >= dear) return 0;
  if (middle > 0 && middle > cheap && middle >= dear) return 1;
  if (dear > 0 && dear > cheap && dear > middle) return 2;
  return 3;
}

/**
 * The priced discs the map's first frame draws for these eager-cell rows, at
 * the opening camera, under the default view of a cold first visit: every
 * kind the map shows by default, no drops, no lens, no favourite pint. A disc
 * with no price prints its count, which is not a price, so it is left out.
 */
export function openingPreviewDiscs(rows: readonly SlimVenue[]): OpeningPreviewDisc[] {
  const venues = filterVenuesByKind(slimVenuesToPins([...rows]), defaultVenueKindVisibility());
  const features = pubsToGeoJSON(venues, new Map(), null).features;
  const camera = MAP_OPENING_PREVIEW_CAMERA;
  const clusters = clusterAtZoom<Record<string, unknown>, DiscProps>(
    features.map((feature) => {
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      return { lng, lat, properties: feature.properties ?? {} };
    }),
    {
      radiusPx: CLUSTER_RADIUS_PX,
      maxZoom: CLUSTER_MAX_ZOOM,
      zoom: Math.floor(camera.zoom),
      map: (properties) => {
        const bucket = typeof properties.bucket === "number" ? properties.bucket : 3;
        const b: DiscProps["b"] = [0, 0, 0, 0];
        if (bucket >= 0 && bucket <= 3) b[bucket] = 1;
        const price = properties.clusterPrice;
        return {
          b,
          minPrice: typeof price === "number" ? price : CLUSTER_PRICE_NONE,
        };
      },
      reduce: (into, next) => {
        into.b = [into.b[0] + next.b[0], into.b[1] + next.b[1], into.b[2] + next.b[2], into.b[3] + next.b[3]];
        into.minPrice = Math.min(into.minPrice, next.minPrice);
      },
    },
  );
  const discs: OpeningPreviewDisc[] = [];
  for (const cluster of clusters) {
    if (!(cluster.props.minPrice < CLUSTER_PRICE_NONE)) continue;
    const figure = formatPinPriceLabel(cluster.props.minPrice);
    if (!figure) continue;
    const ground = groundOffsetPx(cluster.lng, cluster.lat, camera);
    const total = cluster.props.b.reduce((sum, n) => sum + n, 0) || 1;
    discs.push({
      id: cluster.id,
      lng: cluster.lng,
      lat: cluster.lat,
      x: Math.round(ground.x * 100) / 100,
      y: Math.round(ground.y * 100) / 100,
      priceGbp: cluster.props.minPrice,
      figure,
      count: cluster.count,
      badge: cluster.count >= DONUT_BADGE_MIN ? formatDonutCount(cluster.count) : null,
      ringBand: ringBandFor(cluster.props.b),
      shares: cluster.props.b.map((n) => Math.round((n / total) * 1000) / 1000) as OpeningPreviewDisc["shares"],
    });
  }
  // Cheapest first: the first disc in the document is the one a reader's eye
  // and the element timing both meet first.
  return discs.sort((a, b) => a.priceGbp - b.priceGbp || a.id - b.id);
}
