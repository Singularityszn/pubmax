"use client";

// Sun Chaser's map half, loaded only while the chip is on. It reads building
// outlines and heights from the basemap's own vector tiles (the OpenMapTiles
// `building` layer: `render_height`, else `height`), works out sun and shade for
// every pub in view with a recorded garden or outdoor seating, and draws a sun
// dot beside each pin likely in the sun at the chosen time. It draws nothing
// else and never moves the camera.

import { useEffect, useRef } from "react";
import type * as maplibregl from "maplibre-gl";
import { readTokens } from "@/components/map/canvas/tokens";
import {
  estimateSun,
  MAX_SHADOW_REACH_M,
  segmentAt,
  type LngLat,
  type SunBuilding,
  type SunEstimate,
} from "@/lib/sunChaser";
import { loadSurfaceJson, SURFACE_JUST_READ_MS } from "@/lib/surfaceDataCache";
import { venueHasRecordedOutdoorSpace, type Venue } from "@/lib/venues";
import { sunChaserSelectedTime } from "./SunChaserControls";
import { getSunChaserState, updateSunChaser, useSunChaser } from "./sunChaserStore";

/** The live map this layer reads, named here so PubMap needs no MapLibre import. */
export type SunChaserMap = maplibregl.Map;

const SOURCE_ID = "sun-chaser";
const LAYER_ID = "sun-chaser-dots";
/** The basemap's building layer holds outlines from here; below it a city of pubs is too many rays. */
export const SUN_CHASER_MIN_ZOOM = 14;
/** The nearest gardens to the centre of the view, so a wide phone pan stays quick. */
const MAX_PUBS = 150;
/** A new start time every few minutes, so "now" does not drift into the past. */
const REFRESH_MS = 5 * 60_000;

const DEG_LAT_PER_M = 1 / 110_540;

function buildingSourceId(map: maplibregl.Map): string | null {
  const layer = map.getStyle()?.layers?.find(
    (candidate) => "source-layer" in candidate && candidate["source-layer"] === "building" && "source" in candidate,
  );
  return layer && "source" in layer && typeof layer.source === "string" ? layer.source : null;
}

function finiteHeight(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

type IndexedBuilding = SunBuilding & { minLng: number; maxLng: number; minLat: number; maxLat: number };

function readBuildings(map: maplibregl.Map, sourceId: string): IndexedBuilding[] {
  const out: IndexedBuilding[] = [];
  for (const feature of map.querySourceFeatures(sourceId, { sourceLayer: "building" })) {
    const geometry = feature.geometry;
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    const props = feature.properties ?? {};
    const heightM = finiteHeight(props.render_height) ?? finiteHeight(props.height);
    for (const polygon of polygons) {
      const rings = polygon.map((ring) => ring.map(([lng, lat]) => [lng, lat] as LngLat));
      const outer = rings[0] ?? [];
      if (outer.length < 3) continue;
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const [lng, lat] of outer) {
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
      out.push({ rings, heightM, minLng, maxLng, minLat, maxLat });
    }
  }
  return out;
}

function nearby(buildings: readonly IndexedBuilding[], point: LngLat): SunBuilding[] {
  const dLat = MAX_SHADOW_REACH_M * DEG_LAT_PER_M;
  const dLng = dLat / Math.cos((point[1] * Math.PI) / 180);
  return buildings.filter((b) =>
    b.maxLng >= point[0] - dLng && b.minLng <= point[0] + dLng && b.maxLat >= point[1] - dLat && b.minLat <= point[1] + dLat,
  );
}

function computeEstimates(map: maplibregl.Map, venues: readonly Venue[]): void {
  if (map.getZoom() < SUN_CHASER_MIN_ZOOM) {
    updateSunChaser({ status: "zoom-in", estimates: new Map(), from: null });
    return;
  }
  const bounds = map.getBounds();
  const centre = map.getCenter();
  const gardens = venues
    .filter((venue) => bounds.contains([venue.longitude, venue.latitude]) && venueHasRecordedOutdoorSpace(venue))
    .sort((a, b) =>
      Math.hypot(a.longitude - centre.lng, a.latitude - centre.lat) - Math.hypot(b.longitude - centre.lng, b.latitude - centre.lat))
    .slice(0, MAX_PUBS);
  const sourceId = buildingSourceId(map);
  const buildings = sourceId ? readBuildings(map, sourceId) : [];
  const from = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const estimates = new Map<string, SunEstimate>();
  for (const venue of gardens) {
    const point: LngLat = [venue.longitude, venue.latitude];
    estimates.set(venue.id, estimateSun({
      point,
      hasRecordedOutdoorSpace: true,
      buildings: buildings.length > 0 ? nearby(buildings, point) : null,
      from,
    }));
  }
  updateSunChaser({ status: buildings.length > 0 ? "ready" : "no-buildings", estimates, from });
}

function ensureLayer(map: maplibregl.Map): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (map.getLayer(LAYER_ID)) return;
  const tokens = readTokens();
  map.addLayer({
    id: LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": 6,
      "circle-color": tokens.amber,
      "circle-stroke-width": 2,
      "circle-stroke-color": tokens.ink,
      // Up and right of the pin's head, so the price stays readable.
      "circle-translate": [11, -16],
      "circle-pitch-alignment": "viewport",
    },
  });
}

