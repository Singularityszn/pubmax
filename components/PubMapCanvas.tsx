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

import { landmarks as londonLandmarks, nearestStoryPubs, type Landmark } from "@/lib/landmarks";
import {
  bandMemberPubs,
  STORY_BANDS as LONDON_STORY_BANDS,
  type StoryBand,
} from "@/lib/storyBands";
import {
  loadPoisFromPath,
  LONDON_POIS_PATH,
  POI_CATEGORY_META,
  TRANSPORT_CATEGORIES,
  type PoiCategory,
} from "@/lib/pois";
import {
  defaultPoiHidden,
  defaultPoiHiddenForViewport,
  defaultPoiHiddenMobile,
  isTransitNetworkVisible,
} from "@/lib/poiToggleGroups";
import MapLayersControl from "@/components/map/MapLayersControl";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID, getCity } from "@/lib/cities";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { opportunitiesToGeoJSON } from "@/lib/thingsToDoMap";
import { formatPrice, type Venue } from "@/lib/venues";
import type { VenueSignal, HoveredVenue, VenueDetailResponse, FailedHoverImage } from "@/components/map/canvas/types";
import {
  MAP_STYLES, FALLBACK_STYLES, STYLE_LOAD_TIMEOUT_MS, LONDON_VIEW, LONDON_BOUNDS,
  ORBIT_DEG_PER_SEC, ORBIT_RESUME_MS, DASH_SEQ,
  readTokens,
} from "@/components/map/canvas/tokens";
import {
  pubsToGeoJSON, poisToGeoJSON, routeToLine, routeToStops,
  bandCorridorGeoJSON, landmarksToGeoJSON,
} from "@/components/map/canvas/geojson";
import {
  AMBIENT_CATEGORIES, poiFilter, transportFilter,
  TONIGHT_OPPORTUNITY_LAYERS, opportunityForFeature,
} from "@/components/map/canvas/filters";
import {
  HOVER_CARD_VIEWPORT_GUTTER_PX, HOVER_CARD_WIDTH_PX, HOVER_CARD_HEIGHT_PX,
  HOVER_CARD_MIN_TOP_PX, HOVER_CARD_X_OFFSET_PX, HOVER_CARD_Y_OFFSET_PX,
  withBoundedHoverDetailCache, hoverImageUrlFor, hoverPriceLine,
} from "@/components/map/canvas/hoverCard";
import { assembleScene } from "@/components/map/canvas/buildScene";


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
   * Called with `true` the moment the canvas commits to its user-facing error
   * fallback (WebGL failure, tiles down, context-lost, zero-size, …), and
   * `false` when a Retry click clears the error. Parents use this to drop any
   * loading skeleton that would otherwise hide the honest error card — the
   * `onMapReady(true)` we ALSO emit on error only lifts the "waiting for
   * scene" branch; a separate signal is needed when slim pins are still in
   * flight so the skeleton doesn't linger on top of the fallback.
   */
  onMapErrored?: (errored: boolean) => void;
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
   * Clean city arrival (no drink/crawl/pubs/route intent): fit city bounds once
   * after style/load so Bristol/Oxford/etc. land framed, not on a default zoom.
   */
  fitCityOnArrival?: boolean;
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
  /**
   * Active city — gates London-only hero tie-break (Prospect of Whitby) and
   * city-aware Layers chrome. Defaults to london for back-compat.
   */
  cityId?: CityId;
  /** CityMCP tonight opportunities (London). Drawn when tonightOverlayVisible. */
  tonightOpportunities?: ThingsToDoOpportunity[];
  tonightOverlayVisible?: boolean;
  onTonightOpportunityClick?: (op: ThingsToDoOpportunity) => void;
  /**
   * Borough browse arrival (`?q=`): fit the filtered venue set once after
   * style/load so outer-London places land framed, not on the city default.
   */
  fitQueryOnArrival?: boolean;
};


