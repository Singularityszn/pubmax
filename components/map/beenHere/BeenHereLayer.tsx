"use client";

// The reader's Been here list on the map. Two quiet layers, and neither one
// touches a pin's price, colour or placement:
//
// 1. A small muted dot on each pin the reader has been to: on the top edge of
//    a price pill, or at the upper left of a glass glyph, mirroring the
//    provisional-report dot. A circle takes no part in symbol collision, so it
//    changes what a pin looks like and never which pins are placed. It rides
//    only beside a pin the map is drawing.
// 2. With "Your postcodes" on in Layers, a disc at each London postcode
//    district the reader has been to, shaded by the share of our listed pubs
//    there they have been to, with the district and its per cent. Discs and
//    labels sit under every pin, so a pin always wins the label space.

import { useEffect, useMemo, useRef, useState } from "react";
import type * as maplibregl from "maplibre-gl";

import { PIN_MIN_ZOOM, PROVISIONAL_BADGE_OFFSET_PX, PROVISIONAL_BADGE_RADIUS_MAX_PX } from "@/components/map/canvas/buildScene";
import { paintedPins, samePaintedPins, type PaintedPin } from "@/components/map/canvas/paintedPins";
import { readTokens } from "@/components/map/canvas/tokens";
import type { BeenHereProgress } from "@/lib/beenHereProgress";

import { useBeenHerePostcodesOn, useBeenHereVenueIds } from "./useBeenHere";
import { useLondonBeenHereProgress } from "./useLondonBeenHereProgress";

const MARK_SOURCE = "been-here-marks";
const MARK_LAYER = "been-here-mark";
const MARK_PILL_LAYER = "been-here-mark-pill";
const DISTRICT_SOURCE = "been-here-districts";
const DISTRICT_FILL_LAYER = "been-here-district-fill";
const DISTRICT_LABEL_LAYER = "been-here-district-label";

/** On a glass glyph the visited dot mirrors the provisional dot: same size, opposite shoulder. */
const MARK_OFFSET_PX: [number, number] = [-PROVISIONAL_BADGE_OFFSET_PX[0], PROVISIONAL_BADGE_OFFSET_PX[1]];
/** On a 26px price pill it sits on the pill's top edge, left of centre, clear of the figure. */
const MARK_PILL_OFFSET_PX: [number, number] = [-6, -13];
const MARK_RADIUS_MIN_PX = 3.2;

/** Districts read from a city-wide view down to street level, where the pins take over. */
const DISTRICT_MIN_ZOOM = 9;
const DISTRICT_MAX_ZOOM = 15;

/** The first pin layer in paint order. District discs go under it. */
const PIN_FLOOR_LAYERS = new Set([
  "uk-base-selected",
  "uk-base-unnamed-point",
  "uk-base-point",
  "pubs-drops-halo",
  "pubs-whatson-badge",
  "pubs-point",
  "clusters-casing",
]);

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function isDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

function firstPinLayer(map: maplibregl.Map): string | undefined {
  return map.getStyle()?.layers?.find((layer) => PIN_FLOOR_LAYERS.has(layer.id))?.id;
}

function labelFont(map: maplibregl.Map): string[] {
  const font: unknown = map.getLayer("pois-label") ? map.getLayoutProperty("pois-label", "text-font") : null;
  return Array.isArray(font) && font.every((name): name is string => typeof name === "string") ? font : ["Noto Sans Bold"];
}

function addLayers(map: maplibregl.Map): void {
  const tokens = readTokens();
  const halo = isDark() ? tokens.inkDeep : tokens.paper;
  for (const id of [MARK_SOURCE, DISTRICT_SOURCE]) {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY });
  }
  const pinFloor = firstPinLayer(map);
  if (!map.getLayer(DISTRICT_FILL_LAYER)) {
    map.addLayer(
      {
        id: DISTRICT_FILL_LAYER,
        type: "circle",
        source: DISTRICT_SOURCE,
        minzoom: DISTRICT_MIN_ZOOM,
        maxzoom: DISTRICT_MAX_ZOOM,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 11, 12, 24, 14, 36],
          "circle-color": tokens.ink,
          "circle-opacity": ["+", 0.1, ["*", 0.4, ["get", "share"]]],
          "circle-stroke-color": tokens.ink,
          "circle-stroke-width": 1.2,
          "circle-stroke-opacity": 0.5,
          "circle-pitch-alignment": "viewport",
        },
      },
      pinFloor,
    );
  }
  if (!map.getLayer(DISTRICT_LABEL_LAYER)) {
    map.addLayer(
      {
        id: DISTRICT_LABEL_LAYER,
        type: "symbol",
        source: DISTRICT_SOURCE,
        minzoom: DISTRICT_MIN_ZOOM,
        maxzoom: DISTRICT_MAX_ZOOM,
        layout: {
          "text-field": ["get", "label"],
          "text-font": labelFont(map),
          "text-size": 12,
          "text-line-height": 1.1,
          // Pins win the room. A label tries its disc, then each side of it,
          // and waits for a closer zoom when a pin holds every spot.
          "text-variable-anchor-offset": [
            "center", [0, 0], "top", [0, 1.4], "bottom", [0, -1.4], "left", [1.6, 0], "right", [-1.6, 0],
          ],
        },
        paint: {
          "text-color": tokens.ink,
          "text-halo-color": halo,
          "text-halo-width": 1.6,
        },
      },
      pinFloor,
    );
  }
  const markPaint = (translate: [number, number]) => ({
    "circle-color": tokens.muted,
    "circle-radius": [
      "interpolate", ["linear"], ["zoom"], PIN_MIN_ZOOM, MARK_RADIUS_MIN_PX, 15, PROVISIONAL_BADGE_RADIUS_MAX_PX,
    ] as maplibregl.ExpressionSpecification,
    "circle-translate": translate,
    "circle-translate-anchor": "viewport" as const,
    "circle-stroke-color": halo,
    "circle-stroke-width": 1.4,
    "circle-pitch-alignment": "viewport" as const,
  });
  for (const [id, onPill, translate] of [
    [MARK_LAYER, false, MARK_OFFSET_PX],
    [MARK_PILL_LAYER, true, MARK_PILL_OFFSET_PX],
  ] as const) {
    if (map.getLayer(id)) continue;
    map.addLayer({
      id,
      type: "circle",
      source: MARK_SOURCE,
      minzoom: PIN_MIN_ZOOM,
      filter: ["==", ["get", "pill"], onPill],
      paint: markPaint([translate[0], translate[1]]),
    });
  }
  placeLayers(map);
}

