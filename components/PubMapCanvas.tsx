"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl from "maplibre-gl";
import { ExternalLink, Landmark as LandmarkIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { landmarks, nearestStoryPubs, type Landmark } from "@/lib/landmarks";
import type { Venue } from "@/lib/venues";

type VenueSignal = { hasPintDrops: boolean; latestContributorPrice: number | null };

type PubMapCanvasProps = {
  venues: Venue[];
  route: Venue[];
  selectedVenueId: string;
  onVenueClick: (id: string) => void;
  onRouteStopClick: (id: string) => void;
  venueSignals?: Map<string, VenueSignal>;
  /** Optional: lets PubMap render the history card in its own panel instead. */
  onLandmarkSelect?: (landmark: Landmark | null) => void;
};

// CARTO vector GL styles — free, keyless, and their `carto.streets` source
// carries a `building` source-layer with render_height for fill-extrusion.
const MAP_STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

// PRD camera: pitched, slightly rotated London (londonszn uses 42/-12).
const LONDON_VIEW = {
  center: [-0.118, 51.512] as [number, number],
  zoom: 10.5,
  pitch: 45,
  bearing: -15,
};

const ORBIT_DEG_PER_SEC = 0.7; // gentle drift — a full turn in ~8.5 minutes
const ORBIT_RESUME_MS = 4500; // stillness before the orbit resumes

// Classic "marching ants" dash cycle for the brass route line.
const DASH_SEQ: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

type Tokens = {
  ink: string;
  inkDeep: string;
  paper: string;
  panelRaised: string;
  line: string;
  muted: string;
  pint: string;
  amber: string;
  brick: string;
  brass: string;
  brassBright: string;
  river: string;
  riverBright: string;
};

// Every map colour derives from the app's theme tokens so both modes
// (candle-lit night / positron day guidebook) flip from one system.
function readTokens(): Tokens {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    ink: token("--ink", "#1b2620"),
    inkDeep: token("--ink-deep", "#0f1c16"),
    paper: token("--paper", "#f4efe4"),
    panelRaised: token("--panel-raised", "#ffffff"),
    line: token("--line", "#ddd5c4"),
    muted: token("--muted", "#6b726a"),
    pint: token("--pint", "#2f8f5b"),
    amber: token("--amber", "#d99f45"),
    brick: token("--brick", "#d16353"),
    brass: token("--brass", "#b0813a"),
    brassBright: token("--brass-bright", "#d3a44a"),
    river: token("--river", "#2f6f8f"),
    riverBright: token("--river-bright", "#4f9ec4"),
  };
}

function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function priceBucket(price: number | null): number {
  if (price === null) return 3;
  if (price <= 5.5) return 0;
  if (price <= 7) return 1;
  return 2;
}

function pubsToGeoJSON(
  venues: Venue[],
  venueSignals: Map<string, VenueSignal>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: venues.map((venue) => {
      const signals = venueSignals.get(venue.id);
      return {
        type: "Feature" as const,
        properties: {
          id: venue.id,
          name: venue.name,
          bucket: priceBucket(signals?.latestContributorPrice ?? venue.cheapestPrice),
          story: venue.hasStory,
          drops: Boolean(signals?.hasPintDrops),
        },
        geometry: { type: "Point" as const, coordinates: [venue.longitude, venue.latitude] },
      };
    }),
  };
}

function routeToLine(route: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      route.length > 1
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: {
                type: "LineString" as const,
                coordinates: route.map((venue) => [venue.longitude, venue.latitude]),
              },
            },
          ]
        : [],
  };
}

function routeToStops(route: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: route.map((venue, index) => ({
      type: "Feature" as const,
      properties: { id: venue.id, label: String(index + 1) },
      geometry: { type: "Point" as const, coordinates: [venue.longitude, venue.latitude] },
    })),
  };
}

const LANDMARKS_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: landmarks.map((landmark) => ({
    type: "Feature",
    properties: { id: landmark.id, name: landmark.name },
    geometry: { type: "Point", coordinates: landmark.coordinates },
  })),
};

