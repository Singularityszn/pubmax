// Which pub pins the map is drawing right now. A mark that rides beside a pin
// (a sun dot, a Been here dot) is drawn only while its pin is drawn: a pin that
// lost symbol collision, or a pub folded into a cluster, takes its mark with it.

import type * as maplibregl from "maplibre-gl";

/** The pub pin layers, as the click router and the painted-pin probe name them. */
export const PUB_PIN_LAYERS = [
  "pubs-price-pill-selected",
  "pubs-point-selected",
  "pubs-price-pill",
  "pubs-point",
] as const;

/**
 * The ids of the pub pins the map is drawing right now. Rendered-feature
 * queries return placed symbols only, so a pin that lost collision is absent.
 */
export function paintedPinIds(map: Pick<maplibregl.Map, "getLayer" | "queryRenderedFeatures">): Set<string> {
  const layers = PUB_PIN_LAYERS.filter((id) => Boolean(map.getLayer(id)));
  const ids = new Set<string>();
  if (layers.length === 0) return ids;
  for (const feature of map.queryRenderedFeatures({ layers })) {
    const id = feature.properties?.id;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/** Same members, so a settled map that drew the same pins asks for no new marks. */
export function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** How a painted pub is drawn: a price pill, or the glass glyph of a pub with no price on its pin. */
export type PaintedPin = { shape: "pill" | "glyph"; coordinates: GeoJSON.Position };

/** The painted pub pins and the shape each one is drawn in. */
export function paintedPins(
  map: Pick<maplibregl.Map, "getLayer" | "queryRenderedFeatures">,
): Map<string, PaintedPin> {
  const layers = PUB_PIN_LAYERS.filter((id) => Boolean(map.getLayer(id)));
  const pins = new Map<string, PaintedPin>();
  if (layers.length === 0) return pins;
  for (const feature of map.queryRenderedFeatures({ layers })) {
    const id = feature.properties?.id;
    if (typeof id !== "string" || feature.geometry.type !== "Point" || pins.get(id)?.shape === "pill") continue;
    pins.set(id, {
      shape: feature.layer.id.includes("price-pill") ? "pill" : "glyph",
      coordinates: feature.geometry.coordinates,
    });
  }
  return pins;
}

export function samePaintedPins(a: ReadonlyMap<string, PaintedPin>, b: ReadonlyMap<string, PaintedPin>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, pin] of a) {
    const next = b.get(id);
    if (!next || next.shape !== pin.shape || next.coordinates.length !== pin.coordinates.length) return false;
    if (pin.coordinates.some((coordinate, axis) => coordinate !== next.coordinates[axis])) return false;
  }
  return true;
}
