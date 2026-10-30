// THE OPENING PRICES, BEFORE THE MAP ENGINE.
//
// A cold first visit to /map waits on MapLibre (its chunk, its style, its
// worker, its first frame) before a single price shows: 9.4 s on a throttled
// phone, measured. Every price that first frame will draw is already known at
// build time, because a first visit reads exactly one file, the eager core
// cell (lib/mapEagerVenueIndexFile.mjs, `deferSpatial` in lib/slimShards.ts),
// with no drops, no lens and the default filters, at one camera. So the
// prerendered /map document draws those discs itself, and the map takes over
// at the moment it reveals its own pins.
//
// THREE PROMISES, each held by a test.
//   1. Never a price the real map would not show. The discs are clustered here
//      by a port of the very algorithm MapLibre runs in its worker
//      (supercluster's levels, `ClusterTileIndex.cluster` in maplibre-gl 6),
//      over the very features the map builds (`pubsToGeoJSON`), so a figure
//      here is the figure the map's disc prints. e2e/map-opening-preview.spec.ts
//      holds the two to one answer in a real browser.
//   2. No drift at the default camera. The disc positions are world pixels at
//      the opening zoom, laid on a CSS plane under the camera MapLibre uses (a
//      perspective 1.5 map-heights away, the pitch, the bearing), so the browser
//      projects them exactly as the engine will, at any viewport size.
//   3. Nothing render-blocking. The markup and its CSS ship in the document;
//      the only script that decides whether it shows is the pre-paint file
//      every route already runs (public/theme-init.js).
//
// This module is PURE: no fs and no React, so the cluster port is testable.

import { getCity } from "@/lib/cities";
import { MAP_ARRIVAL_BEARING_DEG } from "@/lib/mapArrivalBearing";

/** The world is 512 px wide at zoom 0 in MapLibre's 512-px tile pyramid. */
const TILE_SIZE = 512;
/** MapLibre's vector-tile extent; cluster radii are given to the worker in it. */
const EXTENT = 8192;

/**
 * The camera a COLD FIRST VISIT opens on: London's view with its bearing
 * cleared, which is what PubMap hands the canvas while the opening location is
 * unresolved (`locationFirstMapView`, components/PubMap.tsx). The arrival turn
 * moves it only after the pins are revealed, and the preview is gone by then.
 */
export const MAP_OPENING_PREVIEW_CAMERA = (() => {
  const view = getCity("london").mapView;
  return {
    center: view.center,
    zoom: view.zoom,
    pitch: view.pitch,
    bearing: 0,
  } as const;
})();

/**
 * MapLibre's default vertical field of view puts the camera this many map
 * heights from the point it looks at (0.5 / tan(fov / 2), fov 36.87 degrees).
 */
const MAP_CAMERA_DISTANCE_IN_HEIGHTS = 1.5;

function mercatorX(lng: number): number {
  return lng / 360 + 0.5;
}

function mercatorY(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI;
  return y < 0 ? 0 : y > 1 ? 1 : y;
}

function lngFromMercator(x: number): number {
  return (x - 0.5) * 360;
}

function latFromMercator(y: number): number {
  const y2 = ((180 - y * 360) * Math.PI) / 180;
  return (360 * Math.atan(Math.exp(y2))) / Math.PI - 90;
}

/** One point as the clusterer sees it: a projected position and its props. */
type ClusterPoint<P> = {
  x: number;
  y: number;
  /** The last zoom this point has been considered at; Infinity before any. */
  zoom: number;
  /** How many original points it stands for. */
  count: number;
  /** Original index (a leaf) or the cluster id MapLibre would give it. */
  id: number;
  props: P;
};

export type OpeningCluster<P> = {
  /** The id MapLibre gives this cluster (`cluster_id`), for parity checks. */
  id: number;
  lng: number;
  lat: number;
  count: number;
  props: P;
};

export type OpeningClusterOptions<T, P> = {
  /** `clusterRadius` in screen pixels, as given to the GeoJSON source. */
  radiusPx: number;
  /** `clusterMaxZoom`, as given to the GeoJSON source. */
  maxZoom: number;
  /** The zoom to read the clusters at. */
  zoom: number;
  /** clusterProperties' `map` half, for one leaf's properties. */
  map: (properties: T) => P;
  /** clusterProperties' `reduce` half: fold `next` into `into`. */
  reduce: (into: P, next: P) => void;
};