// A small brass compass-diamond glyph, drawn once per theme — a designed
// symbol layer, not a default marker.
function landmarkGlyph(fill: string, outline: string): ImageData {
  const size = 44; // rendered at pixelRatio 2 → 22 css px
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4);
  const half = size * 0.26;
  ctx.beginPath();
  ctx.rect(-half, -half, half * 2, half * 2);
  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
  ctx.rotate(-Math.PI / 4);
  ctx.beginPath();
  ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = outline;
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

export default function PubMapCanvas({
  venues,
  route,
  selectedVenueId,
  onVenueClick,
  onRouteStopClick,
  venueSignals = new Map(),
  onLandmarkSelect,
}: PubMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [activeLandmark, setActiveLandmark] = useState<Landmark | null>(null);
  const [heroDismissed, setHeroDismissed] = useState(false);

  const onVenueClickRef = useRef(onVenueClick);
  const onRouteStopClickRef = useRef(onRouteStopClick);
  const onLandmarkSelectRef = useRef(onLandmarkSelect);
  useEffect(() => {
    onVenueClickRef.current = onVenueClick;
    onRouteStopClickRef.current = onRouteStopClick;
    onLandmarkSelectRef.current = onLandmarkSelect;
  }, [onVenueClick, onRouteStopClick, onLandmarkSelect]);

  // Latest data lives in refs so buildScene can reseed sources after a
  // theme-driven setStyle wipes them.
  const pubsDataRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const routeLineRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const routeStopsRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const venuesRef = useRef(venues);
  useEffect(() => {
    venuesRef.current = venues;
  }, [venues]);
  const selectedIdRef = useRef(selectedVenueId);

  // Orbit state: the loop only drifts the bearing when now > holdUntil, so any
  // interaction or programmatic camera move simply pushes the hold forward —
  // the orbit never fights an easeTo.
  const holdUntilRef = useRef(0);
  const reducedRef = useRef(false);
  const themeRef = useRef<"dark" | "light">("dark");

  // Cinematic camera move that suspends the orbit for its duration + resume gap.
  const cinematic = useCallback((options: maplibregl.EaseToOptions) => {
    const map = mapRef.current;
    if (!map) return;
    const duration = reducedRef.current ? 0 : (options.duration ?? 1000);
    holdUntilRef.current = Math.max(
      holdUntilRef.current,
      performance.now() + duration + ORBIT_RESUME_MS,
    );
    map.easeTo({ ...options, duration });
  }, []);

  const selectLandmark = useCallback((landmark: Landmark | null) => {
    setActiveLandmark(landmark);
    onLandmarkSelectRef.current?.(landmark);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    themeRef.current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = reducedQuery.matches;
    const onReducedChange = () => {
      reducedRef.current = reducedQuery.matches;
    };
    reducedQuery.addEventListener("change", onReducedChange);

    // No-WebGL environments (locked-down browsers, headless boxes) throw
    // synchronously from the constructor; fall back to a styled notice.
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLES[themeRef.current],
        ...LONDON_VIEW,
        maxBounds: [
          [-0.55, 51.28],
          [0.35, 51.72],
        ],
      });
    } catch (error) {
      reducedQuery.removeEventListener("change", onReducedChange);
      queueMicrotask(() =>
        setMapError(
          error instanceof Error ? error.message : "Map could not start in this browser.",
        ),
      );
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    // Rebuilds the whole scene from theme tokens. Runs on first load and after
    // every theme-driven setStyle (style.load fires for both).
    const buildScene = () => {
      const tokens = readTokens();
      const dark = themeRef.current === "dark";

      // buildScene re-runs on every style.load. After a genuine setStyle swap
      // the old style's layers are gone (getLayer → undefined) so everything
      // re-adds with fresh tokens; on a duplicate pass the layer survives and
      // a bare addLayer would throw "Layer with id X already exists" inside
      // MapLibre's event dispatch, aborting the rest of the scene. getLayer
      // checks the CURRENT style state, so both paths are safe.
      const addLayerOnce = (...args: Parameters<typeof map.addLayer>) => {
        if (!map.getLayer(args[0].id)) map.addLayer(...args);
      };

      // --- Sky + fog: horizon depth in both moods.
      map.setSky({
        "sky-color": dark ? tokens.inkDeep : tokens.riverBright,
        "horizon-color": dark ? withAlpha(tokens.brass, 0.45) : tokens.paper,
        "fog-color": dark ? tokens.inkDeep : tokens.paper,
        "sky-horizon-blend": 0.7,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.4,
        "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 12, 0.2],
      });

      // --- 3-D buildings, extruded from the basemap's own building layer so
      // the City and Canary Wharf read as skyline when you fly in.
      const styleLayers = map.getStyle().layers;
      const firstSymbolId = styleLayers.find((layer) => layer.type === "symbol")?.id;
      const buildingLayer = styleLayers.find(
        (layer) =>
          layer.type === "fill" &&
          "source-layer" in layer &&
          layer["source-layer"] === "building",
      );
      if (buildingLayer && "source" in buildingLayer) {
        addLayerOnce(
          {
            id: "buildings-3d",
            type: "fill-extrusion",
            source: buildingLayer.source as string,
            "source-layer": "building",
            minzoom: 13,
            paint: {
              "fill-extrusion-color": dark ? tokens.panelRaised : tokens.line,
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                13,
                0,
                14.2,
                ["coalesce", ["get", "render_height"], ["get", "height"], 12],
              ],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": dark ? 0.55 : 0.4,
            },
          },
          firstSymbolId,
        );
      }

      // --- Landmarks + history layer: brass glyphs, tap for a sourced card.
      if (map.hasImage("landmark-glyph")) map.removeImage("landmark-glyph");
      map.addImage(
        "landmark-glyph",
        landmarkGlyph(tokens.brassBright, dark ? tokens.inkDeep : tokens.paper),
        { pixelRatio: 2 },
      );
      if (!map.getSource("landmarks")) {
        map.addSource("landmarks", { type: "geojson", data: LANDMARKS_GEOJSON });
      }
      addLayerOnce({
        id: "landmarks-icon",
        type: "symbol",
        source: "landmarks",
        layout: {
          "icon-image": "landmark-glyph",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.55, 13, 0.85],
          "icon-allow-overlap": true,
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 10.5,
          "text-letter-spacing": 0.04,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: {
          "text-color": tokens.ink,
          "text-halo-color": tokens.paper,
          "text-halo-width": 1.3,
        },
        minzoom: 9.5,
      });

      // --- Crawl route: solid brass underlay + animated brass dash on top.
      if (!map.getSource("route-line")) {
        map.addSource("route-line", { type: "geojson", data: routeLineRef.current });
      }
      addLayerOnce({
        id: "route-line",
        type: "line",
        source: "route-line",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": tokens.brass,
          "line-width": 4,
          "line-opacity": 0.3,
        },
      });
      addLayerOnce({
        id: "route-line-dash",
        type: "line",
        source: "route-line",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": tokens.brassBright,
          "line-width": 2.5,
          "line-opacity": 0.9,
          "line-dasharray": DASH_SEQ[0],
        },
      });

      // --- Pubs: clustered GeoJSON source + designed data-driven layers.
      if (!map.getSource("pubs")) {
        map.addSource("pubs", {
          type: "geojson",
          data: pubsDataRef.current,
          cluster: true,
          clusterRadius: 46,
          clusterMaxZoom: 13,
        });
      }
      // Distinct soft halo where the community has left Pint Drops.
      addLayerOnce({
        id: "pubs-drops-halo",
        type: "circle",
        source: "pubs",
        filter: ["all", ["!", ["has", "point_count"]], ["get", "drops"]],
        paint: {
          "circle-color": tokens.riverBright,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 9, 15, 14],
          "circle-opacity": 0.3,
          "circle-blur": 0.55,
        },
      });
      addLayerOnce({
        id: "pubs-point",
        type: "circle",
        source: "pubs",
        filter: ["!", ["has", "point_count"]],
        paint: {
          // Price-stamp fill: pint / amber / brick / muted by bucket.
          "circle-color": [
            "match",
            ["get", "bucket"],
            0,
            tokens.pint,
            1,
            tokens.amber,
            2,
            tokens.brick,
            tokens.muted,
          ],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 15, 8],
          // Brass stroke marks a story pub.
          "circle-stroke-color": ["case", ["get", "story"], tokens.brass, tokens.inkDeep],
          "circle-stroke-width": ["case", ["get", "story"], 2, 1],
          "circle-opacity": 0.94,
        },
      });
      // Brass ring on the selected pin.
      addLayerOnce({
        id: "pubs-selected",
        type: "circle",
        source: "pubs",
        filter: ["==", ["get", "id"], selectedIdRef.current],
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 14],
          "circle-stroke-color": tokens.brassBright,
          "circle-stroke-width": 2.5,
          "circle-stroke-opacity": 0.95,
        },
      });
      addLayerOnce({
        id: "clusters",
        type: "circle",
        source: "pubs",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": withAlpha(dark ? tokens.inkDeep : tokens.panelRaised, 0.88),
          "circle-stroke-color": tokens.brass,
          "circle-stroke-width": 1.5,
          "circle-radius": ["step", ["get", "point_count"], 16, 25, 22, 100, 30],
        },
      });
      addLayerOnce({
        id: "cluster-count",
        type: "symbol",
        source: "pubs",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 13,
        },
        paint: { "text-color": tokens.ink },
      });

      // --- Route stops (numbered) above everything.
      if (!map.getSource("route-stops")) {
        map.addSource("route-stops", { type: "geojson", data: routeStopsRef.current });
      }
      addLayerOnce({
        id: "route-stops",
        type: "circle",
        source: "route-stops",
        paint: {
          "circle-color": tokens.inkDeep,
          "circle-radius": 13,
          "circle-stroke-color": tokens.brassBright,
          "circle-stroke-width": 2.5,
        },
      });
      addLayerOnce({
        id: "route-stops-label",
        type: "symbol",
        source: "route-stops",
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 13,
          "text-allow-overlap": true,
        },
        // Stops are always dark-filled, so the label is the light-side token.
        paint: { "text-color": dark ? tokens.ink : tokens.paper },
      });

      setMapReady(true);
    };
    map.on("style.load", buildScene);

    // --- Click + cursor wiring (delegated by layer id; survives setStyle).
    map.on("click", "pubs-point", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id !== "string") return;
      selectLandmark(null); // the camera leaves the landmark; its card goes too
      onVenueClickRef.current(id);
    });
    map.on("click", "route-stops", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id !== "string") return;
      selectLandmark(null);
      onRouteStopClickRef.current(id);
    });
    map.on("click", "landmarks-icon", (event) => {
      const id = event.features?.[0]?.properties?.id;
      const landmark = landmarks.find((item) => item.id === id);
      if (!landmark) return;
      selectLandmark(landmark);
      cinematic({
        center: landmark.coordinates,
        zoom: Math.max(map.getZoom(), 13),
        pitch: 55,
        duration: 1100,
      });
    });
    map.on("click", "clusters", (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource("pubs") as maplibregl.GeoJSONSource;
      if (clusterId == null || !source) return;
      source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const [lng, lat] = (feature!.geometry as GeoJSON.Point).coordinates;
        cinematic({ center: [lng, lat], zoom, duration: 700 });
      });
    });
    for (const layer of ["pubs-point", "clusters", "route-stops", "landmarks-icon"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    // --- Idle orbit + dash animation: one RAF loop, no React re-renders.
    // User input (incl. the nav control) pushes holdUntil forward; the orbit
    // resumes after ORBIT_RESUME_MS of stillness. Reduced motion disables both.
    holdUntilRef.current = performance.now() + 2500; // let the first paint settle
    const onInteract = () => {
      holdUntilRef.current = Math.max(
        holdUntilRef.current,
        performance.now() + ORBIT_RESUME_MS,
      );
    };
    const interactionTarget = map.getContainer();
    const interactionEvents: (keyof HTMLElementEventMap)[] = [
      "pointerdown",
      "wheel",
      "touchstart",
      "keydown",
    ];
    for (const eventName of interactionEvents) {
      interactionTarget.addEventListener(eventName, onInteract, { passive: true });
    }

    let rafId = 0;
    let last = performance.now();
    let dashStep = 0;
    let dashAt = 0;
    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      const dt = Math.min(now - last, 100);
      last = now;
      // isStyleLoaded() is null-safe and false mid-swap; check it BEFORE
      // getLayer, which throws on the transiently-null style during a theme
      // setStyle({diff:false}) or on teardown.
      if (
        reducedRef.current ||
        document.hidden ||
        !map.isStyleLoaded() ||
        !map.getLayer("pubs-point")
      )
        return;
      if (now >= holdUntilRef.current) {
        map.setBearing(map.getBearing() - (ORBIT_DEG_PER_SEC * dt) / 1000);
      }
      if (now - dashAt > 90 && map.getLayer("route-line-dash")) {
        dashAt = now;
        dashStep = (dashStep + 1) % DASH_SEQ.length;
        map.setPaintProperty("route-line-dash", "line-dasharray", DASH_SEQ[dashStep]);
      }
    };
    rafId = requestAnimationFrame(frame);

    // --- Theme: watch html[data-theme]; setStyle re-triggers buildScene, which
    // re-reads the (already flipped) CSS tokens.
    const themeObserver = new MutationObserver(() => {
      const next = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      if (next === themeRef.current) return;
      themeRef.current = next;
      // diff: false forces a full style swap: old layers are always dropped
      // and style.load always fires, so buildScene deterministically rebuilds
      // every layer with the new theme's tokens (a successful diff would keep
      // stale-themed layers and skip style.load entirely).
      map.setStyle(MAP_STYLES[next], { diff: false });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      cancelAnimationFrame(rafId);
      themeObserver.disconnect();
      reducedQuery.removeEventListener("change", onReducedChange);
      for (const eventName of interactionEvents) {
        interactionTarget.removeEventListener(eventName, onInteract);
      }
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [cinematic, selectLandmark]);

  // Pubs data → source.
  useEffect(() => {
    pubsDataRef.current = pubsToGeoJSON(venues, venueSignals);
    if (!mapReady) return;
    (mapRef.current?.getSource("pubs") as maplibregl.GeoJSONSource | undefined)?.setData(
      pubsDataRef.current,
    );
  }, [venues, venueSignals, mapReady]);

  // Route + selection ring → sources/filter.
  useEffect(() => {
    routeLineRef.current = routeToLine(route);
    routeStopsRef.current = routeToStops(route);
    selectedIdRef.current = selectedVenueId;
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("route-line") as maplibregl.GeoJSONSource | undefined)?.setData(
      routeLineRef.current,
    );
    (map.getSource("route-stops") as maplibregl.GeoJSONSource | undefined)?.setData(
      routeStopsRef.current,
    );
    if (map.getLayer("pubs-selected")) {
      map.setFilter("pubs-selected", ["==", ["get", "id"], selectedVenueId]);
    }
  }, [route, selectedVenueId, mapReady]);

  // Frame the crawl when the route changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || route.length < 2) return;
    const bounds = new maplibregl.LngLatBounds();
    route.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    holdUntilRef.current = Math.max(
      holdUntilRef.current,
      performance.now() + 900 + ORBIT_RESUME_MS,
    );
    map.fitBounds(bounds, {
      padding: 90,
      maxZoom: 15,
      duration: reducedRef.current ? 0 : 800,
    });
  }, [route, mapReady]);

  // Cinematic fly-to on venue selection (after the route framing above).
  useEffect(() => {
    if (!selectedVenueId) return;
    // Any venue selection — map pin, route stop, or the sidebar list — retires
    // both overlay cards: the landmark story (H2) and the intro teaser (M5).
    queueMicrotask(() => {
      selectLandmark(null);
      setHeroDismissed(true);
    });
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const venue = venuesRef.current.find((item) => item.id === selectedVenueId);
    if (!venue) return;
    cinematic({
      center: [venue.longitude, venue.latitude],
      zoom: Math.max(map.getZoom(), 14),
      pitch: 50,
      duration: 1100,
    });
  }, [selectedVenueId, mapReady, cinematic, selectLandmark]);

  // H5: a tapped landmark surfaces its nearest story pubs (straight-line
  // distance — no routing, per PRD scope), wiring the history layer into the
  // heritage layer instead of leaving a dead-end Wikipedia card.
  const storyPubsNearby = useMemo(
    () => (activeLandmark ? nearestStoryPubs(activeLandmark, venues) : []),
    [activeLandmark, venues],
  );

  // M5 / PRD P1.5: one curated story venue greets the first paint. Prefer a
  // heritage pub the community has actually logged (Pint Drops), with the
  // Prospect of Whitby as the flagship tie-break.
  const heroVenue = useMemo(() => {
    const candidates = venues.filter(
      (venue) => venue.hasStory && venue.curation.heritageNote,
    );
    if (candidates.length === 0) return null;
    const score = (venue: Venue) =>
      (venueSignals.get(venue.id)?.hasPintDrops ? 2 : 0) +
      (venue.name.toLowerCase().includes("prospect of whitby") ? 1 : 0);
    return candidates.reduce((best, venue) => (score(venue) > score(best) ? venue : best));
  }, [venues, venueSignals]);

  if (mapError) {
    return (
      <div className="mapCanvasWrap">
        <div className="mapFallback" role="alert">
          <strong>Map renderer unavailable</strong>
          <p>
            This browser could not start the three-dimensional map — it needs WebGL.
            The pub list and crawl planner beside it still work as ever.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mapCanvasWrap">
      <div ref={containerRef} className="maplibreMap" />
      {activeLandmark ? (
        <aside className="landmarkCard" aria-label={`${activeLandmark.name} history`}>
          <div className="landmarkCardHead">
            <LandmarkIcon size={15} />
            <strong>{activeLandmark.name}</strong>
            <button
              type="button"
              onClick={() => selectLandmark(null)}
              aria-label="Close landmark history"
            >
              <X size={14} />
            </button>
          </div>
          <p>{activeLandmark.history}</p>
          <a href={activeLandmark.source.url} target="_blank" rel="noreferrer">
            Source: {activeLandmark.source.label}
            <ExternalLink size={12} />
          </a>
          {storyPubsNearby.length > 0 ? (
            <div className="landmarkNearby">
              <h4>Story pubs nearby</h4>
              {storyPubsNearby.map(({ venue, km }) => (
                <button
                  key={venue.id}
                  type="button"
                  onClick={() => {
                    selectLandmark(null);
                    onVenueClick(venue.id);
                  }}
                >
                  <span>{venue.name}</span>
                  <span>
                    {km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} straight-line
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </aside>
      ) : null}
      {heroVenue && !heroDismissed ? (
        <aside className="mapHeroCard" aria-label="Featured story pub">
          <div className="mapHeroCardHead">
            <span>{heroVenue.curation.heritageEra ?? "Story pub"}</span>
            <button
              type="button"
              onClick={() => setHeroDismissed(true)}
              aria-label="Dismiss featured story pub"
            >
              <X size={13} />
            </button>
          </div>
          <strong>{heroVenue.name}</strong>
          <p>{heroVenue.curation.heritageNote}</p>
          <button
            type="button"
            className="mapHeroVisit"
            onClick={() => onVenueClick(heroVenue.id)}
          >
            Visit
          </button>
        </aside>
      ) : null}
    </div>
  );
}
