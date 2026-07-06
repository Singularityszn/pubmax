"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl from "maplibre-gl";
import { Crosshair, ExternalLink, Landmark as LandmarkIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { landmarks, nearestStoryPubs, type Landmark } from "@/lib/landmarks";
import { priceForBeer } from "@/lib/beers";
import {
  loadPois,
  POI_CATEGORY_META,
  TRANSPORT_CATEGORIES,
  type Poi,
  type PoiCategory,
} from "@/lib/pois";
import { MAP_ICON_SPECS, iconId, rasterize, type IconTokens } from "@/lib/mapIcons";
import type { Venue } from "@/lib/venues";

type VenueSignal = { hasPintDrops: boolean; latestContributorPrice: number | null };

type PubMapCanvasProps = {
  venues: Venue[];
  route: Venue[];
  selectedVenueId: string;
  onVenueClick: (id: string) => void;
  onRouteStopClick: (id: string) => void;
  venueSignals?: Map<string, VenueSignal>;
  /** Canonical beer id (lib/beers). When set, pins re-price to it; non-serving pubs dim. */
  favoritePint?: string | null;
  /** Optional: lets PubMap render the history card in its own panel instead. */
  onLandmarkSelect?: (landmark: Landmark | null) => void;
};

// OpenFreeMap vector styles — truly keyless, MIT-licensed styles on ODbL/OSM
// data (free for commercial use, unlike CARTO's basemaps), and OpenMapTiles
// schema: a `building` source-layer with `render_height` for our 3-D extrusion.
// "liberty" is a rich, colourful consumer-map look (land-use tints, POI labels,
// road hierarchy); "dark" matches our candle-lit night mode.
const MAP_STYLES = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/liberty",
} as const;

// If OpenFreeMap (community-run) is slow or down, fall back to CARTO's keyless
// vector styles — same OpenMapTiles-ish `building` source-layer so 3-D buildings
// and buildScene keep working. Last resort after this is the WebGL notice.
const FALLBACK_STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;
const STYLE_LOAD_TIMEOUT_MS = 8000;

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
  favoritePint: string | null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: venues.map((venue) => {
      const signals = venueSignals.get(venue.id);
      // With a favorite pint chosen, price the pin by THAT beer; pubs that
      // don't serve it get serves=false → the paint dims them out.
      const beerPrice = favoritePint ? priceForBeer(venue, favoritePint) : null;
      const serves = !favoritePint || beerPrice !== null;
      const price = favoritePint
        ? beerPrice
        : signals?.latestContributorPrice ?? venue.cheapestPrice;
      return {
        type: "Feature" as const,
        properties: {
          id: venue.id,
          name: venue.name,
          bucket: priceBucket(price),
          story: venue.hasStory,
          drops: Boolean(signals?.hasPintDrops),
          serves,
        },
        geometry: { type: "Point" as const, coordinates: [venue.longitude, venue.latitude] },
      };
    }),
  };
}

// POIs → GeoJSON, one feature per point. category drives which layer/symbol it
// renders on; rank (1 = major interchange, 2 = minor) drives the zoom-depth
// reveal so the network reads wide and detail fills in as you zoom.
function poisToGeoJSON(pois: Poi[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pois.map((poi) => ({
      type: "Feature" as const,
      properties: {
        id: poi.id,
        name: poi.name,
        category: poi.category,
        rank: poi.rank ?? 2,
        // Ambient dot colour baked per-feature from the category palette so the
        // dot layer stays data-driven as new categories are added.
        color: POI_CATEGORY_META[poi.category].color,
      },
      geometry: { type: "Point" as const, coordinates: poi.coordinates },
    })),
  };
}

const POI_CATEGORIES: PoiCategory[] = [
  "tube",
  "rail",
  "bus",
  "river",
  "park",
  "garden",
  "market",
  "historic",
  "viewpoint",
  "sight",
];
// Ambient categories render as soft coloured dots; transport (TRANSPORT_CATEGORIES)
// render as their real TfL / National Rail symbol on separate layers.
const AMBIENT_CATEGORIES: readonly PoiCategory[] = [
  "park",
  "garden",
  "market",
  "historic",
  "viewpoint",
  "sight",
];