export default function SunChaserLayer({ map, venues }: { map: maplibregl.Map | null; venues: readonly Venue[] }) {
  const { estimates, offsetSteps, from } = useSunChaser();
  const venuesRef = useRef(venues);
  // Set when the estimates are out of date; the map's next settled frame redoes them.
  const dirtyRef = useRef(true);
  const venueKeyRef = useRef("");
  const byIdRef = useRef(new Map<string, Venue>());

  useEffect(() => {
    venuesRef.current = venues;
    byIdRef.current = new Map(venues.map((venue) => [venue.id, venue]));
  }, [venues]);

  // Work out the sun after each settled camera move, once its tiles are in.
  useEffect(() => {
    if (!map) return;
    dirtyRef.current = true;
    const markDirty = () => {
      dirtyRef.current = true;
    };
    const onIdle = () => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      computeEstimates(map, venuesRef.current);
    };
    const onStyle = () => {
      ensureLayer(map);
      dirtyRef.current = true;
    };
    map.on("moveend", markDirty);
    map.on("idle", onIdle);
    map.on("style.load", onStyle);
    if (map.isStyleLoaded()) ensureLayer(map);
    map.triggerRepaint();
    const refresh = window.setInterval(() => {
      dirtyRef.current = true;
      map.triggerRepaint();
    }, REFRESH_MS);
    return () => {
      window.clearInterval(refresh);
      map.off("moveend", markDirty);
      map.off("idle", onIdle);
      map.off("style.load", onStyle);
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // The map may already be gone.
      }
    };
  }, [map]);

  // A different set of pubs (a filter change) asks for a fresh read on the
  // next settled frame. A new array holding the same pubs asks for nothing,
  // because the list is rebuilt often and every read casts every ray again.
  useEffect(() => {
    const key = venues.map((venue) => venue.id).join(",");
    if (key === venueKeyRef.current) return;
    venueKeyRef.current = key;
    if (!map || getSunChaserState().status === "idle") return;
    dirtyRef.current = true;
    map.triggerRepaint();
  }, [map, venues]);

  // The cloud half: one read of the weather feed near the map centre.
  useEffect(() => {
    if (!map) return;
    const controller = new AbortController();
    const centre = map.getCenter();
    const query = new URLSearchParams({ lat: centre.lat.toFixed(3), lng: centre.lng.toFixed(3) });
    void loadSurfaceJson<{ summary?: { skyCondition?: unknown } | null }>(
      `/api/tonight-conditions?${query.toString()}`,
      {
        signal: controller.signal,
        init: { headers: { accept: "application/json" } },
        validate: (body) => Boolean(body && "summary" in body),
        freshForMs: SURFACE_JUST_READ_MS,
      },
      (body) => {
        if (controller.signal.aborted) return;
        const sky = body.summary?.skyCondition;
        updateSunChaser({ skyCondition: typeof sky === "string" ? sky : null });
      },
    );
    return () => controller.abort();
  }, [map]);

  // Draw the dots for the chosen time from the stored timelines: no new rays.
  useEffect(() => {
    if (!map) return;
    const at = sunChaserSelectedTime({ from, offsetSteps });
    const features: GeoJSON.Feature[] = [];
    if (at) {
      for (const [id, estimate] of estimates) {
        if (estimate.kind !== "estimate" || segmentAt(estimate.timeline, at)?.state !== "sun") continue;
        const venue = byIdRef.current.get(id);
        if (!venue) continue;
        features.push({
          type: "Feature",
          properties: { id },
          geometry: { type: "Point", coordinates: [venue.longitude, venue.latitude] },
        });
      }
    }
    if (!map.isStyleLoaded()) return;
    ensureLayer(map);
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features });
  }, [map, estimates, offsetSteps, from]);

  return null;
}
