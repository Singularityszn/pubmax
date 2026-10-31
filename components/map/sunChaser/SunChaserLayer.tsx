"use client";

// Sun Chaser's map half, loaded only while the chip is on. It reads building
// outlines and heights from the basemap's own vector tiles (the OpenMapTiles
// `building` layer, through lib/sunChaser.ts#sunBuildingFromTile), works out
// sun and shade for every pub in view with a recorded garden or outdoor
// seating, and draws a sun dot beside each pin likely in the sun at the chosen
// time. It draws nothing else and never moves the camera.

import { useEffect, useRef } from "react";
import type * as maplibregl from "maplibre-gl";
import { readTokens } from "@/components/map/canvas/tokens";
import {
  estimateSun,
  indexSunBuildings,
  segmentAt,
  sunBuildingFromTile,
  type LngLat,
  type SunBuilding,
  type SunEstimate,
} from "@/lib/sunChaser";
import { haversineKm } from "@/lib/haversine";
import { loadSurfaceJson, SURFACE_JUST_READ_MS } from "@/lib/surfaceDataCache";
import { venueHasRecordedOutdoorSpace, type Venue } from "@/lib/venues";
import { createSkyReader } from "./skyReader";
import { getSunChaserState, sunChaserSelectedTime, updateSunChaser, useSunChaser } from "./sunChaserStore";

/** The live map this layer reads, named here so PubMap needs no MapLibre import. */
export type SunChaserMap = maplibregl.Map;

const SOURCE_ID = "sun-chaser";
const LAYER_ID = "sun-chaser-dots";
/** The basemap's building layer holds outlines from here; below it a city of pubs is too many rays. */
const SUN_CHASER_MIN_ZOOM = 14;
/** The nearest gardens to the centre of the view, so a wide phone pan stays quick. */
const MAX_PUBS = 150;
/** Pubs worked out per slice before the browser gets its turn back. */
const PUBS_PER_SLICE = 15;
/** A new start time every few minutes, so "now" does not drift into the past. */
const REFRESH_MS = 5 * 60_000;
/** The sky is read again once the map centre has moved this far. */
const SKY_REREAD_KM = 1.5;
/** And at least this often while the map stands still. */
const SKY_REREAD_MS = 10 * 60_000;

function buildingSourceId(map: maplibregl.Map): string | null {
  const layer = map.getStyle()?.layers?.find(
    (candidate) => "source-layer" in candidate && candidate["source-layer"] === "building" && "source" in candidate,
  );
  return layer && "source" in layer && typeof layer.source === "string" ? layer.source : null;
}

function readBuildings(map: maplibregl.Map, sourceId: string): SunBuilding[] {
  const out: SunBuilding[] = [];
  for (const feature of map.querySourceFeatures(sourceId, { sourceLayer: "building" })) {
    const geometry = feature.geometry;
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    for (const polygon of polygons) {
      const rings = polygon.map((ring) => ring.map(([lng, lat]) => [lng, lat] as LngLat));
      if ((rings[0]?.length ?? 0) < 3) continue;
      const building = sunBuildingFromTile(feature.properties, rings, feature.id);
      if (building) out.push(building);
    }
  }
  return out;
}

/** Each new read gets a number, so a read overtaken by a newer one stops quietly. */
let latestRun = 0;

function computeEstimates(map: maplibregl.Map, venues: readonly Venue[]): void {
  const run = ++latestRun;
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
  const index = indexSunBuildings(sourceId ? readBuildings(map, sourceId) : []);
  // Only the view's own tiles are sure to be loaded, so the view is the loaded area.
  const loadedArea = { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() };
  const from = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const estimates = new Map<string, SunEstimate>();
  let next = 0;
  const slice = () => {
    if (run !== latestRun) return;
    for (const stop = Math.min(next + PUBS_PER_SLICE, gardens.length); next < stop; next += 1) {
      const venue = gardens[next];
      if (!venue) continue;
      const point: LngLat = [venue.longitude, venue.latitude];
      estimates.set(venue.id, estimateSun({
        point,
        hasRecordedOutdoorSpace: true,
        buildings: index.size > 0 ? index.near(point) : null,
        from,
        loadedArea,
      }));
    }
    if (next < gardens.length) {
      window.setTimeout(slice, 0);
      return;
    }
    updateSunChaser({ status: index.size > 0 ? "ready" : "no-buildings", estimates, from });
  };
  slice();
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
    // The renderer holds the zoom floor itself, so no dot shows mid-gesture
    // below the zoom the estimates were made for.
    minzoom: SUN_CHASER_MIN_ZOOM,
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
      // A slice still waiting for its turn stops when it sees a newer run.
      latestRun += 1;
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

  // The cloud half: the weather feed near the map centre. It is read again
  // after a long pan, so a note never belongs to another part of town, on a
  // timer, and when a suspended tab comes back. skyReader.ts drops a reading
  // the moment it passes its age limit, and owns the one expiry timer.
  useEffect(() => {
    if (!map) return;
    const reader = createSkyReader({
      load: (url, signal, onData) => {
        void loadSurfaceJson<Parameters<typeof onData>[0]>(
          url,
          {
            signal,
            init: { headers: { accept: "application/json" } },
            validate: (body) => Boolean(body && "summary" in body),
            freshForMs: SURFACE_JUST_READ_MS,
          },
          onData,
        );
      },
      update: updateSunChaser,
      now: () => Date.now(),
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (id) => window.clearTimeout(id),
    });
    let readAt: [number, number] | null = null;
    const readSky = (force = false) => {
      const centre = map.getCenter();
      const here: [number, number] = [centre.lng, centre.lat];
      if (!force && readAt && haversineKm(readAt, here) < SKY_REREAD_KM) return;
      readAt = here;
      reader.read(centre.lat, centre.lng);
    };
    const onMoveEnd = () => readSky();
    const onVisible = () => {
      if (document.visibilityState === "visible") readSky(true);
    };
    readSky();
    map.on("moveend", onMoveEnd);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => readSky(true), SKY_REREAD_MS);
    return () => {
      map.off("moveend", onMoveEnd);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
      reader.close();
    };
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