/**
 * The clusters MapLibre's GeoJSON source holds at `zoom`, for `points` given in
 * the order the map hands them to `setData`.
 *
 * A port of the worker's own pass (supercluster's levels as maplibre-gl 6 ships
 * them in `ClusterTileIndex`): the leaves are laid down at maxZoom + 1, then
 * every level from maxZoom down to `zoom` greedily absorbs each not-yet-taken
 * point's neighbours within `radius`, in ORDER, so the input order is part of
 * the answer and is preserved here. The radius is the source's, converted the
 * way the source converts it (pixels × extent / tile size). The neighbour scan
 * is brute force rather than a KD-tree: the opening cell holds a few hundred
 * points, and the set a neighbour query returns does not depend on how it was
 * found.
 */
export function clusterAtZoom<T, P>(
  points: readonly { lng: number; lat: number; properties: T }[],
  options: OpeningClusterOptions<T, P>,
): OpeningCluster<P>[] {
  const radius = options.radiusPx * (EXTENT / TILE_SIZE);
  const leafCount = points.length;
  let level: ClusterPoint<P>[] = points.map((point, index) => ({
    x: mercatorX(point.lng),
    y: mercatorY(point.lat),
    zoom: Infinity,
    count: 1,
    id: index,
    props: options.map(point.properties),
  }));
  for (let zoom = options.maxZoom; zoom >= options.zoom; zoom--) {
    const r = radius / (EXTENT * Math.pow(2, zoom));
    const next: ClusterPoint<P>[] = [];
    for (let i = 0; i < level.length; i++) {
      const point = level[i]!;
      if (point.zoom <= zoom) continue;
      point.zoom = zoom;
      const neighbours = level.filter(
        (other) => (other.x - point.x) ** 2 + (other.y - point.y) ** 2 <= r * r,
      );
      let count = point.count;
      for (const other of neighbours) if (other.zoom > zoom) count += other.count;
      if (count > point.count && count >= 2) {
        let wx = point.x * point.count;
        let wy = point.y * point.count;
        // The id the worker mints: the origin's index in this level, shifted,
        // plus the zoom it formed at, plus the leaf count.
        const id = (i << 5) + (zoom + 1) + leafCount;
        const props = { ...point.props };
        for (const other of neighbours) {
          if (other.zoom <= zoom) continue;
          other.zoom = zoom;
          wx += other.x * other.count;
          wy += other.y * other.count;
          options.reduce(props, other.props);
        }
        next.push({ x: wx / count, y: wy / count, zoom: Infinity, count, id, props });
      } else {
        next.push(point);
        if (count > 1) {
          for (const other of neighbours) {
            if (other.zoom <= zoom) continue;
            other.zoom = zoom;
            next.push(other);
          }
        }
      }
    }
    level = next;
  }
  return level
    .filter((point) => point.count > 1)
    .map((point) => ({
      id: point.id,
      lng: lngFromMercator(point.x),
      lat: latFromMercator(point.y),
      count: point.count,
      props: point.props,
    }));
}

/**
 * Where a point sits on the camera's ground plane, in screen pixels from the
 * point the camera looks at, before the tilt: the world-pixel offset at the
 * camera's zoom. The opening camera has no bearing (it is cleared, see
 * MAP_OPENING_PREVIEW_CAMERA), so there is no turn to undo; a camera with one
 * is refused rather than projected by arithmetic nothing has checked.
 * The CSS plane in components/map/MapOpeningPreview.tsx tilts and projects it.
 */
export function groundOffsetPx(
  lng: number,
  lat: number,
  camera: { center: readonly [number, number]; zoom: number; bearing: number },
): { x: number; y: number } {
  if (camera.bearing !== 0) throw new Error("The opening preview is drawn for a camera with no bearing.");
  const worldSize = TILE_SIZE * Math.pow(2, camera.zoom);
  return {
    x: (mercatorX(lng) - mercatorX(camera.center[0])) * worldSize,
    y: (mercatorY(lat) - mercatorY(camera.center[1])) * worldSize,
  };
}

/**
 * The screen position MapLibre gives a point at `camera` in a `width` ×
 * `height` map: the same projection the CSS plane performs, written out so a
 * test can hold the plane, the engine and this arithmetic to one answer.
 */
