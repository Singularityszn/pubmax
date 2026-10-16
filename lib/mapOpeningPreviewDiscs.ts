// The opening discs, as data: what each cluster the map's first frame draws
// at the opening camera says and where it sits. lib/mapOpeningPreview.ts owns
// why this exists and the three promises it keeps; this module only answers.
//
// Pure: it takes the eager cell's rows, so a test hands it rows and the server
// loader (lib/mapOpeningPreview.server.ts) hands it the shipped file.

import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS_PX } from "@/components/map/canvas/buildScene";
import { CLUSTER_PRICE_KEY_NONE, CLUSTER_PRICE_NONE } from "@/components/map/canvas/filters";
import { formatPinPriceLabel, pubsToGeoJSON } from "@/components/map/canvas/geojson";
import {
  clusterAtZoom,
  groundOffsetPx,
  MAP_OPENING_PREVIEW_CAMERA,
} from "@/lib/mapOpeningPreview";
import { slimVenuesToPins } from "@/lib/slimPins";
import type { SlimVenue } from "@/lib/venuesSlim";
import { defaultVenueKindVisibility, filterVenuesByKind } from "@/lib/venueKindFilters";

/** The cheapest figure and its key a disc reduces, as the source does. */
type DiscProps = {
  minPrice: number;
  /** pence x 10 + band of the pub saying the cheapest figure (CLUSTER_PRICE_KEY_PROPERTY). */
  minPriceKey: number;
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
  /**
   * The band of the pub that says the cheapest figure, whose ink the figure
   * wears (CLUSTER_FIGURE_BAND_EXPR): the disc and its ring are neutral.
   */
  figureBand: 0 | 1 | 2;
  /** The cheapest figure's key, pence x 10 + band, as the source reduces it. */
  priceKey: number;
};

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
        const price = properties.clusterPrice;
        return {
          minPrice: typeof price === "number" ? price : CLUSTER_PRICE_NONE,
          minPriceKey:
            typeof price === "number"
              ? Math.round(price * 100) * 10 + Math.min(bucket, 3)
              : CLUSTER_PRICE_KEY_NONE,
        };
      },
      reduce: (into, next) => {
        into.minPrice = Math.min(into.minPrice, next.minPrice);
        into.minPriceKey = Math.min(into.minPriceKey, next.minPriceKey);
      },
    },
  );
  const discs: OpeningPreviewDisc[] = [];
  for (const cluster of clusters) {
    if (!(cluster.props.minPrice < CLUSTER_PRICE_NONE)) continue;
    const figure = formatPinPriceLabel(cluster.props.minPrice);
    if (!figure) continue;
    const figureBand = cluster.props.minPriceKey % 10;
    // A figure whose pub carries no band prints in plain ink on the canvas;
    // the preview leaves that disc out rather than guess at its colour.
    if (figureBand !== 0 && figureBand !== 1 && figureBand !== 2) continue;
    const ground = groundOffsetPx(cluster.lng, cluster.lat, camera);
    discs.push({
      id: cluster.id,
      lng: cluster.lng,
      lat: cluster.lat,
      x: Math.round(ground.x * 100) / 100,
      y: Math.round(ground.y * 100) / 100,
      priceGbp: cluster.props.minPrice,
      figure,
      count: cluster.count,
      figureBand,
      priceKey: cluster.props.minPriceKey,
    });
  }
  // Cheapest first: the first disc in the document is the one a reader's eye
  // and the element timing both meet first.
  return discs.sort((a, b) => a.priceGbp - b.priceGbp || a.id - b.id);
}