// A MapLibre filter keeping only the not-hidden categories within a given group
// (the transport symbols and the ambient dots live on different layers).
function poiFilter(
  hidden: Record<PoiCategory, boolean>,
  group: readonly PoiCategory[],
): maplibregl.FilterSpecification {
  const visible = group.filter((category) => !hidden[category]);
  return ["in", ["get", "category"], ["literal", visible]];
}

// Transport filter, split by rank so majors (the skeleton) and minors (revealed
// deeper) can sit on separate zoom-gated layers while both honour the toggles.
function transportFilter(
  hidden: Record<PoiCategory, boolean>,
  majorOnly: boolean,
): maplibregl.FilterSpecification {
  const visible = TRANSPORT_CATEGORIES.filter((category) => !hidden[category]);
  const inCategory: maplibregl.ExpressionSpecification = [
    "in",
    ["get", "category"],
    ["literal", visible],
  ];
  const rankTest: maplibregl.ExpressionSpecification = majorOnly
    ? ["==", ["coalesce", ["get", "rank"], 2], 1]
    : ["!=", ["coalesce", ["get", "rank"], 2], 1];
  return ["all", inCategory, rankTest];
}

// icon-image match for a transport feature → its TfL symbol id (lib/mapIcons).
const TRANSPORT_ICON_MATCH: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "category"],
  "tube",
  iconId("tfl", "underground"),
  "rail",
  iconId("tfl", "rail"),
  "bus",
  iconId("tfl", "bus"),
  "river",
  iconId("tfl", "river"),
  iconId("tfl", "underground"),
];

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

// Each landmark carries its own pictogram id (lib/mapIcons, ns "lm") so the
// symbol layer draws a recognisable Big Ben / dome / bridge / wheel silhouette
// per feature rather than one generic glyph.
const LANDMARKS_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: landmarks.map((landmark) => ({
    type: "Feature",
    properties: {
      id: landmark.id,
      name: landmark.name,
      icon: iconId("lm", landmark.icon),
    },
    geometry: { type: "Point", coordinates: landmark.coordinates },
  })),
};

// Register every designed marker image (landmark pictograms + TfL symbols) with
// the map, re-tinting from the live theme tokens. Called from buildScene on the
// first load and after each theme-driven setStyle (which wipes prior images).
function registerMapIcons(map: maplibregl.Map, tokens: IconTokens) {
  for (const spec of MAP_ICON_SPECS) {
    const id = iconId(spec.ns, spec.key);
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, rasterize(spec, tokens), { pixelRatio: 2 });
  }
}