export function projectAtCamera(
  lng: number,
  lat: number,
  camera: { center: readonly [number, number]; zoom: number; bearing: number; pitch: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const ground = groundOffsetPx(lng, lat, camera);
  const pitch = (camera.pitch * Math.PI) / 180;
  const distance = MAP_CAMERA_DISTANCE_IN_HEIGHTS * height;
  const depth = distance - ground.y * Math.sin(pitch);
  return {
    x: width / 2 + (ground.x * distance) / depth,
    y: height / 2 + (ground.y * Math.cos(pitch) * distance) / depth,
  };
}

/**
 * The event the map dispatches when its first frame will NOT be the one the
 * preview drew (a resumed or located camera, a lens, drops or price updates
 * that change a figure, a map that failed), so the preview stands down before
 * the map draws rather than at its reveal. `pubmax:pins-visible`
 * (lib/performanceMarks.ts) is the ordinary handoff.
 */
export const MAP_OPENING_PREVIEW_RETRACT_EVENT = "pubmax:opening-preview-retract";

/**
 * The clustering the pubs source is created with, restated so this module (and
 * the preview's client half) does not pull the scene builder in behind it.
 * __tests__/mapOpeningPreview.test.ts holds each to its owner:
 * CLUSTER_RADIUS_PX and CLUSTER_MAX_ZOOM (components/map/canvas/buildScene.ts),
 * CLUSTER_PRICE_NONE (components/map/canvas/filters.ts).
 */
export const OPENING_CLUSTER_RADIUS_PX = 56;
export const OPENING_CLUSTER_MAX_ZOOM = 13;
export const OPENING_CLUSTER_PRICE_NONE = 9999;
export const OPENING_CLUSTER_PRICE_KEY_NONE = 99_999_999;

/**
 * The event the canvas dispatches, before its pins are revealed, each time it
 * hands the pubs source its features: what it is about to draw, and from where.
 */
export const MAP_OPENING_FRAME_EVENT = "pubmax:opening-frame";

export type MapOpeningFrame = {
  features: readonly GeoJSON.Feature[];
  camera: { center: readonly [number, number]; zoom: number; pitch: number; bearing: number };
};

/**
 * What a priced disc claims, reduced to the facts a frame can contradict: its
 * cluster, its count, its cheapest price, and how many of its pubs sit in each
 * price band (b0..b3), which is what its ring is drawn from.
 */
export type OpeningDiscClaim = {
  id: number;
  count: number;
  priceGbp: number;
  /** The cheapest figure and its pub's band, pence x 10 + band: the figure's ink. */
  priceKey: number;
};

type ClaimProps = { minPrice: number; minPriceKey: number };

/**
 * The priced clusters a set of pub features makes at the opening camera's
 * zoom, as the source makes them: the same clustering, the same `clusterPrice`
 * reduced by `min`.
 */
export function openingDiscClaims(features: readonly GeoJSON.Feature[]): OpeningDiscClaim[] {
  const clusters = clusterAtZoom<GeoJSON.GeoJsonProperties, ClaimProps>(
    features.map((feature) => {
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      return { lng, lat, properties: feature.properties };
    }),
    {
      radiusPx: OPENING_CLUSTER_RADIUS_PX,
      maxZoom: OPENING_CLUSTER_MAX_ZOOM,
      zoom: Math.floor(MAP_OPENING_PREVIEW_CAMERA.zoom),
      map: (properties) => {
        const price = properties?.clusterPrice;
        const bucket = typeof properties?.bucket === "number" ? properties.bucket : 3;
        return {
          minPrice: typeof price === "number" ? price : OPENING_CLUSTER_PRICE_NONE,
          minPriceKey:
            typeof price === "number"
              ? Math.round(price * 100) * 10 + Math.min(bucket, 3)
              : OPENING_CLUSTER_PRICE_KEY_NONE,
        };
      },
      reduce: (into, next) => {
        into.minPrice = Math.min(into.minPrice, next.minPrice);
        into.minPriceKey = Math.min(into.minPriceKey, next.minPriceKey);
      },
    },
  );
  return clusters
    .filter((cluster) => cluster.props.minPrice < OPENING_CLUSTER_PRICE_NONE)
    .map((cluster) => ({
      id: cluster.id,
      count: cluster.count,
      priceGbp: cluster.props.minPrice,
      priceKey: cluster.props.minPriceKey,
    }));
}

/** A camera as the opening preview reads it. */
export type OpeningCameraPose = MapOpeningFrame["camera"];

/**
 * Whether two cameras are the same view, to the engine's own floating point:
 * within a ten-millionth of a degree of centre (about a centimetre) and a
 * millionth of a zoom level, degree of pitch or degree of bearing.
 */
export function sameCameraPose(a: OpeningCameraPose, b: OpeningCameraPose): boolean {
  return (
    Math.abs(a.center[0] - b.center[0]) < 1e-7 &&
    Math.abs(a.center[1] - b.center[1]) < 1e-7 &&
    Math.abs(a.zoom - b.zoom) < 1e-6 &&
    Math.abs(a.pitch - b.pitch) < 1e-6 &&
    Math.abs(a.bearing - b.bearing) < 1e-6
  );
}

/**
 * The bearing a camera has turned to from `from`, when turning is all it did:
 * the same centre, zoom and pitch, and a bearing no more than
 * MAP_ARRIVAL_BEARING_DEG off. Null for any other move. The map's arrival turn
 * (lib/mapArrivalBearing.ts) is this move, and the preview turns with it
 * instead of standing down (components/map/MapOpeningPreview.tsx).
 */
export function openingTurnBearing(camera: OpeningCameraPose, from: OpeningCameraPose): number | null {
  if (Math.abs(camera.bearing - from.bearing) > MAP_ARRIVAL_BEARING_DEG + 1e-6) return null;
  return sameCameraPose({ ...camera, bearing: from.bearing }, from) ? camera.bearing : null;
}

/**
 * Dispatched by the canvas, with the bearing as its detail, each frame the
 * camera turns and does nothing else while the preview is up.
 */
export const MAP_OPENING_PREVIEW_TURN_EVENT = "pubmax:opening-preview-turn";

/** The opening camera, or the opening camera turned as far as the arrival turn turns it. */
function sameCamera(camera: MapOpeningFrame["camera"]): boolean {
  return openingTurnBearing(camera, MAP_OPENING_PREVIEW_CAMERA) !== null;
}

/**
 * Marked when the preview stands down, so a timing can read the handoff and
 * the canvas knows the preview no longer needs telling about a camera move.
 */
export const MAP_OPENING_PREVIEW_DONE_MARK = "pubmax:opening-preview-done";

/**
 * Whether the frame the map is about to draw is the frame the preview drew:
 * the opening camera, and every priced disc the same cluster with the same
 * count and the same cheapest price in the same band ink (a live Pint Drop can
 * move the cheapest pub to another band, which recolours the figure without
 * changing the price), no more and no fewer. A frame with no
 * pubs yet (the source before its data lands) contradicts nothing.
 */
export function frameMatchesPreview(
  frame: MapOpeningFrame,
  preview: readonly OpeningDiscClaim[],
): boolean {
  if (!sameCamera(frame.camera)) return false;
  if (frame.features.length === 0) return true;
  const live = openingDiscClaims(frame.features);
  if (live.length !== preview.length) return false;
  const byId = new Map(live.map((claim) => [claim.id, claim]));
  return preview.every((claim) => {
    const twin = byId.get(claim.id);
    return (
      twin !== undefined &&
      twin.count === claim.count &&
      Math.round(twin.priceGbp * 100) === Math.round(claim.priceGbp * 100) &&
      twin.priceKey === claim.priceKey
    );
  });
}

type OpeningFrameWindow = Window & { __pubmaxOpeningFrame?: MapOpeningFrame };

/**
 * Hand the preview the frame the map is about to draw. Kept on the window as
 * well as dispatched, because the canvas can publish before the preview has
 * hydrated to listen.
 */
export function publishMapOpeningFrame(frame: MapOpeningFrame): void {
  if (typeof window === "undefined") return;
  (window as OpeningFrameWindow).__pubmaxOpeningFrame = frame;
  try {
    window.dispatchEvent(new CustomEvent<MapOpeningFrame>(MAP_OPENING_FRAME_EVENT, { detail: frame }));
  } catch {
    // An environment with no CustomEvent still kept the frame on the window.
  }
}

/** The last frame the canvas published, or null before it has published one. */
export function readPublishedOpeningFrame(): MapOpeningFrame | null {
  if (typeof window === "undefined") return null;
  return (window as OpeningFrameWindow).__pubmaxOpeningFrame ?? null;
}