/**
 * Keep discs and district labels under every pin, with visit dots over pins.
 * The map's own pin layers can arrive after ours, so this runs on every
 * settled frame and moves a layer only when it is out of place.
 */
function placeLayers(map: maplibregl.Map): void {
  const order = map.getLayersOrder();
  const at = (id: string) => order.indexOf(id);
  const pinFloor = firstPinLayer(map);
  for (const id of [DISTRICT_FILL_LAYER, DISTRICT_LABEL_LAYER]) {
    if (pinFloor && at(id) > at(pinFloor)) map.moveLayer(id, pinFloor);
  }
  const top = order[order.length - 1];
  const topPin = Math.max(at("pubs-price-pill-selected"), at("pubs-selected"), at("clusters"), at("cluster-count"));
  for (const id of [MARK_LAYER, MARK_PILL_LAYER]) {
    if (at(id) !== -1 && at(id) < topPin && id !== top) map.moveLayer(id);
  }
}

function removeLayers(map: maplibregl.Map): void {
  try {
    for (const id of [MARK_LAYER, MARK_PILL_LAYER, DISTRICT_LABEL_LAYER, DISTRICT_FILL_LAYER]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [MARK_SOURCE, DISTRICT_SOURCE]) {
      if (map.getSource(id)) map.removeSource(id);
    }
  } catch {
    // The map may already be gone.
  }
}

function markFeatures(
  visited: ReadonlySet<string>,
  painted: ReadonlyMap<string, PaintedPin>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const id of visited) {
    const pin = painted.get(id);
    if (!pin) continue;
    features.push({ type: "Feature", properties: { id, pill: pin.shape === "pill" }, geometry: { type: "Point", coordinates: pin.coordinates } });
  }
  return { type: "FeatureCollection", features };
}

function districtFeatures(progress: BeenHereProgress | null): GeoJSON.FeatureCollection {
  if (!progress) return EMPTY;
  return {
    type: "FeatureCollection",
    features: progress.districts.map((row) => ({
      type: "Feature",
      properties: { district: row.district, share: row.percent / 100, label: `${row.district}\n${row.percent}%` },
      geometry: { type: "Point", coordinates: [row.lng, row.lat] },
    })),
  };
}

function setData(map: maplibregl.Map, sourceId: string, data: GeoJSON.FeatureCollection): void {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  source?.setData(data);
}

export default function BeenHereLayer({ map }: { map: maplibregl.Map }) {
  const visited = useBeenHereVenueIds();
  const postcodesOn = useBeenHerePostcodesOn();
  const progress = useLondonBeenHereProgress(postcodesOn, visited);
  const [painted, setPainted] = useState<ReadonlyMap<string, PaintedPin>>(() => new Map());
  const marks = useMemo(() => markFeatures(visited, painted), [visited, painted]);
  const districts = useMemo(() => districtFeatures(postcodesOn ? progress : null), [postcodesOn, progress]);
  const settled = useRef(false);
  const latestDistricts = useRef(districts);
  useEffect(() => {
    latestDistricts.current = districts;
  }, [districts]);

  useEffect(() => {
    const clearPainted = () => {
      settled.current = false;
      setData(map, MARK_SOURCE, EMPTY);
      setPainted((current) => (current.size === 0 ? current : new Map()));
    };
    const draw = () => {
      addLayers(map);
      clearPainted();
      setData(map, DISTRICT_SOURCE, latestDistricts.current);
    };
    const readPainted = () => {
      if (map.isMoving()) return;
      // A style still loading its sources at mount fires no second style.load.
      if (!map.getLayer(MARK_LAYER)) draw();
      else placeLayers(map);
      const next = paintedPins(map);
      settled.current = true;
      setPainted((current) => (samePaintedPins(current, next) ? current : next));
    };
    if (map.isStyleLoaded()) readPainted();
    map.on("style.load", draw);
    map.on("movestart", clearPainted);
    map.on("idle", readPainted);
    return () => {
      map.off("style.load", draw);
      map.off("movestart", clearPainted);
      map.off("idle", readPainted);
      settled.current = false;
      removeLayers(map);
    };
  }, [map]);

  useEffect(() => {
    if (!map.getSource(MARK_SOURCE)) return;
    setData(map, MARK_SOURCE, settled.current ? marks : EMPTY);
  }, [map, marks]);

  useEffect(() => {
    if (!map.getSource(DISTRICT_SOURCE)) return;
    setData(map, DISTRICT_SOURCE, districts);
  }, [map, districts]);

  return null;
}
