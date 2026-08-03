import type * as maplibregl from "maplibre-gl";

// A browser test cannot ask a canvas where its pins are, so it used to guess:
// a grid of taps across the map, hoping one landed on a pin before the scan
// gave up. Under worker contention it did not, and the guess read as a
// product defect. This publishes the one answer a tap needs - the viewport
// point of each pin the map is drawing RIGHT NOW - so the tap lands on a pin
// because a pin is known to be there.
//
// It reads the live map and stores nothing, so it can never name a pin the
// map has stopped drawing. A returned point has cleared three gates:
//   1. the pin survived symbol collision (queryRenderedFeatures over the
//      viewport returns placed symbols only, so an unpainted pin is absent);
//   2. re-querying that point returns the same pub, which is what the click
//      router in `interactions.ts` resolves first, so the tap opens the venue
//      sheet rather than a cluster or a landmark card;
//   3. nothing in the app chrome covers it, so the map canvas - not a topbar
//      button - receives the tap.
export const PAINTED_PIN_PROBE_KEY = "__pubmaxPaintedPinTapPoints";

/** A pin the map is painting, in viewport coordinates a tap can use. */
export type PaintedPinTapPoint = { id: string; x: number; y: number };

type ProbeWindow = Window & {
  [PAINTED_PIN_PROBE_KEY]?: () => PaintedPinTapPoint[];
};

// The click router treats a pub hit as the winner before every other layer, so
// a point that hits either of these opens the venue sheet.
const PIN_LAYERS = ["pubs-point-selected", "pubs-point"] as const;

export function paintedPinTapPoints(map: maplibregl.Map): PaintedPinTapPoint[] {
  const layers = PIN_LAYERS.filter((id) => Boolean(map.getLayer(id)));
  if (!layers.length) return [];

  const container = map.getContainer();
  const rect = container.getBoundingClientRect();
  const ownerDocument = container.ownerDocument;
  const canvas = map.getCanvas();

  const points: PaintedPinTapPoint[] = [];
  const seen = new Set<string>();
  for (const feature of map.queryRenderedFeatures({ layers: [...layers] })) {
    const id = feature.properties?.id;
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);

    const geometry = feature.geometry;
    if (geometry.type !== "Point") continue;
    const [lng, lat] = geometry.coordinates;
    // No icon-anchor or icon-offset on the pin layers, so the projected
    // coordinate is the icon's centre (buildScene.ts, `pubs-point`).
    const point = map.project([lng, lat]);

    const hits = map.queryRenderedFeatures(point, { layers: [...layers] });
    if (!hits.some((hit) => hit.properties?.id === id)) continue;

    const x = rect.left + point.x;
    const y = rect.top + point.y;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    const topmost = ownerDocument.elementFromPoint(x, y);
    if (topmost !== canvas) continue;

    points.push({ id, x, y });
  }
  return points;
}

/**
 * Publishes {@link paintedPinTapPoints} for the browser suite. Unconditional,
 * like the `pubmax:pin-reveal` event beside it: the e2e run exercises a
 * production build, so a development-only hook would not exist where the test
 * needs it. Returns its own removal.
 */
export function installPaintedPinProbe(map: maplibregl.Map): () => void {
  const probeWindow = window as ProbeWindow;
  probeWindow[PAINTED_PIN_PROBE_KEY] = () => paintedPinTapPoints(map);
  return () => {
    delete probeWindow[PAINTED_PIN_PROBE_KEY];
  };
}
