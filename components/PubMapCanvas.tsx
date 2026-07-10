"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "./map/mapColor.css";

import Link from "next/link";
import maplibregl from "maplibre-gl";
import {
  Crosshair,
  ExternalLink,
  Landmark as LandmarkIcon,
  MapPinned,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { applyBasemapTaste, clusterCircleColorExpr } from "@/lib/mapBasemapTaste";
import { landmarks as londonLandmarks, nearestStoryPubs, type Landmark } from "@/lib/landmarks";
import {
  bandAnchors,
  bandMemberPubs,
  STORY_BANDS as LONDON_STORY_BANDS,
  type StoryBand,
} from "@/lib/storyBands";
import { offsetIndexForLine } from "@/lib/tubeOffsets";
import { priceForBeer } from "@/lib/beers";
import {
  loadPoisFromPath,
  LONDON_POIS_PATH,
  POI_CATEGORY_META,
  TRANSPORT_CATEGORIES,
  type Poi,
  type PoiCategory,
} from "@/lib/pois";
import {
  MAP_ICON_SPECS,
  drinkPinIconKey,
  drinkPinKindFromCategories,
  iconId,
  rasterize,
  type IconTokens,
} from "@/lib/mapIcons";
import {
  defaultPoiHidden,
  defaultPoiHiddenForViewport,
  defaultPoiHiddenMobile,
  isTransitNetworkVisible,
} from "@/lib/poiToggleGroups";
import MapLayersControl from "@/components/map/MapLayersControl";
import {
  CATEGORY_COLORS,
  categoryVar,
  type DrinkCategory,
} from "@/lib/categoryColors";
import { formatPrice, type Venue } from "@/lib/venues";
import { directVenueImageUrl } from "@/lib/venueImages";

type VenueSignal = {
  hasPintDrops: boolean;
  latestContributorPrice: number | null;
  /** Display-only demo price for pin colour when cheapestPrice is null. */
  latestDemoPrice?: number | null;
};
type HoveredVenue = { id: string; name: string; x: number; y: number };
type VenueDetailResponse = { venue?: Venue | null };
type FailedHoverImage = { venueId: string; url: string };

type PubMapCanvasProps = {
  venues: Venue[];
  route: Venue[];
  selectedVenueId: string;
  onVenueClick: (id: string) => void;
  onRouteStopClick: (id: string) => void;
  /** Speculative warm of `/api/venue/[id]` on press-start / hover intent. */
  onVenuePrefetch?: (id: string) => void;
  venueSignals?: Map<string, VenueSignal>;
  /** Canonical beer id (lib/beers). When set, pins re-price to it; non-serving pubs dim. */
  favoritePint?: string | null;
  /**
   * Active drink-lens category (Wave F1). Non-beer lenses prefer that category's
   * glyph; pin prices stay on the beer/pint path — never fake brand pricing.
   */
  drinkCategory?: string | null;
  /** Optional: lets PubMap render the history card in its own panel instead. */
  onLandmarkSelect?: (landmark: Landmark | null) => void;
  /** Issue #15 story bands — active band id ("" = none), synced to the URL by PubMap. */
  activeBandId?: string;
  /** Called when the band picker changes the active band. */
  onBandChange?: (bandId: string) => void;
  /** "Start a crawl here" from a landmark card — receives 2-3 nearest pub ids. */
  onStartCrawl?: (pubIds: string[]) => void;
  /** "Ask the PUBMAXXER" from a landmark card — receives the nearest story pub id. */
  onAskPubmaxxer?: (venueId: string) => void;
  /** Deep-link a landmark history card open on arrival (`?landmark=`). */
  initialLandmarkId?: string;
  /** Wave K2 — parent keeps the loading chrome until WebGL style + scene are ready. */
  onMapReady?: (ready: boolean) => void;
  /**
   * Opening camera from CityConfig.mapView. Defaults to London for back-compat
   * when the multi-city router has not wired a city yet.
   */
  mapView?: {
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
  };
  /**
   * MapLibre maxBounds [[west, south], [east, north]] from CityConfig.bounds
   * (via cityMaxBounds). Defaults to Greater London.
   */
  maxBounds?: [[number, number], [number, number]];
  /**
   * Optional POI JSON path from CityConfig.poisPath. `null` skips the London
   * POI fetch so non-London cities do not 404 on `/data/london_pois.json`.
   * Omit / undefined keeps the London default for back-compat.
   */
  poisPath?: string | null;
  /**
   * Optional transit GeoJSON path from CityConfig.transitLinesPath. `null`
   * skips TfL tube-line layers. Omit / undefined keeps London TfL default.
   */
  transitLinesPath?: string | null;
  /**
   * City landmark catalog (from landmarksForCity). Defaults to London.
   * Empty array skips the landmark layer entirely.
   */
  cityLandmarks?: Landmark[];
  /**
   * City Place-story corridors (from storyBandsForCity). Defaults to London.
   */
  cityStoryBands?: StoryBand[];
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

// Wider first view so outer boroughs (Barnet, Croydon, …) read at a glance —
// still centred on the river, but zoomed out enough that Zone 1 isn't the
// whole story on first paint (outer-London coverage P0).
const LONDON_VIEW = {
  center: [-0.12, 51.52] as [number, number],
  zoom: 9.85,
  pitch: 42,
  bearing: -12,
};
const LONDON_BOUNDS: [[number, number], [number, number]] = [
  [-0.55, 51.28],
  [0.35, 51.72],
];

const ORBIT_DEG_PER_SEC = 0.7; // gentle drift — a full turn in ~8.5 minutes
const ORBIT_RESUME_MS = 4500; // stillness before the orbit resumes
const HOVER_DETAIL_CACHE_LIMIT = 24;
const HOVER_CARD_VIEWPORT_GUTTER_PX = 16;
const HOVER_CARD_WIDTH_PX = 292;
const HOVER_CARD_HEIGHT_PX = 120;
const HOVER_CARD_MIN_TOP_PX = 84;
const HOVER_CARD_X_OFFSET_PX = 18;
const HOVER_CARD_Y_OFFSET_PX = -30;

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
  // Drink-category accents (E5). ADDITIVE — resolves the live `--cat-*` vars
  // (lib/categoryColors.ts) into the map's token object so a future
  // pin-by-category paint tints a pin by a venue's dominant drink family from
  // the SAME light/dark/legacy source the venue-sheet swatches use. Not wired
  // into any live paint yet: the Venue model carries no honest dominant category
  // (see the ready-to-apply patch in components/map/mapColor.css), and the
  // honesty rule is never to colour a pin by a guessed category.
  cat: Record<DrinkCategory, string>;
};

// Every map colour derives from the app's theme tokens so both modes
// (candle-lit night / positron day guidebook) flip from one system.
function readTokens(): Tokens {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  // Additive `--cat-*` read: one entry per drink family, resolved from the live
  // computed vars (with the canonical light hex as a fallback) so map consumers
  // never re-hardcode a category palette.
  const cat = Object.fromEntries(
    (Object.keys(CATEGORY_COLORS) as DrinkCategory[]).map((c) => [
      c,
      token(categoryVar(c), CATEGORY_COLORS[c].light),
    ]),
  ) as Record<DrinkCategory, string>;
  return {
    cat,
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

function withBoundedHoverDetailCache(
  details: Map<string, Venue | null>,
  id: string,
  venue: Venue | null,
): Map<string, Venue | null> {
  const next = new Map(details);
  next.delete(id);
  next.set(id, venue);
  while (next.size > HOVER_DETAIL_CACHE_LIMIT) {
    const oldestId = next.keys().next().value;
    if (oldestId === undefined) break;
    next.delete(oldestId);
  }
  return next;
}

function hoverImageUrlFor(
  hoverDetail: Venue | null | undefined,
  failedImage: FailedHoverImage | null,
  hoveredVenueId: string | null,
): string {
  const src = directVenueImageUrl(hoverDetail?.imageUrl ?? "");
  if (failedImage?.venueId === hoveredVenueId && failedImage.url === src) return "";
  return src;
}

function pubsToGeoJSON(
  venues: Venue[],
  venueSignals: Map<string, VenueSignal>,
  favoritePint: string | null,
  drinkCategory: string | null = null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: venues.map((venue) => {
      const signals = venueSignals.get(venue.id);
      // Beer favorite-pint path only: re-price + dim non-servers. Non-beer
      // drink/brand lenses filter via filterVenues — never invent brand prices.
      const beerPrice = favoritePint ? priceForBeer(venue, favoritePint) : null;
      const serves = !favoritePint || beerPrice !== null;
      // Contributor price wins; then slim-index cheapestPrice; then an honest
      // demo seed price so city packs with null cheapestPrice still colour pins.
      // Demo never merges into venue.cheapestPrice (mergeVenueDrops ignores it).
      const price = favoritePint
        ? beerPrice
        : signals?.latestContributorPrice ??
          venue.cheapestPrice ??
          signals?.latestDemoPrice ??
          null;
      const bucket = priceBucket(price);
      // Prefer the active non-beer lens for the glyph so gin/wine/etc. read
      // honestly on the map; otherwise fall back to venue hint categories.
      const lens = drinkCategory?.trim().toLowerCase() ?? "";
      const drinkKind =
        lens && lens !== "beer" && lens !== "other"
          ? drinkPinKindFromCategories(
              [lens],
              lens === "cocktail" ||
                Boolean(venue.amenities.cocktails) ||
                Boolean(venue.filterHints?.amenities.cocktails),
            )
          : drinkPinKindFromCategories(
              venue.filterHints?.drinkCategories,
              Boolean(venue.amenities.cocktails) ||
                Boolean(venue.filterHints?.amenities.cocktails),
            );
      return {
        type: "Feature" as const,
        properties: {
          id: venue.id,
          name: venue.name,
          bucket,
          story: venue.hasStory,
          drops: Boolean(signals?.hasPintDrops),
          serves,
          drinkKind,
          icon: iconId("drink", drinkPinIconKey(drinkKind, bucket)),
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

// Issue #16 — parallel coloured tube lines. The known sub-surface fan lines
// (Metropolitan / Circle / H&C / District) run four-abreast through shared
// central corridors; we fan them apart with a per-line `line-offset` so they
// read side-by-side like the real tube map instead of one overlapping stroke.
//
// Offset math: offsetIndexForLine(line) gives a symmetric index (…-1.5, -0.5,
// 0.5, 1.5) for the fan lines and 0 for everything else. We turn that index into
// a MapLibre `match` expression, then multiply by a zoom-scaled pixel step so
// the lines CONVERGE at low zoom (network reads as one line) and FAN OUT from
// ~zoom 12 (the corridor separates). Documented ceiling: the source geometry is
// per-line from independent OSM ways and rarely shares vertices, so we offset
// the whole line by its fan index rather than per-shared-segment — the accepted
// ceiling in issue #16.
const FAN_LINES = ["Metropolitan", "Circle", "Hammersmith & City", "District"] as const;

// A `["match", ["get","line"], name, index, …, 0]` expression: each fan line to
// its offset index, all others to 0. Built once (module const) from the pure
// offsetIndexForLine so the map and the unit-tested logic never drift.
const TUBE_OFFSET_INDEX_EXPR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "line"],
  ...FAN_LINES.flatMap((line) => [line, offsetIndexForLine(line)] as [string, number]).flat(),
  0,
] as unknown as maplibregl.ExpressionSpecification;

// The signed pixel offset for a line at the current zoom: offsetIndex × a
// zoom-interpolated per-index step. At/below zoom 11 the step is 0 (lines
// converge); it grows to a full fan by zoom 14. `line-offset` is in pixels and
// perpendicular to the line, so a symmetric index set fans the group evenly.
const TUBE_LINE_OFFSET_EXPR: maplibregl.ExpressionSpecification = [
  "*",
  TUBE_OFFSET_INDEX_EXPR,
  ["interpolate", ["linear"], ["zoom"], 11, 0, 12, 1.4, 14, 3.2, 16, 4.5],
] as unknown as maplibregl.ExpressionSpecification;

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

// Issue #15 story bands — the tinted corridor through a band's anchor landmarks.
// A simple polyline joining the anchors in order: the map draws it as a soft,
// low-opacity token-tinted stroke UNDER the pins so it hints at the walk without
// fighting the price-colour fill. Empty when the band resolves to <2 anchors.
function bandCorridorGeoJSON(
  band: StoryBand | undefined,
  catalog: readonly Landmark[],
): GeoJSON.FeatureCollection {
  if (!band) return { type: "FeatureCollection", features: [] };
  const anchors = bandAnchors(band, catalog);
  if (anchors.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: anchors.map((lm) => lm.coordinates),
        },
      },
    ],
  };
}

function landmarksToGeoJSON(catalog: readonly Landmark[]): GeoJSON.FeatureCollection {
  // Each landmark carries its own pictogram id (lib/mapIcons, ns "lm") so the
  // symbol layer draws a recognisable silhouette per feature.
  return {
    type: "FeatureCollection",
    features: catalog.map((landmark) => ({
      type: "Feature",
      properties: {
        id: landmark.id,
        name: landmark.name,
        icon: iconId("lm", landmark.icon),
      },
      geometry: { type: "Point", coordinates: landmark.coordinates },
    })),
  };
}

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
  onVenuePrefetch,
  venueSignals = new Map(),
  favoritePint = null,
  drinkCategory = null,
  onLandmarkSelect,
  activeBandId = "",
  onBandChange,
  onStartCrawl,
  onAskPubmaxxer,
  initialLandmarkId = "",
  onMapReady,
  mapView = LONDON_VIEW,
  maxBounds = LONDON_BOUNDS,
  poisPath = LONDON_POIS_PATH,
  transitLinesPath = "/data/tfl_lines.json",
  cityLandmarks = londonLandmarks,
  cityStoryBands = LONDON_STORY_BANDS,
}: PubMapCanvasProps) {
  const showLandmarks = cityLandmarks.length > 0;
  const landmarkById = useCallback(
    (id: string | null | undefined) =>
      id ? cityLandmarks.find((lm) => lm.id === id) : undefined,
    [cityLandmarks],
  );
  const bandById = useCallback(
    (id: string | null | undefined) =>
      id ? cityStoryBands.find((band) => band.id === id) : undefined,
    [cityStoryBands],
  );
  const landmarksGeoJSON = useMemo(
    () => landmarksToGeoJSON(cityLandmarks),
    [cityLandmarks],
  );
  // Refs for camera/bounds + landmark seed so the MapLibre mount effect does not
  // tear down on parent re-renders that only change object identity.
  const mapViewRef = useRef(mapView);
  const maxBoundsRef = useRef(maxBounds);
  const landmarksGeoJSONRef = useRef(landmarksGeoJSON);
  useEffect(() => {
    mapViewRef.current = mapView;
    maxBoundsRef.current = maxBounds;
    landmarksGeoJSONRef.current = landmarksGeoJSON;
  }, [mapView, maxBounds, landmarksGeoJSON]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // Keep the latest parent callback without reading/writing refs during render
  // (react-hooks/refs). Build/event handlers + error paths read this when ready flips.
  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);
  const publishMapReady = useCallback((ready: boolean) => {
    setMapReady(ready);
    onMapReadyRef.current?.(ready);
  }, []);
  // The fallback is a real user-facing dead end, so it carries enough to be
  // honest about *why*: `kind` drives the copy (only "constructor" with a
  // confirmed-dead probe may claim "needs WebGL"), `detail` surfaces the raw
  // browser diagnostic, and it never fires on a transient GPU hiccup because
  // the mount effect auto-retries once before ever setting this.
  const [mapError, setMapError] = useState<{
    message: string;
    detail?: string;
    kind: "constructor" | "zero-size" | "context-lost" | "tiles";
    // true only when the detached-canvas probe returned no context at all, so
    // Retry would be pointless — this is the sole case that hides the button.
    noWebgl?: boolean;
  } | null>(null);
  const reportMapError = useCallback(
    (error: NonNullable<typeof mapError>) => {
      // Lift the parent's loading chrome so this honest error card is visible
      // (Wave K2 kept the overlay until mapReady — failures must still resolve it).
      publishMapReady(true);
      setMapError(error);
    },
    [publishMapReady],
  );
  // Bumped to re-run the mount effect: once silently (auto-retry after a
  // constructor throw) and again on the user's Retry click. The cleanup fully
  // tears the map down, so each bump is a clean re-init.
  const [initAttempt, setInitAttempt] = useState(0);
  const [activeLandmark, setActiveLandmark] = useState<Landmark | null>(() =>
    initialLandmarkId ? landmarkById(initialLandmarkId) ?? null : null,
  );
  const [heroDismissed, setHeroDismissed] = useState(false);
  const [hoveredVenue, setHoveredVenue] = useState<HoveredVenue | null>(null);
  const hoveredVenueId = hoveredVenue?.id ?? null;
  const [hoverDetails, setHoverDetails] = useState<Map<string, Venue | null>>(
    () => new Map(),
  );
  const hoverDetailsRef = useRef(hoverDetails);
  const [failedHoverImage, setFailedHoverImage] = useState<FailedHoverImage | null>(null);
  // POI layer visibility — seed from the live viewport so desktop doesn't flash
  // all-hidden, while mobile first paint stays clean (all categories off).
  // Only rewrite defaults when the viewport band actually changes — never on
  // every mount tick (a fresh object would re-filter layers and look like flicker).
  const [poiHidden, setPoiHidden] = useState<Record<PoiCategory, boolean>>(
    defaultPoiHiddenForViewport,
  );
  const poiViewportMobileRef = useRef<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => {
      const isMobile = mq.matches;
      if (poiViewportMobileRef.current === isMobile) return;
      poiViewportMobileRef.current = isMobile;
      const next = isMobile ? defaultPoiHiddenMobile() : defaultPoiHidden();
      // Defer setState out of the effect body (react-hooks/set-state-in-effect).
      void Promise.resolve().then(() => setPoiHidden(next));
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  // Open when a band is already active (e.g. `?band=` deep link). Layers owns
  // the corridor picker UI; canvas only paints the active corridor.
  const [activePoi, setActivePoi] = useState<{ name: string; category: PoiCategory } | null>(null);

  const onVenueClickRef = useRef(onVenueClick);
  const onRouteStopClickRef = useRef(onRouteStopClick);
  const onVenuePrefetchRef = useRef(onVenuePrefetch);
  const onLandmarkSelectRef = useRef(onLandmarkSelect);
  const cityLandmarksRef = useRef(cityLandmarks);
  const hoverDetailLoadingRef = useRef<Set<string>>(new Set());
  const rememberHoverDetail = useCallback((id: string, venue: Venue | null) => {
    const next = withBoundedHoverDetailCache(hoverDetailsRef.current, id, venue);
    hoverDetailsRef.current = next;
    setHoverDetails(next);
  }, []);
  useEffect(() => {
    onVenueClickRef.current = onVenueClick;
    onRouteStopClickRef.current = onRouteStopClick;
    onVenuePrefetchRef.current = onVenuePrefetch;
    onLandmarkSelectRef.current = onLandmarkSelect;
    cityLandmarksRef.current = cityLandmarks;
  }, [onVenueClick, onRouteStopClick, onVenuePrefetch, onLandmarkSelect, cityLandmarks]);

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
  // Story-band corridor (a tinted line through the anchors); reseeded after a
  // theme setStyle wipes sources, same pattern as the other data refs.
  const bandCorridorRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  // The active band's token colour, read into the corridor + member-halo paint
  // on each build (a setStyle rebuild re-reads it from the live tokens).
  const bandColorRef = useRef<string>("#b0813a");
  // Member pub ids of the active band under the CURRENT filters — drives the
  // halo layer's filter. Empty = no halo (and the picker shows the honest
  // "no pubs visible" fallback).
  const bandMemberIdsRef = useRef<string[]>([]);
  const venuesRef = useRef(venues);
  useEffect(() => {
    venuesRef.current = venues;
  }, [venues]);
  const selectedIdRef = useRef(selectedVenueId);
  // buildScene reads this on every (re)build so a theme swap keeps the toggles.
  const poiHiddenRef = useRef(poiHidden);

  // Style-load gate. Every source/layer mutation (setData, setFilter,
  // setPaintProperty, setLayoutProperty) throws "Style is not done loading" if
  // it lands while a style is mid-load — the initial load, or the theme
  // setStyle({diff:false}) swap window, during which `mapReady` is still true.
  // The data effects fire on their own React cadence (slim→full venues, live
  // drops, selection, filters), so any can arrive in that window. `applyToMap`
  // runs the mutation now when the style is loaded, else queues it (keyed, so a
  // rapid churn collapses to the latest write) to flush on the next style.load.
  // This is the honest fix for the race: no update is dropped, none races the
  // swap. buildScene re-seeds SOURCES from the data refs on style.load, so the
  // queue only needs to carry post-build mutations (filters/paint/visibility)
  // and any setData that raced an in-flight swap.
  const pendingUpdatesRef = useRef<Map<string, (map: maplibregl.Map) => void>>(new Map());
  const applyToMap = useCallback(
    (key: string, fn: (map: maplibregl.Map) => void) => {
      const map = mapRef.current;
      if (!map) return;
      if (map.isStyleLoaded()) {
        fn(map);
      } else {
        pendingUpdatesRef.current.set(key, fn);
      }
    },
    [],
  );

  // Orbit state: the loop only drifts the bearing when now > holdUntil, so any
  // interaction or programmatic camera move simply pushes the hold forward —
  // the orbit never fights an easeTo.
  const holdUntilRef = useRef(0);
  const reducedRef = useRef(false);
  const blurredRef = useRef(false);
  const themeRef = useRef<"dark" | "light">("dark");
  const hoverCapableRef = useRef(false);

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
    if (!initialLandmarkId || !mapReady) return;
    const landmark = landmarkById(initialLandmarkId);
    if (!landmark) return;
    const map = mapRef.current;
    if (map) {
      map.easeTo({ center: landmark.coordinates, zoom: 15, duration: 800 });
    }
  }, [initialLandmarkId, mapReady, landmarkById]);

  useEffect(() => {
    if (!hoveredVenueId) return;
    const id = hoveredVenueId;
    if (
      hoverDetailsRef.current.has(id) ||
      hoverDetailLoadingRef.current.has(id)
    ) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    hoverDetailLoadingRef.current.add(id);

    fetch(`/api/venue/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as VenueDetailResponse;
        return payload.venue ?? null;
      })
      .then((venue) => {
        rememberHoverDetail(id, venue);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        rememberHoverDetail(id, null);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        hoverDetailLoadingRef.current.delete(id);
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [hoveredVenueId, rememberHoverDetail]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    themeRef.current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    hoverCapableRef.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
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

    // Timers/observers this effect owns; cleanup below tears them all down so a
    // re-run (theme dep change, auto-retry, or Retry click) starts clean.
    let sizeObserver: ResizeObserver | undefined;
    let sizeProceedTimer: ReturnType<typeof setTimeout> | undefined;
    let autoRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let contextLostTimer: ReturnType<typeof setTimeout> | undefined;
    let didConstruct = false;
    let constructCleanup: (() => void) | undefined;

    // --- Size gate. `.mapStage` is `absolute inset:0` inside a 100vh shell, so
    // it should be sized at mount — but if the shell hasn't laid out yet MapLibre
    // would build against a 0×0 canvas and paint nothing. Rather than construct
    // blind, wait (briefly) for a real box. This eliminates the 0-size hypothesis
    // entirely: we only construct once the container has area, or after a short
    // proceed-anyway timeout (so a genuinely-hidden container never hangs).
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      sizeObserver = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (box && box.width > 0 && box.height > 0) {
          sizeObserver?.disconnect();
          sizeObserver = undefined;
          if (sizeProceedTimer) clearTimeout(sizeProceedTimer);
          if (!didConstruct) construct();
        }
      });
      sizeObserver.observe(container);
      sizeProceedTimer = setTimeout(() => {
        sizeObserver?.disconnect();
        sizeObserver = undefined;
        if (!didConstruct) {
          console.warn(
            "[pubmap] constructing map in 0-size container",
            container.getBoundingClientRect(),
          );
          construct();
        }
      }, 2000);
    } else {
      construct();
    }

    // The full construct-and-wire body lives in a local function so the size
    // gate can defer it. `container`/timers above are closed over; everything
    // this function creates (the map, its listeners) is torn down in cleanup.
    function construct() {
      if (didConstruct) return;
      didConstruct = true;

    // No-WebGL environments (locked-down browsers, headless boxes) throw
    // synchronously from the constructor. MapLibre 5 already asks for
    // `webgl2withfallback` + `failIfMajorPerformanceCaveat: false` +
    // high-performance, so a throw means the browser returned NO context
    // (transient GPU crash, context-slot exhaustion, policy-disabled) — hence
    // the auto-retry below rather than an immediate dead end.
    const lowPower = initAttempt >= 1;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: MAP_STYLES[themeRef.current],
        ...mapViewRef.current,
        maxBounds: maxBoundsRef.current,
        // Attempt 2 drops to low-power: some drivers refuse a
        // high-performance context under load but grant the integrated GPU.
        ...(lowPower ? { canvasContextAttributes: { powerPreference: "low-power" } } : {}),
      });
    } catch (error) {
      reducedQuery.removeEventListener("change", onReducedChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);

      // Diagnostic probe on a throwaway canvas: does *any* WebGL context exist?
      // This distinguishes a truly WebGL-less browser (honest dead end, no
      // Retry) from a transient failure (worth retrying). We capture the
      // browser's own statusMessage via the webglcontextcreationerror event.
      let probeStatus = "";
      let probeHasContext = false;
      try {
        const probe = document.createElement("canvas");
        probe.addEventListener(
          "webglcontextcreationerror",
          (event) => {
            probeStatus = (event as WebGLContextEvent).statusMessage || probeStatus;
          },
          { once: true },
        );
        const gl =
          probe.getContext("webgl2") ||
          probe.getContext("webgl") ||
          (probe.getContext("experimental-webgl") as WebGLRenderingContext | null);
        probeHasContext = Boolean(gl);
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        // Probe itself may throw in the same locked-down browser; treat as no
        // context — the message below stays honest.
      }

      // MapLibre embeds the browser's statusMessage as JSON in error.message.
      let embedded = "";
      const rawMessage =
        error instanceof Error ? error.message : "Map could not start in this browser.";
      try {
        const parsed = JSON.parse(rawMessage);
        if (parsed && typeof parsed.message === "string") embedded = parsed.message;
      } catch {
        // Not JSON — rawMessage is already human-ish.
      }

      const detail = [probeStatus, embedded, embedded ? "" : rawMessage]
        .filter(Boolean)
        .join(" · ");

      console.error("[pubmap] map init failed", {
        attempt: initAttempt,
        lowPower,
        probeHasContext,
        probeStatus,
        embedded,
        rawMessage,
      });

      // First failure gets one silent auto-retry — the common real-browser
      // cause is a transient context miss that a beat later succeeds.
      if (initAttempt === 0) {
        autoRetryTimer = setTimeout(() => setInitAttempt(1), 1500);
        return;
      }

      // Attempt 2 also threw. If the probe confirmed no context at all, be
      // honest that this browser lacks WebGL; otherwise it's a stubborn
      // constructor failure the user can Retry.
      queueMicrotask(() =>
        reportMapError(
          probeHasContext
            ? {
                kind: "constructor",
                message: "The map couldn't start its renderer.",
                detail: detail || undefined,
              }
            : {
                kind: "constructor",
                noWebgl: true,
                message: "This browser can't run the map — it needs WebGL.",
                detail: detail || undefined,
              },
        ),
      );
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    // The upstream OpenFreeMap styles reference sprite images we never render
    // at our zoom/layers (liberty's "wood-pattern"), and MapLibre warns on
    // every miss. Feed any missing id a 1x1 transparent pixel so the console
    // stays quiet without shipping the real texture.
    map.on("styleimagemissing", (event: { id: string }) => {
      if (!map.hasImage(event.id)) {
        map.addImage(event.id, { width: 1, height: 1, data: new Uint8Array(4) });
      }
    });

    // Rebuilds the whole scene from theme tokens. Runs on first load and after
    // every theme-driven setStyle (style.load fires for both).
    //
    // This is a long, linear scene assembler: it declares each MapLibre
    // source/layer once, in order, so the whole 3-D map reads top-to-bottom in
    // one place. Its cyclomatic complexity (37) is above the 35 budget, but the
    // branches are all independent `getSource`/`getLayer` "add once" guards over
    // shared closure state (`map`, `tokens`, `dark`, `addLayerOnce`). Splitting
    // them into helpers would thread that state through several signatures and
    // fracture the single readable pass without reducing real risk, so this is
    // the one intentionally tolerated lint warning for the app.
    const buildScene = () => {
      // Stale-event guard. A style.load can arrive from a style that a rapid
      // setStyle() just superseded (e.g. two theme flips inside one style-fetch
      // window): the event fires from the OLD style object, but map.addLayer
      // targets map.style — the NEW, not-yet-loaded one — and every mutation
      // would throw "Style is not done loading". `_loaded` is the exact flag
      // MapLibre's _checkLoaded() throws on (isStyleLoaded() is too strict here:
      // it also waits for tiles/sprite, which are legitimately still in flight
      // at style.load). Dropping the stale event is lossless — the new style's
      // own style.load re-runs buildScene, and pendingUpdatesRef carries any
      // queued data writes across to that build.
      const currentStyle = map.style as unknown as { _loaded?: boolean } | undefined;
      if (!currentStyle || currentStyle._loaded === false) return;

      // Wave K2: style.load already flipped `styleLoaded`, so the tile hard-fail
      // timer will never fire. Any throw below must still lift the parent
      // loading chrome — otherwise "Checking cached pins…" covers the map forever.
      try {
        buildSceneBody();
        settleSceneReady();
      } catch (error) {
        console.error("[pubmap] buildScene failed", error);
        const detail =
          error instanceof Error ? error.message : "Scene build threw unexpectedly";
        settleSceneError({
          kind: "tiles",
          message: "The map loaded tiles but couldn't finish drawing pubs.",
          detail,
        });
      }
    };

    // eslint-disable-next-line complexity
    const buildSceneBody = () => {
      const tokens = readTokens();
      const dark = themeRef.current === "dark";

      // Wave J1 — warm paper/river/brass washes on the stock basemap before we
      // add pub layers, so Liberty/Positron stop reading as generic grey GIS.
      applyBasemapTaste(
        map,
        {
          paper: tokens.paper,
          panelRaised: tokens.panelRaised,
          ink: tokens.ink,
          inkDeep: tokens.inkDeep,
          line: tokens.line,
          muted: tokens.muted,
          pint: tokens.pint,
          amber: tokens.amber,
          brass: tokens.brass,
          river: tokens.river,
          riverBright: tokens.riverBright,
        },
        dark,
      );

      // buildScene re-runs on every style.load. After a genuine setStyle swap
      // the old style's layers are gone (getLayer → undefined) so everything
      // re-adds with fresh tokens; on a duplicate pass the layer survives and
      // a bare addLayer would throw "Layer with id X already exists" inside
      // MapLibre's event dispatch, aborting the rest of the scene. getLayer
      // checks the CURRENT style state, so both paths are safe.
      const addLayerOnce = (...args: Parameters<typeof map.addLayer>) => {
        if (!map.getLayer(args[0].id)) map.addLayer(...args);
      };

      // Label font for OUR symbol layers. Glyphs come from the active style's
      // glyph server, and OpenFreeMap serves ONLY the Noto Sans stack — any
      // other name (the old "Open Sans Semibold, Arial Unicode MS Bold") 404s
      // every glyph range and drops to slow client-side rendering. Noto Sans
      // has no Semibold, so Bold is the closest weight. The CARTO fallback
      // style's glyph server has no Noto Sans Bold; Montserrat Medium is its
      // closest served weight.
      const textFont = [usingFallback ? "Montserrat Medium" : "Noto Sans Bold"];

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
            minzoom: 12.5,
            paint: {
              "fill-extrusion-color": dark
                ? "#7a8496"
                : withAlpha(tokens.line, 0.95),
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                12.5,
                0,
                14,
                ["*", ["coalesce", ["get", "render_height"], ["get", "height"], 14], 1.08],
              ],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": dark ? 0.9 : 0.58,
            },
          },
          firstSymbolId,
        );
      }

      // --- Transit lines (London TfL by default). Non-London cities pass
      // transitLinesPath=null so we skip the source entirely (no 404).
      if (transitLinesPath) {
        if (!map.getSource("tube-lines")) {
          map.addSource("tube-lines", {
            type: "geojson",
            data: transitLinesPath,
            attribution: "Rail lines © TfL / OpenStreetMap contributors (ODbL)",
          });
        }
        const tubeVisibility: "none" | "visible" = isTransitNetworkVisible(
          poiHiddenRef.current,
        )
          ? "visible"
          : "none";
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
            // Fan the sub-surface lines apart (issue #16); centred for all others.
            "line-offset": TUBE_LINE_OFFSET_EXPR,
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
            // Same fan offset as the casing so colour + casing move together.
            "line-offset": TUBE_LINE_OFFSET_EXPR,
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
            "text-font": textFont,
            "text-size": 9.5,
            "text-letter-spacing": 0.02,
            visibility: tubeVisibility,
          },
          paint: {
            // Dark night land needs cream `--ink` labels, not dark `--paper`.
            "text-color": dark ? tokens.ink : tokens.inkDeep,
            "text-halo-color": dark ? "rgba(9,8,6,0.92)" : "rgba(255,255,255,0.95)",
            "text-halo-width": 1.7,
          },
        });
      }

      // --- Designed marker images: landmark pictograms + TfL symbols, re-tinted
      // from the live theme tokens (a setStyle wipes them, so re-register here).
      const iconTokens: IconTokens = {
        ink: tokens.ink,
        paper: dark ? tokens.inkDeep : tokens.paper,
        brass: tokens.brass,
        brassBright: tokens.brassBright,
        river: tokens.river,
        riverBright: tokens.riverBright,
        pint: tokens.pint,
        amber: tokens.amber,
        brick: tokens.brick,
        muted: tokens.muted,
      };
      registerMapIcons(map, iconTokens);

      // --- Landmarks + history layer. Empty cityLandmarks skips the layer so
      // London markers never appear over Manchester (and vice versa).
      if (showLandmarks) {
        if (!map.getSource("landmarks")) {
          map.addSource("landmarks", {
            type: "geojson",
            data: landmarksGeoJSONRef.current,
          });
        } else {
          (map.getSource("landmarks") as maplibregl.GeoJSONSource).setData(
            landmarksGeoJSONRef.current,
          );
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
            "text-font": textFont,
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
      }

      // --- Points of interest. Transport (tube/rail/bus/river) render as their
      // real TfL / National Rail symbols on two zoom-gated layers: major
      // interchanges form the skeleton from a wide zoom, minor stops fade in as
      // you go deeper — a transit map revealing detail. Parks/sights stay soft
      // dots. All honour the category toggles (kept across theme rebuilds).
      // Non-London cities keep an empty source (poisPath=null → no fetch).
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
          "text-font": textFont,
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
          "text-font": textFont,
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

      // --- Story-band corridor (issue #15): a subtle token-tinted line threading
      // the active band's anchor landmarks. Low opacity + a soft blur so it reads
      // as a hint of the walk, never competing with the price-fill pins above it.
      // Sits under the pubs. The colour is the band's token, resolved on the React
      // side and stashed in a ref so a theme rebuild re-reads it.
      if (!map.getSource("band-corridor")) {
        map.addSource("band-corridor", { type: "geojson", data: bandCorridorRef.current });
      }
      addLayerOnce({
        id: "band-corridor",
        type: "line",
        source: "band-corridor",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": bandColorRef.current,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 13, 16, 16, 30],
          "line-opacity": dark ? 0.16 : 0.14,
          "line-blur": 3,
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
      // Story-band member halo (issue #15): while a band is active, its member
      // pubs get a token-tinted ring so they read as "part of this walk" — an
      // EMPHASIS only. The price fill under it (pubs-point) is untouched, so the
      // band never fights the price-colour system. Filter is set from a ref so
      // it survives theme rebuilds; empty id list = nothing drawn.
      addLayerOnce({
        id: "band-members-halo",
        type: "circle",
        source: "pubs",
        filter: [
          "all",
          ["!", ["has", "point_count"]],
          ["in", ["get", "id"], ["literal", bandMemberIdsRef.current]],
        ],
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 11, 15, 18],
          "circle-stroke-color": bandColorRef.current,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 15, 3],
          "circle-stroke-opacity": dark ? 0.85 : 0.8,
          "circle-blur": 0.15,
        },
      });
      addLayerOnce({
        id: "pubs-point",
        type: "symbol",
        source: "pubs",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            ["case", ["get", "story"], 0.55, 0.48],
            15,
            ["case", ["get", "story"], 0.92, 0.82],
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-padding": 2,
        },
        paint: {
          "icon-opacity": ["case", ["get", "serves"], 0.98, 0.22],
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
          // Wave J1 — pint → amber → brass by density (not ink-black discs).
          "circle-color": clusterCircleColorExpr(tokens, dark) as maplibregl.ExpressionSpecification,
          "circle-stroke-color": tokens.panelRaised,
          "circle-stroke-width": ["step", ["get", "point_count"], 2, 40, 2.5, 100, 3],
          "circle-stroke-opacity": 0.95,
          "circle-radius": ["step", ["get", "point_count"], 17, 25, 23, 100, 31],
          "circle-blur": ["step", ["get", "point_count"], 0.05, 40, 0.12, 100, 0.18],
          "circle-opacity": 0.94,
        },
      });
      addLayerOnce({
        id: "cluster-count",
        type: "symbol",
        source: "pubs",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": textFont,
          "text-size": ["step", ["get", "point_count"], 12, 25, 13, 100, 15],
          "text-letter-spacing": 0.02,
        },
        paint: {
          "text-color": dark ? tokens.ink : tokens.inkDeep,
          "text-halo-color": withAlpha(tokens.panelRaised, 0.75),
          "text-halo-width": 1,
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
          "text-font": textFont,
          "text-size": 13,
          "text-allow-overlap": true,
        },
        // Stops are always dark-filled, so the label is the light-side token.
        paint: { "text-color": dark ? tokens.ink : tokens.paper },
      });

      // Flush any mutations that arrived while the style was mid-load (initial
      // load or a theme swap). buildScene has just re-seeded every source/layer
      // from the data refs, so these queued fns (filters, paint, visibility,
      // raced setData) apply cleanly on top. Keyed map = only the latest write
      // per target replayed. Run inside a try so one bad fn can't abort the rest.
      if (pendingUpdatesRef.current.size > 0) {
        const pending = pendingUpdatesRef.current;
        pendingUpdatesRef.current = new Map();
        for (const fn of pending.values()) {
          try {
            fn(map);
          } catch {
            // A layer/source a queued fn targets may not exist in this style
            // build (e.g. toggled away); skip it rather than abort the flush.
          }
        }
      }

      // Ready is published by settleSceneReady() after buildSceneBody returns.
    };
    // --- Basemap fallback: OpenFreeMap is community-run, so if the primary style
    // hasn't loaded within a timeout (or errors before first load), swap to
    // CARTO's keyless styles; if that also fails, surface the same graceful
    // notice as a WebGL failure rather than a blank map.
    let styleLoaded = false;
    let usingFallback = false;
    let sceneSettled = false;
    let hardFailTimer: ReturnType<typeof setTimeout> | undefined;
    // settle* helpers close over hangFailTimer; they only run after this const
    // is initialized (and after style.load listeners are wired below).
    const settleSceneReady = () => {
      if (sceneSettled) return;
      sceneSettled = true;
      clearTimeout(hangFailTimer);
      publishMapReady(true);
    };
    const settleSceneError = (error: NonNullable<typeof mapError>) => {
      if (sceneSettled) return;
      sceneSettled = true;
      clearTimeout(hangFailTimer);
      queueMicrotask(() => reportMapError(error));
    };
    // Last-resort hang guard BEFORE style.load listeners: a cached style can
    // fire style.load synchronously from map.on(...). Primary + CARTO each get
    // STYLE_LOAD_TIMEOUT_MS, then slack — surface Retry instead of a stuck overlay.
    const hangFailTimer = setTimeout(() => {
      console.warn("[pubmap] scene ready timeout");
      settleSceneError({
        kind: "tiles",
        message:
          "The map is taking too long to finish loading — the pub list and crawl planner still work.",
        detail: "Scene ready timeout",
      });
    }, STYLE_LOAD_TIMEOUT_MS * 2 + 2000);
    // ORDER MATTERS: this flag-setter must be registered BEFORE buildScene.
    // MapLibre fires style validation/source problems as synchronous `error`
    // events from inside mutation calls, so if buildScene ran first (flag still
    // false) any such error would re-enter the error handler mid-build, call
    // swapToBasemapFallback → setStyle, and synchronously replace map.style
    // with a fresh UNLOADED style — every remaining addLayer in buildScene then
    // throws "Style is not done loading". With the flag set first, the error
    // handler knows the style did load and never swaps mid-build.
    map.on("style.load", () => {
      styleLoaded = true;
      clearTimeout(fallbackTimer);
      if (hardFailTimer) clearTimeout(hardFailTimer);
    });
    map.on("style.load", buildScene);
    const swapToBasemapFallback = () => {
      if (styleLoaded || usingFallback) return;
      usingFallback = true;
      map.setStyle(FALLBACK_STYLES[themeRef.current], { diff: false });
      hardFailTimer = setTimeout(() => {
        if (!styleLoaded) {
          settleSceneError({
            kind: "tiles",
            message:
              "The map couldn't load its tiles right now — the pub list and crawl planner still work.",
          });
        }
      }, STYLE_LOAD_TIMEOUT_MS);
    };
    const fallbackTimer = setTimeout(swapToBasemapFallback, STYLE_LOAD_TIMEOUT_MS);
    // An error before the first style loads means the style URL itself failed;
    // tile hiccups after load are harmless and ignored.
    map.on("error", () => {
      if (!styleLoaded) swapToBasemapFallback();
    });

    // --- Post-init context loss. A GPU reset fires `webglcontextlost`; the
    // browser usually restores within a frame or two (`webglcontextrestored`),
    // and MapLibre repaints on its own — so a brief loss should stay silent.
    // Only a loss that never restores leaves a permanently blank canvas, and
    // that is worth surfacing. We give it a grace window, then fall back with an
    // honest one-liner (and a Retry, which fully re-inits the map).
    map.on("webglcontextlost", () => {
      if (contextLostTimer) clearTimeout(contextLostTimer);
      contextLostTimer = setTimeout(() => {
        // Always surface — even after a successful first paint — and stop the
        // hang timer so it can't race a second error card.
        sceneSettled = true;
        clearTimeout(hangFailTimer);
        queueMicrotask(() =>
          reportMapError({
            kind: "context-lost",
            message: "The map lost its graphics context and couldn't recover.",
            detail: "WebGL context lost without restore",
          }),
        );
      }, 4000);
    });
    map.on("webglcontextrestored", () => {
      if (contextLostTimer) clearTimeout(contextLostTimer);
      contextLostTimer = undefined;
    });

    // --- Click + cursor wiring.
    // Pub-first hit testing: a single map click queries pubs/route stops before
    // landmarks/POIs so dense central London taps open a pub sheet, not a
    // landmark card that happened to sit under the same finger.
    const PUB_FIRST_LAYERS = [
      "pubs-point",
      "route-stops",
      "clusters",
      "landmarks-icon",
      "pois-dot",
      "pois-transport-major",
      "pois-transport-minor",
    ] as const;

    map.on("click", (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: PUB_FIRST_LAYERS.filter((id) => Boolean(map.getLayer(id))),
      });
      if (!features.length) return;

      const byLayer = new Map<string, (typeof features)[number]>();
      for (const feature of features) {
        const layerId = feature.layer?.id;
        if (typeof layerId === "string" && !byLayer.has(layerId)) {
          byLayer.set(layerId, feature);
        }
      }

      const pubHit = byLayer.get("pubs-point");
      if (pubHit) {
        const id = pubHit.properties?.id;
        if (typeof id !== "string") return;
        selectLandmark(null);
        setHoveredVenue(null);
        setActivePoi(null);
        onVenueClickRef.current(id);
        return;
      }

      const stopHit = byLayer.get("route-stops");
      if (stopHit) {
        const id = stopHit.properties?.id;
        if (typeof id !== "string") return;
        selectLandmark(null);
        setActivePoi(null);
        onRouteStopClickRef.current(id);
        return;
      }

      const clusterHit = byLayer.get("clusters");
      if (clusterHit) {
        const clusterId = clusterHit.properties?.cluster_id;
        const source = map.getSource("pubs") as maplibregl.GeoJSONSource;
        if (clusterId == null || !source) return;
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          const [lng, lat] = (clusterHit.geometry as GeoJSON.Point).coordinates;
          cinematic({ center: [lng, lat], zoom, duration: 700 });
        });
        return;
      }

      const landmarkHit = byLayer.get("landmarks-icon");
      if (landmarkHit) {
        const id = landmarkHit.properties?.id;
        const landmark = cityLandmarksRef.current.find((item) => item.id === id);
        if (!landmark) return;
        setActivePoi(null);
        selectLandmark(landmark);
        cinematic({
          center: landmark.coordinates,
          zoom: Math.max(map.getZoom(), 13),
          pitch: 55,
          duration: 1100,
        });
        return;
      }

      for (const layer of ["pois-dot", "pois-transport-major", "pois-transport-minor"] as const) {
        const poiHit = byLayer.get(layer);
        if (!poiHit) continue;
        const name = poiHit.properties?.name;
        const category = poiHit.properties?.category;
        if (typeof name !== "string" || typeof category !== "string") return;
        selectLandmark(null);
        setActivePoi({ name, category: category as PoiCategory });
        return;
      }
    });

    // Press-start / hover intent warms venue detail so the sheet opens warm.
    // Also wire route-stops — those pins are the same venue ids.
    const prefetchFromEvent = (event: {
      features?: Array<{ properties?: Record<string, unknown> | null }> | undefined;
    }) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id !== "string") return;
      onVenuePrefetchRef.current?.(id);
    };
    for (const layer of ["pubs-point", "route-stops"] as const) {
      map.on("mouseenter", layer, prefetchFromEvent);
      map.on("mousedown", layer, prefetchFromEvent);
      map.on("touchstart", layer, prefetchFromEvent);
    }

    const onPubHover = (event: maplibregl.MapLayerMouseEvent) => {
      if (!hoverCapableRef.current) return;
      const props = event.features?.[0]?.properties;
      const id = props?.id;
      const name = props?.name;
      if (typeof id !== "string" || typeof name !== "string") return;
      setHoveredVenue({ id, name, x: event.point.x, y: event.point.y });
    };
    map.on("mouseenter", "pubs-point", onPubHover);
    map.on("mousemove", "pubs-point", onPubHover);
    map.on("mouseleave", "pubs-point", () => setHoveredVenue(null));
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

    // The construct body owns the map + its listeners/timers; it registers its
    // teardown here so the effect's single cleanup (below) can run it whether or
    // not construction was deferred by the size gate.
    constructCleanup = () => {
      cancelAnimationFrame(rafId);
      clearTimeout(fallbackTimer);
      if (hardFailTimer) clearTimeout(hardFailTimer);
      clearTimeout(hangFailTimer);
      themeObserver.disconnect();
      reducedQuery.removeEventListener("change", onReducedChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      for (const eventName of interactionEvents) {
        interactionTarget.removeEventListener(eventName, onInteract);
      }
      map.remove();
      mapRef.current = null;
      publishMapReady(false);
    };
    } // end construct()

    return () => {
      // Outer teardown: size-gate observer/timer and the pending auto-retry /
      // context-lost timers are the effect's, not construct's, so they clear
      // even if we never constructed. Then run construct's teardown if it ran.
      sizeObserver?.disconnect();
      if (sizeProceedTimer) clearTimeout(sizeProceedTimer);
      if (autoRetryTimer) clearTimeout(autoRetryTimer);
      if (contextLostTimer) clearTimeout(contextLostTimer);
      constructCleanup?.();
      // If the constructor threw before wiring, its own catch already removed
      // the window/media listeners; guard so cleanup is idempotent.
      if (!constructCleanup) {
        reducedQuery.removeEventListener("change", onReducedChange);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [
    // Intentionally omit mapView / maxBounds / landmarksGeoJSON — those are
    // read via refs so parent re-renders (new array identity) cannot remount
    // MapLibre and flicker the loading chrome. City switches change
    // transitLinesPath / showLandmarks and still remount cleanly.
    cinematic,
    selectLandmark,
    initAttempt,
    transitLinesPath,
    showLandmarks,
    publishMapReady,
    reportMapError,
  ]);

  // Keep landmark GeoJSON in sync when the city catalog changes (e.g. London → Manchester).
  useEffect(() => {
    if (!mapReady) return;
    applyToMap("landmarks:data", (map) => {
      const source = map.getSource("landmarks") as maplibregl.GeoJSONSource | undefined;
      if (!showLandmarks) {
        if (map.getLayer("landmarks-icon")) map.removeLayer("landmarks-icon");
        if (source) map.removeSource("landmarks");
        return;
      }
      if (source) {
        source.setData(landmarksGeoJSON);
      } else {
        map.addSource("landmarks", { type: "geojson", data: landmarksGeoJSON });
      }
    });
  }, [mapReady, applyToMap, showLandmarks, landmarksGeoJSON]);

  // Pubs data → source. Rebuilds when the favorite pint changes so the price
  // buckets + serves flags re-derive against that beer.
  useEffect(() => {
    pubsDataRef.current = pubsToGeoJSON(
      venues,
      venueSignals,
      favoritePint,
      drinkCategory,
    );
    if (!mapReady) return;
    applyToMap("pubs:data", (map) => {
      (map.getSource("pubs") as maplibregl.GeoJSONSource | undefined)?.setData(
        pubsDataRef.current,
      );
    });
  }, [venues, venueSignals, favoritePint, drinkCategory, mapReady, applyToMap]);

  // POIs load once (client fetch) and feed the "pois" source.
  // Non-London cities pass poisPath=null → empty layer, no 404.
  useEffect(() => {
    let cancelled = false;
    loadPoisFromPath(poisPath)
      .then((pois) => {
        if (cancelled) return;
        poisDataRef.current = poisToGeoJSON(pois);
        applyToMap("pois:data", (map) => {
          (map.getSource("pois") as maplibregl.GeoJSONSource | undefined)?.setData(
            poisDataRef.current,
          );
        });
      })
      .catch(() => {
        // ponytail: POIs are ambient garnish — a fetch failure just leaves the
        // pub map intact, no error surfaced.
      });
    return () => {
      cancelled = true;
    };
  }, [mapReady, applyToMap, poisPath]);

  // POI category toggles → layer filters (kept in a ref for theme rebuilds).
  // Transport layers filter by category+rank; ambient dots by category only.
  useEffect(() => {
    poiHiddenRef.current = poiHidden;
    if (!mapReady) return;
    applyToMap("pois:filters", (map) => {
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
      // The coloured tube-line network toggles with Tube only (stations stay independent).
      const tubeVisibility = isTransitNetworkVisible(poiHidden) ? "visible" : "none";
      for (const layer of ["tube-lines-casing", "tube-lines-color", "tube-lines-label"]) {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", tubeVisibility);
      }
    });
  }, [poiHidden, mapReady, applyToMap]);

  // Route + selection ring → sources/filter.
  useEffect(() => {
    routeLineRef.current = routeToLine(route);
    routeStopsRef.current = routeToStops(route);
    selectedIdRef.current = selectedVenueId;
    if (!mapReady) return;
    applyToMap("route:data+selection", (map) => {
      (map.getSource("route-line") as maplibregl.GeoJSONSource | undefined)?.setData(
        routeLineRef.current,
      );
      (map.getSource("route-stops") as maplibregl.GeoJSONSource | undefined)?.setData(
        routeStopsRef.current,
      );
      const selectedFilter: maplibregl.FilterSpecification = [
        "==",
        ["get", "id"],
        selectedIdRef.current,
      ];
      if (map.getLayer("pubs-selected-glow")) {
        map.setFilter("pubs-selected-glow", selectedFilter);
      }
      if (map.getLayer("pubs-selected")) {
        map.setFilter("pubs-selected", selectedFilter);
      }
    });
  }, [route, selectedVenueId, mapReady, applyToMap]);

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
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    map.fitBounds(bounds, {
      padding: isPhone
        ? { top: 160, right: 28, bottom: 200, left: 28 }
        : 90,
      maxZoom: 15,
      duration: reducedRef.current ? 0 : 800,
    });
  }, []);

  const fitLondon = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    holdUntilRef.current = Math.max(
      holdUntilRef.current,
      performance.now() + 900 + ORBIT_RESUME_MS,
    );
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    const view = mapViewRef.current;
    map.fitBounds(maxBoundsRef.current, {
      padding: isPhone
        ? { top: 184, right: 24, bottom: 190, left: 24 }
        : 90,
      maxZoom: 11,
      duration: reducedRef.current ? 0 : 800,
      pitch: view.pitch,
      bearing: view.bearing,
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

  // --- Story bands (issue #15) -------------------------------------------
  // Resolve the active band + its member pubs under the CURRENT (filtered)
  // venue set. Member matching is a pure function (lib/storyBands); memoised so
  // it only recomputes when the band or the venue list actually changes.
  const activeBand = useMemo(() => bandById(activeBandId), [activeBandId, bandById]);
  const bandMembers = useMemo(
    () => (activeBand ? bandMemberPubs(activeBand, venues, cityLandmarks) : []),
    [activeBand, venues, cityLandmarks],
  );
  // Resolve the band's token colour once per band (readTokens reads the live CSS
  // custom properties, so this re-runs on theme flips too via the dep on band).
  const bandColour = useMemo(() => {
    if (!activeBand || typeof window === "undefined") return null;
    const tokens = readTokens() as unknown as Record<string, string>;
    return tokens[activeBand.colourToken] ?? tokens.brass;
  }, [activeBand]);

  // Push band state to the map: corridor source, member-halo filter, colour.
  // Debounced via requestAnimationFrame so a rapid filter churn doesn't thrash
  // setPaintProperty. Everything is guarded by getLayer so a mid-setStyle swap
  // is a no-op (buildScene re-reads the refs on the next style.load).
  useEffect(() => {
    bandCorridorRef.current = bandCorridorGeoJSON(activeBand, cityLandmarks);
    bandMemberIdsRef.current = bandMembers.map((m) => m.venue.id);
    if (bandColour) bandColorRef.current = bandColour;
    if (!mapReady) return;
    // Debounced via rAF so a rapid filter churn doesn't thrash setPaintProperty.
    // If the style is mid-swap when the frame fires, applyToMap queues the write
    // to flush on the next style.load rather than dropping it.
    const raf = requestAnimationFrame(() => {
      applyToMap("band:corridor+halo", (map) => {
        (map.getSource("band-corridor") as maplibregl.GeoJSONSource | undefined)?.setData(
          bandCorridorRef.current,
        );
        if (map.getLayer("band-members-halo")) {
          map.setFilter("band-members-halo", [
            "all",
            ["!", ["has", "point_count"]],
            ["in", ["get", "id"], ["literal", bandMemberIdsRef.current]],
          ]);
          if (bandColour) {
            map.setPaintProperty("band-members-halo", "circle-stroke-color", bandColour);
          }
        }
        if (map.getLayer("band-corridor") && bandColour) {
          map.setPaintProperty("band-corridor", "line-color", bandColour);
        }
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeBand, bandMembers, bandColour, mapReady, applyToMap, cityLandmarks]);

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

  const hoverDetail = useMemo(
    () => (hoveredVenueId ? hoverDetails.get(hoveredVenueId) : undefined),
    [hoverDetails, hoveredVenueId],
  );
  const hoverImageUrl = hoverImageUrlFor(hoverDetail, failedHoverImage, hoveredVenueId);
  const hoverCardStyle = hoveredVenue
    ? {
        left: `clamp(${HOVER_CARD_VIEWPORT_GUTTER_PX}px, ${hoveredVenue.x + HOVER_CARD_X_OFFSET_PX}px, calc(100vw - ${HOVER_CARD_WIDTH_PX + HOVER_CARD_VIEWPORT_GUTTER_PX}px))`,
        top: `clamp(${HOVER_CARD_MIN_TOP_PX}px, ${hoveredVenue.y + HOVER_CARD_Y_OFFSET_PX}px, calc(100vh - ${HOVER_CARD_HEIGHT_PX + HOVER_CARD_VIEWPORT_GUTTER_PX}px))`,
      }
    : undefined;

  if (mapError) {
    // Heading + body vary by cause so we never cry "needs WebGL" at a browser
    // that has it. Only the confirmed-dead-probe case makes that claim (and
    // hides Retry, since a re-init can't conjure a context that doesn't exist);
    // every other kind gets an honest one-liner and a Retry that fully re-inits.
    const heading = mapError.noWebgl
      ? "Map renderer unavailable"
      : mapError.kind === "tiles"
        ? "Map tiles unavailable"
        : mapError.kind === "context-lost"
          ? "Map lost its graphics"
          : "Map couldn't start";
    return (
      <div className="mapCanvasWrap">
        <div className="mapFallback" role="alert">
          <strong>{heading}</strong>
          <p>
            {mapError.message}
            {" "}
            The pub list and crawl planner beside it still work as ever.
          </p>
          {mapError.detail ? (
            <small className="mapFallbackDetail">{mapError.detail}</small>
          ) : null}
          {mapError.noWebgl ? null : (
            <button
              type="button"
              className="mapFallbackRetry"
              onClick={() => {
                setMapError(null);
                publishMapReady(false);
                setInitAttempt((a) => a + 1);
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const canRecenter = route.length >= 2;

  return (
    <div className="mapCanvasWrap">
      <div ref={containerRef} className="maplibreMap" />
      {/* Camera controls: London is always available; Recenter remains route-only. */}
      <div className="mapCameraControls" aria-label="Map camera controls">
        <button
          type="button"
          className="mapFitLondonBtn"
          onClick={fitLondon}
          aria-label="Show all of London"
          title="Show all of London"
        >
          <MapPinned size={14} aria-hidden />
          London
        </button>
        <button
          type="button"
          className="mapRecenterBtn"
          onClick={fitRoute}
          disabled={!canRecenter}
          aria-label={canRecenter ? "Recenter route" : "No route to recenter"}
          title={canRecenter ? "Recenter route" : "No route"}
        >
          <Crosshair size={14} aria-hidden />
          {canRecenter ? "Recenter" : "No route"}
        </button>
      </div>
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
            <Link
              className="landmarkChapterLink"
              href={`/landmark/${encodeURIComponent(activeLandmark.id)}`}
            >
              Open chapter
            </Link>
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
          {/* Issue #15: promote the card to a journey entry point — start a crawl
              from the nearest pubs, or open the nearest story pub's PUBMAXXER. */}
          {storyPubsNearby.length > 0 && (onStartCrawl || onAskPubmaxxer) ? (
            <div className="landmarkActions">
              {onStartCrawl ? (
                <button
                  type="button"
                  className="landmarkAction primary"
                  onClick={() => {
                    onStartCrawl(storyPubsNearby.map((p) => p.venue.id).slice(0, 3));
                    selectLandmark(null);
                  }}
                >
                  Start a crawl here
                </button>
              ) : null}
              {onAskPubmaxxer ? (
                <button
                  type="button"
                  className="landmarkAction"
                  onClick={() => {
                    onAskPubmaxxer(storyPubsNearby[0].venue.id);
                    selectLandmark(null);
                  }}
                >
                  Ask the PUBMAXXER
                </button>
              ) : null}
            </div>
          ) : null}
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
      {hoveredVenue ? (
        <aside className="venueHoverCard" style={hoverCardStyle} aria-hidden="true">
          {hoverImageUrl ? (
            <figure className="venueHoverPhoto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hoverImageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => {
                  if (hoveredVenueId) {
                    setFailedHoverImage({ venueId: hoveredVenueId, url: hoverImageUrl });
                  }
                }}
              />
            </figure>
          ) : (
            <div className="venueHoverPhotoFallback" aria-hidden="true">
              <span>{hoveredVenue.name.slice(0, 1).toUpperCase()}</span>
            </div>
          )}
          <div className="venueHoverBody">
            <span className="venueHoverEyebrow">
              {hoverDetail === undefined
                ? "Loading pub picture"
                : hoverDetail
                  ? "Pub preview"
                  : "Fast map preview"}
            </span>
            <strong>{hoverDetail?.name ?? hoveredVenue.name}</strong>
            <span>
              {hoverDetail?.primaryBorough ? `${hoverDetail.primaryBorough} · ` : ""}
              {hoverDetail?.cheapestPrice !== null && hoverDetail?.cheapestPrice !== undefined
                ? `${formatPrice(hoverDetail.cheapestPrice)} cheapest pint`
                : "Tap for full pub detail"}
            </span>
          </div>
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
      {/* Wave J declutter: one Layers control on all viewports (Airbnb-clean).
          Desktop mid-map POI strip + Place stories stack removed — same content
          lives in the Layers popover. Do not rebuild #63 structure. */}
      <MapLayersControl
        poiHidden={poiHidden}
        onPoiHiddenChange={setPoiHidden}
        activeBandId={activeBandId}
        onBandChange={onBandChange}
        storyBands={cityStoryBands}
      />
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