// Hard ceiling on the tile-paint gate: if the map never reaches `idle` (the
// ambient orbit nudges the camera every frame, which on a slow tile connection
// can starve the idle event indefinitely), reveal the pins anyway — a
// briefly-bare basemap beats a permanently pinless map.
const PIN_REVEAL_TIMEOUT_MS = 3000;
// Every pub-source layer, gated together so pin paint can be withheld until the
// basemap has actually painted (see the tile-paint gate in buildSceneBody).
const PUB_PIN_LAYERS = [
  "pubs-scraped-halo",
  "pubs-drops-halo",
  "band-members-halo",
  "pubs-point",
  "pubs-selected-glow",
  "pubs-selected",
  "clusters",
  "cluster-count",
] as const;



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
  onMapErrored,
  mapView = LONDON_VIEW,
  maxBounds = LONDON_BOUNDS,
  fitCityOnArrival = false,
  poisPath = LONDON_POIS_PATH,
  transitLinesPath = "/data/tfl_lines.json",
  cityLandmarks = londonLandmarks,
  cityStoryBands = LONDON_STORY_BANDS,
  cityId = DEFAULT_CITY_ID,
  tonightOpportunities = [],
  tonightOverlayVisible = false,
  onTonightOpportunityClick,
  fitQueryOnArrival = false,
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
  const onMapErroredRef = useRef(onMapErrored);
  useEffect(() => {
    onMapReadyRef.current = onMapReady;
    onMapErroredRef.current = onMapErrored;
  }, [onMapReady, onMapErrored]);
  const publishMapReady = useCallback((ready: boolean) => {
    setMapReady(ready);
    onMapReadyRef.current?.(ready);
  }, []);
  const publishMapErrored = useCallback((errored: boolean) => {
    onMapErroredRef.current?.(errored);
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
      // Also broadcast a distinct errored signal so a parent whose skeleton
      // still has other gates (e.g. slim pins in flight) can drop it and let
      // the fallback show through.
      publishMapReady(true);
      publishMapErrored(true);
      setMapError(error);
    },
    [publishMapErrored, publishMapReady],
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
  const onTonightOpportunityClickRef = useRef(onTonightOpportunityClick);
  const cityLandmarksRef = useRef(cityLandmarks);
  const tonightOpportunitiesRef = useRef(tonightOpportunities);
  const tonightOverlayVisibleRef = useRef(tonightOverlayVisible);
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
    onTonightOpportunityClickRef.current = onTonightOpportunityClick;
    cityLandmarksRef.current = cityLandmarks;
  }, [
    onVenueClick,
    onRouteStopClick,
    onVenuePrefetch,
    onLandmarkSelect,
    onTonightOpportunityClick,
    cityLandmarks,
  ]);

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
  const tonightDataRef = useRef<GeoJSON.FeatureCollection>(
    opportunitiesToGeoJSON([]),
  );
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
    // buildSceneBody delegates the full source/layer assembly to assembleScene
    // (components/map/canvas/buildScene.ts); the wrapper keeps only the D2
    // tile-paint gate and the pendingUpdatesRef flush, which own component state.
    // Fallback timer for the tile-paint gate (see buildSceneBody); lives at
    // construct scope so a theme-swap rebuild replaces the previous timer and
    // teardown can clear it.
    let pinRevealTimer: ReturnType<typeof setTimeout> | undefined;
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
      // loading chrome — otherwise "Finding the pubs…" covers the map forever.
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

    const buildSceneBody = () => {
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

      // Label font for OUR symbol layers. Glyphs come from the active style's
      // glyph server, and OpenFreeMap serves ONLY the Noto Sans stack — any
      // other name (the old "Open Sans Semibold, Arial Unicode MS Bold") 404s
      // every glyph range and drops to slow client-side rendering. Noto Sans
      // has no Semibold, so Bold is the closest weight. The CARTO fallback
      // style's glyph server has no Noto Sans Bold; Montserrat Medium is its
      // closest served weight.
      const textFont = [usingFallback ? "Montserrat Medium" : "Noto Sans Bold"];

      // Assemble every source/layer in load-bearing paint order (see
      // components/map/canvas/buildScene.ts). The D2 tile-paint gate and the
      // pendingUpdatesRef flush below stay component-owned (they touch a
      // construct-scope timer and component refs).
      assembleScene({
        map,
        tokens,
        dark,
        textFont,
        addLayerOnce,
        poiHidden: poiHiddenRef.current,
        transitLinesPath,
        showLandmarks,
        landmarksGeoJSON: landmarksGeoJSONRef.current,
        poisData: poisDataRef.current,
        routeLine: routeLineRef.current,
        routeStops: routeStopsRef.current,
        bandCorridor: bandCorridorRef.current,
        bandColor: bandColorRef.current,
        bandMemberIds: bandMemberIdsRef.current,
        pubsData: pubsDataRef.current,
        tonightData: tonightDataRef.current,
        tonightVisible: tonightOverlayVisibleRef.current,
        selectedId: selectedIdRef.current,
      });

      // --- Tile-paint gate (D2). buildScene runs on `style.load`, which fires
      // BEFORE the basemap's vector tiles have painted. The pub layers draw from
      // a GeoJSON source (no network tiles), so without this they paint on the
      // very next frame — floating over a blank/white basemap (worst in the light
      // Liberty/Positron style, which has no dark background to mask it; the dark
      // style just hid the same race). Hold every pub layer hidden until the map
      // reaches `idle` (all tiles + sources loaded and rendered), then reveal
      // them together. Applies on the initial load AND every theme swap, so pins
      // never render over an unpainted basemap in either theme. Skipped when tiles
      // are already loaded (cached / a duplicate build) so there is no needless
      // flash. `idle` can be starved — the ambient orbit moves the camera every
      // frame, so on a slow tile connection the map may never go idle — hence
      // the PIN_REVEAL_TIMEOUT_MS fallback: whichever fires first reveals the
      // pins and disarms the other.
      if (!map.areTilesLoaded()) {
        for (const id of PUB_PIN_LAYERS) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
        }
        const revealPins = () => {
          clearTimeout(pinRevealTimer);
          pinRevealTimer = undefined;
          map.off("idle", revealPins);
          for (const id of PUB_PIN_LAYERS) {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
          }
        };
        map.once("idle", revealPins);
        // A theme-swap rebuild re-arms the gate; drop the previous build's timer
        // so only the latest reveal pair is live.
        clearTimeout(pinRevealTimer);
        pinRevealTimer = setTimeout(revealPins, PIN_REVEAL_TIMEOUT_MS);
      }

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
      "tonight-point",
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

      const tonightHit = byLayer.get("tonight-point");
      if (tonightHit) {
        const opportunity = opportunityForFeature(
          tonightHit.properties as GeoJSON.GeoJsonProperties | undefined,
          tonightOpportunitiesRef.current,
        );
        if (!opportunity) return;
        selectLandmark(null);
        setHoveredVenue(null);
        setActivePoi(null);
        onTonightOpportunityClickRef.current?.(opportunity);
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
      "tonight-point",
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
      if (pinRevealTimer) clearTimeout(pinRevealTimer);
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
    // MapLibre and flicker the loading chrome. Include cityId so non-London
    // city switches (shared null transitLinesPath + showLandmarks) still
    // remount with fresh camera/bounds even if PubMap's key={cityId} is removed.
    cinematic,
    cityId,
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

  // CityMCP tonight opportunities → source data + overlay visibility. Kept out
  // of the mount effect deps so live opportunity refreshes never remount MapLibre.
  useEffect(() => {
    tonightDataRef.current = opportunitiesToGeoJSON(tonightOpportunities);
    tonightOpportunitiesRef.current = tonightOpportunities;
    tonightOverlayVisibleRef.current = tonightOverlayVisible;
    if (!mapReady) return;
    applyToMap("tonight:data+visibility", (map) => {
      (map.getSource("tonight-opportunities") as maplibregl.GeoJSONSource | undefined)?.setData(
        tonightDataRef.current,
      );
      const visibility: "visible" | "none" = tonightOverlayVisible ? "visible" : "none";
      for (const layer of TONIGHT_OPPORTUNITY_LAYERS) {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visibility);
      }
    });
  }, [tonightOpportunities, tonightOverlayVisible, mapReady, applyToMap]);

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

  // Fit the active city's bounds (not a city switcher — CitySwitcher owns that).
  const fitCityBounds = useCallback(() => {
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

  // Clean city arrival: frame the city's maxBounds once after style/load.
  // Drink / crawl / pubs / mapped-route arrivals own the camera elsewhere —
  // see shouldFitCityBoundsOnArrival. Ref guards against effect re-runs.
  const didFitOnArrivalRef = useRef(false);
  const didFitQueryOnArrivalRef = useRef(false);
  useEffect(() => {
    didFitOnArrivalRef.current = false;
    didFitQueryOnArrivalRef.current = false;
  }, [cityId]);
  useEffect(() => {
    if (!mapReady || !fitCityOnArrival) return;
    if (didFitOnArrivalRef.current) return;
    didFitOnArrivalRef.current = true;
    fitCityBounds();
  }, [mapReady, fitCityOnArrival, fitCityBounds]);

  // Borough browse arrival: frame the filtered venue set once (query owns the
  // camera). Skip if the user already tapped a pin — don't fight selectedVenue
  // fly-to. Padding mirrors fitRoute; maxZoom ~13 keeps outer boroughs readable.
  const fitQueryVenues = useCallback(() => {
    const map = mapRef.current;
    const current = venuesRef.current;
    if (!map || current.length === 0) return;
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
      maxZoom: 13,
      duration: reducedRef.current ? 0 : 800,
    });
  }, []);
  useEffect(() => {
    if (!mapReady || !fitQueryOnArrival) return;
    if (didFitQueryOnArrivalRef.current) return;
    // User already tapped a venue — leave the cinematic fly-to alone.
    if (selectedVenueId) return;
    if (venues.length === 0) return;
    didFitQueryOnArrivalRef.current = true;
    fitQueryVenues();
  }, [mapReady, fitQueryOnArrival, venues.length, selectedVenueId, fitQueryVenues]);

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
  // `selectedPresent` closes the ?sel= deep-link race: on first load the
  // selected venue (often a lazily-forced scraped pub) may not be in the venue
  // set yet, so the effect bails and the camera never moves. The boolean flips
  // false→true exactly once when the venue first appears — re-running the
  // effect — and stays true across filter/drop churn, so `venues` itself can
  // remain out of the deps (no re-flying on churn, the original guarantee).
  const selectedPresent =
    Boolean(selectedVenueId) && venues.some((item) => item.id === selectedVenueId);
  useEffect(() => {
    if (!selectedVenueId) return;
    // Any venue selection — map pin, route stop, or the sidebar list — retires
    // both overlay cards: the landmark story (H2) and the intro teaser (M5).
    queueMicrotask(() => {
      selectLandmark(null);
      setHeroDismissed(true);
    });
    const map = mapRef.current;
    if (!map || !mapReady || !selectedPresent) return;
    const venue = venuesRef.current.find((item) => item.id === selectedVenueId);
    if (!venue) return;
    cinematic({
      center: [venue.longitude, venue.latitude],
      zoom: Math.max(map.getZoom(), 14),
      pitch: 50,
      duration: 1100,
    });
  }, [selectedVenueId, selectedPresent, mapReady, cinematic, selectLandmark]);

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
  // Prospect of Whitby as the London-only flagship tie-break.
  const heroVenue = useMemo(() => {
    const candidates = venues.filter(
      (venue) => venue.hasStory && venue.curation.heritageNote,
    );
    if (candidates.length === 0) return null;
    const preferWhitby = cityId === "london";
    const score = (venue: Venue) =>
      (venueSignals.get(venue.id)?.hasPintDrops ? 2 : 0) +
      (preferWhitby && venue.name.toLowerCase().includes("prospect of whitby") ? 1 : 0);
    return candidates.reduce((best, venue) => (score(venue) > score(best) ? venue : best));
  }, [venues, venueSignals, cityId]);

  const hoverDetail = useMemo(
    () => (hoveredVenueId ? hoverDetails.get(hoveredVenueId) : undefined),
    [hoverDetails, hoveredVenueId],
  );
  const hoverMapVenue = useMemo(
    () => (hoveredVenueId ? venues.find((venue) => venue.id === hoveredVenueId) : undefined),
    [venues, hoveredVenueId],
  );
  const hoverSignal = hoveredVenueId ? venueSignals.get(hoveredVenueId) : undefined;
  const hoverPrice = hoverPriceLine(hoverMapVenue, hoverSignal, hoverDetail);
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
                publishMapErrored(false);
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
  const cityDisplayName = getCity(cityId).displayName;

  return (
    <div className="mapCanvasWrap">
      <div ref={containerRef} className="maplibreMap" />
      {/* Camera fit for the active city — not a city switcher (toolbar owns that). */}
      <div className="mapCameraControls" aria-label="Map camera controls">
        <button
          type="button"
          className="mapFitLondonBtn"
          onClick={fitCityBounds}
          aria-label={`Show all of ${cityDisplayName}`}
          title={`Show all of ${cityDisplayName}`}
        >
          <MapPinned size={14} aria-hidden />
          {cityDisplayName}
        </button>
        {/* D7: only render once there's a route to recenter — a disabled
            "No route" ghost chip sitting in the camera-controls stack reads
            as a stuck/broken control when the map is routeless. */}
        {canRecenter ? (
          <button
            type="button"
            className="mapRecenterBtn"
            onClick={fitRoute}
            aria-label="Recenter route"
            title="Recenter route"
          >
            <Crosshair size={14} aria-hidden />
            Recenter
          </button>
        ) : null}
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
            <span className="venueHoverMeta">
              {hoverDetail?.primaryBorough ? `${hoverDetail.primaryBorough} · ` : ""}
              {hoverPrice.price !== null && hoverPrice.price !== undefined
                ? `${formatPrice(hoverPrice.price)} cheapest pint`
                : "Tap for full pub detail"}
            </span>
            <span className="venueHoverProvenance">{hoverPrice.provenance}</span>
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
        cityId={cityId}
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