export default function PubMapCanvas({
  venues,
  route,
  selectedVenueId,
  onVenueClick,
  onRouteStopClick,
  venueSignals = new Map(),
  favoritePint = null,
  onLandmarkSelect,
}: PubMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [activeLandmark, setActiveLandmark] = useState<Landmark | null>(null);
  const [heroDismissed, setHeroDismissed] = useState(false);
  // POI layer visibility — default all-on so "everything is there" on load,
  // but each category is togglable and zoom-gated so it never clutters.
  const [poiHidden, setPoiHidden] = useState<Record<PoiCategory, boolean>>({
    tube: false,
    rail: false,
    bus: false,
    river: false,
    park: false,
    garden: false,
    market: false,
    historic: false,
    viewpoint: false,
    sight: false,
  });
  const [activePoi, setActivePoi] = useState<{ name: string; category: PoiCategory } | null>(null);

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
  const poisDataRef = useRef<GeoJSON.FeatureCollection>({
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
  // buildScene reads this on every (re)build so a theme swap keeps the toggles.
  const poiHiddenRef = useRef(poiHidden);

  // Orbit state: the loop only drifts the bearing when now > holdUntil, so any
  // interaction or programmatic camera move simply pushes the hold forward —
  // the orbit never fights an easeTo.
  const holdUntilRef = useRef(0);
  const reducedRef = useRef(false);
  const blurredRef = useRef(false);
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

    // Window blur pauses the orbit (mirrors document.hidden); focus resumes
    // normal idle behaviour. Some browsers blur without hiding the tab.
    const onBlur = () => {
      blurredRef.current = true;
    };
    const onFocus = () => {
      blurredRef.current = false;
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

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
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
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
      // the City and Canary Wharf read as skyline when you fly in. If the style
      // already ships its own extrusion (OpenFreeMap Liberty has `building-3d`),
      // use that rather than stacking a second layer on top of it.
      const styleLayers = map.getStyle().layers;
      const firstSymbolId = styleLayers.find((layer) => layer.type === "symbol")?.id;
      const hasExtrusion = styleLayers.some((layer) => layer.type === "fill-extrusion");
      const buildingLayer = styleLayers.find(
        (layer) =>
          layer.type === "fill" &&
          "source-layer" in layer &&
          layer["source-layer"] === "building",
      );
      if (!hasExtrusion && buildingLayer && "source" in buildingLayer) {
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

      // --- London Underground / Overground / DLR / Elizabeth / Tram lines: the
      // real coloured transit network (open TfL/OSM geometry, official Colour
      // Standard hexes baked into each feature). A soft casing lifts every line
      // off the base; the colour layer sits under the pins. Northern's spec
      // black is remapped to light grey on the night map so it stays visible.
      // Toggled together with the Tube roundels.
      if (!map.getSource("tube-lines")) {
        map.addSource("tube-lines", {
          type: "geojson",
          data: "/data/tfl_lines.json",
          attribution: "Rail lines © TfL / OpenStreetMap contributors (ODbL)",
        });
      }
      const tubeVisibility: "none" | "visible" = poiHiddenRef.current.tube
        ? "none"
        : "visible";
      addLayerOnce({
        id: "tube-lines-casing",
        type: "line",
        source: "tube-lines",
        minzoom: 9.5,
        layout: { "line-cap": "round", "line-join": "round", visibility: tubeVisibility },
        paint: {
          "line-color": dark ? "rgba(9,15,12,0.6)" : "rgba(255,255,255,0.8)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9.5, 2.4, 13, 5.5, 16, 9],
          "line-opacity": 0.75,
        },
      });
      addLayerOnce({
        id: "tube-lines-color",
        type: "line",
        source: "tube-lines",
        minzoom: 9.5,
        layout: { "line-cap": "round", "line-join": "round", visibility: tubeVisibility },
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "color"], "#000000"],
            dark ? "#c9c9c9" : "#000000",
            ["get", "color"],
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 9.5, 1.1, 13, 3, 16, 5],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 9.5, 0.7, 13, 0.95],
        },
      });
      // Line names ride along the route once you zoom in — neutral, high-contrast
      // text (not the line colour, which is unreadable for yellow/pink lines) so
      // the network stays legible over the busy base.
      addLayerOnce({
        id: "tube-lines-label",
        type: "symbol",
        source: "tube-lines",
        minzoom: 13,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 420,
          "text-field": ["get", "line"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 9.5,
          "text-letter-spacing": 0.02,
          visibility: tubeVisibility,
        },
        paint: {
          "text-color": dark ? tokens.paper : tokens.ink,
          "text-halo-color": dark ? "rgba(9,15,12,0.92)" : "rgba(255,255,255,0.95)",
          "text-halo-width": 1.7,
        },
      });

      // --- Designed marker images: landmark pictograms + TfL symbols, re-tinted
      // from the live theme tokens (a setStyle wipes them, so re-register here).
      const iconTokens: IconTokens = {
        ink: tokens.ink,
        paper: dark ? tokens.inkDeep : tokens.paper,
        brass: tokens.brass,
        brassBright: tokens.brassBright,
        river: tokens.river,
        riverBright: tokens.riverBright,
      };
      registerMapIcons(map, iconTokens);

      // --- Landmarks + history layer: a recognisable pictogram per landmark
      // (Big Ben, St Paul's dome, Tower Bridge…), tap for a sourced history card.
      if (!map.getSource("landmarks")) {
        map.addSource("landmarks", { type: "geojson", data: LANDMARKS_GEOJSON });
      }
      addLayerOnce({
        id: "landmarks-icon",
        type: "symbol",
        source: "landmarks",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 13, 0.82, 16, 1],
          "icon-allow-overlap": true,
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 10.5,
          "text-letter-spacing": 0.04,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: {
          "text-color": tokens.ink,
          "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
          "text-halo-width": 1.3,
        },
        minzoom: 9.5,
      });

      // --- Points of interest. Transport (tube/rail/bus/river) render as their
      // real TfL / National Rail symbols on two zoom-gated layers: major
      // interchanges form the skeleton from a wide zoom, minor stops fade in as
      // you go deeper — a transit map revealing detail. Parks/sights stay soft
      // dots. All honour the category toggles (kept across theme rebuilds).
      if (!map.getSource("pois")) {
        map.addSource("pois", { type: "geojson", data: poisDataRef.current });
      }
      addLayerOnce({
        id: "pois-transport-major",
        type: "symbol",
        source: "pois",
        minzoom: 9.5,
        filter: transportFilter(poiHiddenRef.current, true),
        layout: {
          "icon-image": TRANSPORT_ICON_MATCH,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9.5, 0.4, 13, 0.62, 16, 0.78],
          "icon-allow-overlap": true,
        },
      });
      addLayerOnce({
        id: "pois-transport-minor",
        type: "symbol",
        source: "pois",
        minzoom: 12.4,
        filter: transportFilter(poiHiddenRef.current, false),
        layout: {
          "icon-image": TRANSPORT_ICON_MATCH,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 12.4, 0.42, 16, 0.66],
          "icon-allow-overlap": false,
        },
        paint: {
          "icon-opacity": ["interpolate", ["linear"], ["zoom"], 12.4, 0, 13.1, 1],
        },
      });
      addLayerOnce({
        id: "pois-transport-label",
        type: "symbol",
        source: "pois",
        minzoom: 13,
        filter: poiFilter(poiHiddenRef.current, TRANSPORT_CATEGORIES),
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 10,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: {
          "text-color": tokens.ink,
          "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
          "text-halo-width": 1.2,
        },
      });
      addLayerOnce({
        id: "pois-dot",
        type: "circle",
        source: "pois",
        minzoom: 11,
        filter: poiFilter(poiHiddenRef.current, AMBIENT_CATEGORIES),
        paint: {
          "circle-color": ["coalesce", ["get", "color"], tokens.muted],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 15, 6],
          "circle-opacity": 0.85,
          "circle-stroke-color": dark ? tokens.inkDeep : tokens.paper,
          "circle-stroke-width": 1.2,
        },
      });
      addLayerOnce({
        id: "pois-label",
        type: "symbol",
        source: "pois",
        minzoom: 12.5,
        filter: poiFilter(poiHiddenRef.current, AMBIENT_CATEGORIES),
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 10,
          "text-offset": [0, 0.9],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: {
          "text-color": tokens.ink,
          "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
          "text-halo-width": 1.2,
        },
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
      // Pint-Drops ring: a river-toned glow + a crisp outline so community
      // activity reads at a glance without muddying the price fill under it.
      addLayerOnce({
        id: "pubs-drops-halo",
        type: "circle",
        source: "pubs",
        filter: ["all", ["!", ["has", "point_count"]], ["get", "drops"]],
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 9, 15, 15],
          "circle-stroke-color": tokens.riverBright,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 15, 2],
          "circle-stroke-opacity": 0.7,
          "circle-blur": 0.2,
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
          // Radius eases up with zoom; story pubs sit a touch larger so
          // heritage carries physical weight, not just a stroke.
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            ["case", ["get", "story"], 5.5, 4.5],
            15,
            ["case", ["get", "story"], 9.5, 8],
          ],
          // Brass stroke marks a story pub; others get a thin theme-aware edge
          // so the fill stays crisp on both positron and dark-matter.
          "circle-stroke-color": [
            "case",
            ["get", "story"],
            tokens.brass,
            dark ? tokens.inkDeep : tokens.paper,
          ],
          "circle-stroke-width": ["case", ["get", "story"], 2, 1.1],
          // serves=false only when a favorite pint is chosen and this pub
          // doesn't pour it — dim it right down so the beer's map reads clearly.
          "circle-stroke-opacity": ["case", ["get", "serves"], 0.95, 0.22],
          "circle-opacity": ["case", ["get", "serves"], 0.95, 0.16],
        },
      });
      // Selected pin: a confident double brass ring — a soft outer wash plus a
      // bright inner edge — that lifts the choice above every other pin.
      addLayerOnce({
        id: "pubs-selected-glow",
        type: "circle",
        source: "pubs",
        filter: ["==", ["get", "id"], selectedIdRef.current],
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 15, 19],
          "circle-stroke-color": tokens.brass,
          "circle-stroke-width": 4,
          "circle-stroke-opacity": 0.35,
          "circle-blur": 0.3,
        },
      });
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
          "circle-stroke-opacity": 0.98,
        },
      });
      addLayerOnce({
        id: "clusters",
        type: "circle",
        source: "pubs",
        filter: ["has", "point_count"],
        paint: {
          // Brass-tinted well that deepens as more pubs pack in, with a
          // slightly heavier ring on the big clusters.
          "circle-color": [
            "step",
            ["get", "point_count"],
            withAlpha(dark ? tokens.inkDeep : tokens.panelRaised, 0.9),
            25,
            withAlpha(dark ? tokens.ink : tokens.paper, 0.92),
            100,
            withAlpha(tokens.brass, dark ? 0.32 : 0.28),
          ],
          "circle-stroke-color": tokens.brass,
          "circle-stroke-width": ["step", ["get", "point_count"], 1.5, 100, 2.5],
          "circle-stroke-opacity": 0.85,
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
          "text-size": ["step", ["get", "point_count"], 12, 25, 13, 100, 15],
          "text-letter-spacing": 0.02,
        },
        paint: {
          "text-color": tokens.ink,
          "text-halo-color": withAlpha(tokens.paper, 0.6),
          "text-halo-width": 0.8,
        },
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

    // --- Basemap fallback: OpenFreeMap is community-run, so if the primary style
    // hasn't loaded within a timeout (or errors before first load), swap to
    // CARTO's keyless styles; if that also fails, surface the same graceful
    // notice as a WebGL failure rather than a blank map.
    let styleLoaded = false;
    let usingFallback = false;
    let hardFailTimer: ReturnType<typeof setTimeout> | undefined;
    map.on("style.load", () => {
      styleLoaded = true;
      clearTimeout(fallbackTimer);
      if (hardFailTimer) clearTimeout(hardFailTimer);
    });
    const swapToBasemapFallback = () => {
      if (styleLoaded || usingFallback) return;
      usingFallback = true;
      map.setStyle(FALLBACK_STYLES[themeRef.current], { diff: false });
      hardFailTimer = setTimeout(() => {
        if (!styleLoaded) {
          queueMicrotask(() =>
            setMapError(
              "The map couldn't load its tiles right now — the pub list and crawl planner still work.",
            ),
          );
        }
      }, STYLE_LOAD_TIMEOUT_MS);
    };
    const fallbackTimer = setTimeout(swapToBasemapFallback, STYLE_LOAD_TIMEOUT_MS);
    // An error before the first style loads means the style URL itself failed;
    // tile hiccups after load are harmless and ignored.
    map.on("error", () => {
      if (!styleLoaded) swapToBasemapFallback();
    });

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
    // POI tap: a light name/category label (not the sourced-history card that
    // landmarks get) — POIs orient, pubs are the subject. Wired to the ambient
    // dots and both transport symbol layers so any station/pier is tappable.
    const onPoiClick = (event: maplibregl.MapLayerMouseEvent) => {
      const props = event.features?.[0]?.properties;
      const name = props?.name;
      const category = props?.category;
      if (typeof name !== "string" || typeof category !== "string") return;
      setActivePoi({ name, category: category as PoiCategory });
    };
    for (const layer of ["pois-dot", "pois-transport-major", "pois-transport-minor"]) {
      map.on("click", layer, onPoiClick);
    }
    for (const layer of [
      "pubs-point",
      "clusters",
      "route-stops",
      "landmarks-icon",
      "pois-dot",
      "pois-transport-major",
      "pois-transport-minor",
    ]) {
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
        blurredRef.current ||
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
      clearTimeout(fallbackTimer);
      if (hardFailTimer) clearTimeout(hardFailTimer);
      themeObserver.disconnect();
      reducedQuery.removeEventListener("change", onReducedChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      for (const eventName of interactionEvents) {
        interactionTarget.removeEventListener(eventName, onInteract);
      }
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [cinematic, selectLandmark]);

  // Pubs data → source. Rebuilds when the favorite pint changes so the price
  // buckets + serves flags re-derive against that beer.
  useEffect(() => {
    pubsDataRef.current = pubsToGeoJSON(venues, venueSignals, favoritePint);
    if (!mapReady) return;
    (mapRef.current?.getSource("pubs") as maplibregl.GeoJSONSource | undefined)?.setData(
      pubsDataRef.current,
    );
  }, [venues, venueSignals, favoritePint, mapReady]);

  // POIs load once (client fetch) and feed the "pois" source.
  useEffect(() => {
    let cancelled = false;
    loadPois()
      .then((pois) => {
        if (cancelled) return;
        poisDataRef.current = poisToGeoJSON(pois);
        (mapRef.current?.getSource("pois") as maplibregl.GeoJSONSource | undefined)?.setData(
          poisDataRef.current,
        );
      })
      .catch(() => {
        // ponytail: POIs are ambient garnish — a fetch failure just leaves the
        // pub map intact, no error surfaced.
      });
    return () => {
      cancelled = true;
    };
  }, [mapReady]);

  // POI category toggles → layer filters (kept in a ref for theme rebuilds).
  // Transport layers filter by category+rank; ambient dots by category only.
  useEffect(() => {
    poiHiddenRef.current = poiHidden;
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const ambient = poiFilter(poiHidden, AMBIENT_CATEGORIES);
    const transportAll = poiFilter(poiHidden, TRANSPORT_CATEGORIES);
    const setFilter = (layer: string, filter: maplibregl.FilterSpecification) => {
      if (map.getLayer(layer)) map.setFilter(layer, filter);
    };
    setFilter("pois-dot", ambient);
    setFilter("pois-label", ambient);
    setFilter("pois-transport-major", transportFilter(poiHidden, true));
    setFilter("pois-transport-minor", transportFilter(poiHidden, false));
    setFilter("pois-transport-label", transportAll);
    // The coloured tube-line network toggles with the Tube roundels.
    const tubeVisibility = poiHidden.tube ? "none" : "visible";
    for (const layer of ["tube-lines-casing", "tube-lines-color", "tube-lines-label"]) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", tubeVisibility);
    }
  }, [poiHidden, mapReady]);

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
    const selectedFilter: maplibregl.FilterSpecification = [
      "==",
      ["get", "id"],
      selectedVenueId,
    ];
    if (map.getLayer("pubs-selected-glow")) {
      map.setFilter("pubs-selected-glow", selectedFilter);
    }
    if (map.getLayer("pubs-selected")) {
      map.setFilter("pubs-selected", selectedFilter);
    }
  }, [route, selectedVenueId, mapReady]);

  // Shared fit logic: the route effect and the Recenter control both call this
  // so the framing behaviour stays identical. Reads the live route from a ref
  // so the button never needs a fresh closure.
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);
  const fitRoute = useCallback(() => {
    const map = mapRef.current;
    const current = routeRef.current;
    if (!map || current.length < 2) return;
    const bounds = new maplibregl.LngLatBounds();
    current.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    holdUntilRef.current = Math.max(
      holdUntilRef.current,
      performance.now() + 900 + ORBIT_RESUME_MS,
    );
    map.fitBounds(bounds, {
      padding: 90,
      maxZoom: 15,
      duration: reducedRef.current ? 0 : 800,
    });
  }, []);

  // Frame the crawl only when the route identity changes *materially* — the
  // ordered list of stop ids. Filters that churn the route array or a mere
  // selection change produce the same key, so the camera stays put while a user
  // tunes filters and pans. A curated-crawl load, near-me, or add/remove/reverse
  // all change the key and refit.
  // routeKey is the material identity; fitRoute is stable and reads the live
  // route via ref, so the effect only refits when the ordered stop ids change.
  const routeKey = route.map((venue) => venue.id).join(">");
  useEffect(() => {
    if (!mapReady) return;
    fitRoute();
  }, [routeKey, mapReady, fitRoute]);

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

  const canRecenter = route.length >= 2;

  return (
    <div className="mapCanvasWrap">
      <div ref={containerRef} className="maplibreMap" />
      {/* Recenter route: re-runs the same fit logic as the route effect.
          Self-contained (no parent prop); the nav control sits top-right so
          this tucks just under it. Disabled below two stops. */}
      <button
        type="button"
        className="mapRecenterBtn"
        onClick={fitRoute}
        disabled={!canRecenter}
        aria-label="Recenter route"
        title="Recenter route"
        style={{
          position: "absolute",
          top: 108,
          right: 10,
          zIndex: 455,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 9px",
          border: "1px solid var(--brass)",
          borderRadius: "var(--radius-sm)",
          background: "var(--panel-raised)",
          color: "var(--brass)",
          font: "inherit",
          fontSize: "0.72rem",
          fontWeight: 600,
          lineHeight: 1,
          boxShadow: "var(--shadow)",
          cursor: canRecenter ? "pointer" : "not-allowed",
          opacity: canRecenter ? 1 : 0.5,
          outline: "none",
        }}
        onMouseEnter={(event) => {
          if (canRecenter) event.currentTarget.style.background = "var(--brass)";
          if (canRecenter) event.currentTarget.style.color = "var(--paper)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "var(--panel-raised)";
          event.currentTarget.style.color = "var(--brass)";
        }}
        onFocus={(event) => {
          event.currentTarget.style.boxShadow = "0 0 0 2px var(--brass-bright)";
        }}
        onBlur={(event) => {
          event.currentTarget.style.boxShadow = "var(--shadow)";
        }}
      >
        <Crosshair size={14} aria-hidden />
        Recenter
      </button>
      {activeLandmark ? (
        <aside className="landmarkCard" aria-label={`${activeLandmark.name} history`}>
          {activeLandmark.image ? (
            <figure className="landmarkPhoto">
              {/* Plain <img> (not next/image): a remote Wikimedia URL loaded
                  lazily, so no remotePatterns config and no layout cost until the
                  card opens. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeLandmark.image.url}
                alt={activeLandmark.name}
                loading="lazy"
                decoding="async"
              />
              <figcaption>Photo · {activeLandmark.image.credit}</figcaption>
            </figure>
          ) : null}
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
      {/* POI category toggles — everything's on by default; tap to hide a kind. */}
      <div className="poiToggle" role="group" aria-label="Points of interest">
        {POI_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className={poiHidden[category] ? "poiToggleBtn" : "poiToggleBtn on"}
            aria-pressed={!poiHidden[category]}
            onClick={() =>
              setPoiHidden((hidden) => ({ ...hidden, [category]: !hidden[category] }))
            }
          >
            <span
              className="poiSwatch"
              style={{ background: POI_CATEGORY_META[category].color }}
            />
            {POI_CATEGORY_META[category].label}
          </button>
        ))}
      </div>
      {activePoi ? (
        <div className="poiLabelCard" role="status">
          <span
            className="poiSwatch"
            style={{ background: POI_CATEGORY_META[activePoi.category].color }}
          />
          <strong>{activePoi.name}</strong>
          <span className="poiKind">{POI_CATEGORY_META[activePoi.category].label}</span>
          <button type="button" onClick={() => setActivePoi(null)} aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
