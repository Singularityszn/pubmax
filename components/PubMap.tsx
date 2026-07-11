"use client";

import { Footprints, MapPinned, Route as RouteIcon, TrainFront, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import SiteNav from "@/components/nav/SiteNav";
import "@/components/map/venueSheet.css";
import "@/components/map/spillComposer.css";
import "@/components/map/logIntentFallback.css";

import {
  buildCrawlRoute,
  mergeVenueDrops,
  venueGroupingKey,
  type Filters,
  type Venue,
} from "@/lib/venues";
import { filterMapVenues, withForcedVenue } from "@/lib/filterMapVenues";
import { mergePriceUpdates, parsePriceUpdates, type PriceUpdate } from "@/lib/priceUpdates";
import { nearestVenueIds } from "@/lib/nearby";
import PubMapCanvas from "@/components/PubMapCanvas";
import ControlRail, { type CrawlMode } from "@/components/map/ControlRail";
import { type CuratedCrawl } from "@/lib/curatedCrawls";
import { curatedCrawlsForCity, curatedCrawlByIdForCity } from "@/lib/cityCuratedCrawls";
import { landmarksForCity } from "@/lib/cityLandmarks";
import { storyBandsForCity, bandByIdForCity } from "@/lib/cityStoryBands";
import RoutePanel from "@/components/map/RoutePanel";
import ActiveRoundChip from "@/components/map/ActiveRoundChip";
import VenueInspector, { type TabKey } from "@/components/map/VenueInspector";
import VenueSheetSkeleton from "@/components/map/VenueSheetSkeleton";
import MapToolbar from "@/components/map/MapToolbar";
import MapPriceControl from "@/components/map/MapPriceControl";
import CitySuggestBanner from "@/components/map/CitySuggestBanner";
import CityStatusBanner from "@/components/map/CityStatusBanner";
import { writePreferredCity } from "@/lib/cityPreference";
import { usePintDrops } from "@/components/map/usePintDrops";
import { useLiveDrops } from "@/components/map/useLiveDrops";
import { useSheetDrag } from "@/components/map/useSheetDrag";
import { sheetTranslateY } from "@/lib/sheetSnap";
import { seedCrawlState, useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import type { AltCrawlStyle } from "@/lib/crawlUrl";
import {
  clearFavoritePint,
  getFavoritePint,
  setFavoritePint as persistFavoritePint,
} from "@/lib/favoritePint";
import { getSaved } from "@/lib/savedPubs";
import { loadSlimVenuesForCity } from "@/lib/venuesSlim";
import {
  cityMaxBounds,
  DEFAULT_CITY_ID,
  getCity,
  type CityId,
} from "@/lib/cities";
import { slimVenuesToPins } from "@/lib/slimPins";
import { buildRouteLegs } from "@/lib/routeLegs";
import { haversineKm } from "@/lib/haversine";
import { mergeLazyDetailPins } from "@/lib/lazyVenueDetail";
import {
  buildLogNearbyCandidates,
  formatLogNearbyDistance,
  hasMapLogIntent,
  resolveMapLogIntent,
  shouldRunMapLogIntent,
} from "@/lib/mapLogIntent";
import prefetchVenue from "@/lib/prefetchVenue";
import { warmVenueDetail } from "@/lib/warmVenueDetail";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import {
  bandChipDismissedKey,
  shouldShowBandOnboardingChip,
  shouldShowCuratedOnboarding,
  truncateBandCopy,
} from "@/lib/bandOnboardingChip";
import { isDrinkShapeArrival, shouldFitCityBoundsOnArrival, shouldOpenPlanningInitially } from "@/lib/mapArrival";

// Mobile venue-detail bottom sheet: the drag gesture + snap→px math live in
// useSheetDrag (components/map/useSheetDrag.ts). PubMap only owns WHICH snap is
// default on a fresh pick and renders the sheet chrome.

// The set of venue ids this device has saved (any list). Read from the client
// saved-pub store; SSR-safe (getSaved returns [] on the server). Used only to
// narrow the map/list when the viewer flips "Saved only" on.
function readSavedVenueIds(): Set<string> {
  return new Set(getSaved().map((entry) => entry.venueId));
}

// SSR-safe read of the current URL query. Kept in one place so the several
// param probes below can't drift on the SSR ("") fallback.
function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

// §4.5: did the page arrive with any crawl-shaping URL param (a shared/deep
// link)? If any are present the arrival is intentional and we never onboard.
// Module-level (pure) so the branch lives off PubMap's complexity budget.
// `drink=` counts (landing drink-shape taps) but is NOT a planner-open signal.
function hasCrawlArrivalParams(search: string): boolean {
  // Intentional deep links (landmark/band/food/log/etc.) must also suppress
  // curated onboarding — not only crawl planner params (#79 follow-up).
  return /[?&](pubs|sel|style|mode|q|drink|cocktails|landmark|band|food|max|alt|log|crawl)=/.test(
    search,
  );
}

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
}

// mergeVenueDrops (lib/venues.ts) folds drops into DERIVED SUMMARY SIGNALS only:
// a bare price is never a story, and demo seeds never move prices or hasStory.

// Hand-built stop ids are mirrored to localStorage while a crawl is active.
// Clean /map arrivals do NOT auto-restore from this key (that made tab links
// look weird by dumping stale ?pubs= into the address bar). The URL is the
// only share/restore source.
const BUILT_STORAGE_KEY = "pubmax_built_ids";

// Issue #15: normalise a landmark's nearest-pub ids into crawl stops — drop
// blanks, cap at three. Module-level (pure) so the branch lives outside the
// PubMap component body and off its complexity budget.
function crawlStopsFromPubIds(ids: string[]): string[] {
  return ids.filter(Boolean).slice(0, 3);
}

// Issue #31: fold a curated crawl's style choices onto the current filters. A
// mocktail crawl composes with the non-alcoholic filter — the honest, minimal
// way an alt style touches the actual route. Module-level (pure) so the branch
// lives off PubMap's complexity budget.
function filtersForCuratedCrawl(current: Filters, crawl: CuratedCrawl): Filters {
  return {
    ...current,
    crawlStyle: crawl.crawlStyle,
    requireNonAlcoholic: crawl.altStyle === "mocktail" ? true : current.requireNonAlcoholic,
  };
}

/** Resolve a curated crawl from ?crawl= or an exact pubs= stop list match. */
function resolveSeededCuratedCrawl(
  cityId: CityId,
  crawlId: string | undefined,
  builtIds: string[],
): CuratedCrawl | null {
  const byId = curatedCrawlByIdForCity(cityId, crawlId);
  if (byId) return byId;
  if (builtIds.length < 2) return null;
  const cityCrawls = curatedCrawlsForCity(cityId);
  return (
    cityCrawls.find(
      (crawl) =>
        crawl.venueIds.length === builtIds.length &&
        crawl.venueIds.every((id, i) => id === builtIds[i]),
    ) ?? null
  );
}

type MapSeed = ReturnType<typeof seedCrawlState> & {
  activeCrawl: CuratedCrawl | null;
  routeMapped: boolean;
};

/**
 * One-shot mount seed from the shareable URL only.
 * Pure module helper so PubMap can lazy-init state without a useMemo that the
 * React Compiler cannot preserve (react-hooks/preserve-manual-memoization).
 * Do NOT resurrect a previous hand-built crawl from localStorage on a clean
 * /map tab click — that bloated the address bar with stale ?pubs=… (PR #79).
 */
function buildMapSeed(search: string, cityId: CityId = DEFAULT_CITY_ID): MapSeed {
  const seeded = seedCrawlState(search);
  // Landing drink-shape taps should land on a clean filtered map.
  if (isDrinkShapeArrival(search)) {
    return { ...seeded, activeCrawl: null, routeMapped: false };
  }
  // Curated / featured arrival: hydrate the named crawl so the polyline +
  // blurb show map-first (planner stays closed via shouldOpenPlanningInitially).
  const activeCrawl = resolveSeededCuratedCrawl(cityId, seeded.crawlId, seeded.builtIds);
  if (activeCrawl) {
    return {
      ...seeded,
      filters: filtersForCuratedCrawl(seeded.filters, activeCrawl),
      altStyle: activeCrawl.altStyle ?? seeded.altStyle,
      crawlId: activeCrawl.id,
      activeCrawl,
      routeMapped: true,
    };
  }
  return {
    ...seeded,
    activeCrawl: null,
    routeMapped: seeded.builtIds.length >= 2,
  };
}

// Issue #15: the landmark card's two journey actions, hoisted into their own
// hook so their branches live off PubMap's complexity budget.
//   • startCrawlFromPubs — drop the nearest pubs into Build mode (shareable via
//     ?mode=build&pubs=…, reusing the curated-crawl path), then leave the route
//     list visible on mobile.
//   • askPubmaxxerAtPub — select the nearest story pub so its inspector opens
//     with the grounded "Ask the PUBMAXXER" panel a tap away. Seeding a question
//     straight into that panel is invasive (another agent owns VenueInspector),
//     so selecting the pub is the documented ceiling.
function useLandmarkJourney(deps: {
  selectVenue: (id: string) => void;
  showLoadedRoute: (firstStopId: string) => void;
  dismissOnboarding: () => void;
  setMode: (mode: CrawlMode) => void;
  setBuiltIds: (ids: string[]) => void;
  setRouteMapped: (mapped: boolean) => void;
  setActiveCrawl: (crawl: CuratedCrawl | null) => void;
  setPlanningOpen: (open: boolean) => void;
}) {
  const {
    selectVenue,
    showLoadedRoute,
    dismissOnboarding,
    setMode,
    setBuiltIds,
    setRouteMapped,
    setActiveCrawl,
    setPlanningOpen,
  } =
    deps;
  const startCrawlFromPubs = useCallback(
    (ids: string[]) => {
      const stops = crawlStopsFromPubIds(ids);
      if (stops.length) {
        setMode("build");
        setBuiltIds(stops);
        setRouteMapped(true);
        setActiveCrawl(null); // a landmark-seeded crawl isn't a curated one
        showLoadedRoute(stops[0]);
        dismissOnboarding();
      }
    },
    [
      dismissOnboarding,
      setMode,
      setBuiltIds,
      setRouteMapped,
      setActiveCrawl,
      showLoadedRoute,
    ],
  );
  const askPubmaxxerAtPub = useCallback(
    (venueId: string) => {
      setPlanningOpen(true);
      selectVenue(venueId);
    },
    [selectVenue, setPlanningOpen],
  );
  return { startCrawlFromPubs, askPubmaxxerAtPub };
}

function useLogIntent(deps: {
  hasLogIntent: boolean;
  loaded: boolean;
  firstFilteredVenueId: string;
  firstRouteId: string;
  selectedVenueId: string;
  selectedVenueResolvable: boolean;
  selectVenue: (id: string) => void;
  openComposerForLog: () => void;
  setFallbackVisible: (visible: boolean) => void;
}) {
  const {
    hasLogIntent,
    loaded,
    firstFilteredVenueId,
    firstRouteId,
    selectedVenueId,
    selectedVenueResolvable,
    selectVenue,
    openComposerForLog,
    setFallbackVisible,
  } = deps;
  const handled = useRef(false);

  useEffect(() => {
    if (!hasLogIntent) {
      handled.current = false;
      setFallbackVisible(false);
      return;
    }
    if (!shouldRunMapLogIntent({ hasLogIntent, handled: handled.current })) return;
    const resolution = resolveMapLogIntent({
      hasLogIntent,
      loaded,
      selectedVenueId,
      selectedVenueResolvable,
      firstRouteId,
      firstFilteredVenueId,
    });
    if (resolution.status === "inactive" || resolution.status === "pending") return;
    if (resolution.status === "fallback") {
      setFallbackVisible(true);
      return;
    }
    handled.current = true;
    setFallbackVisible(false);
    markPubmaxTiming("pubmax:drop-route-ready");
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      selectVenue(resolution.venueId);
      openComposerForLog();
    });
    return () => {
      active = false;
    };
  }, [
    hasLogIntent,
    loaded,
    firstFilteredVenueId,
    firstRouteId,
    openComposerForLog,
    selectVenue,
    selectedVenueId,
    selectedVenueResolvable,
    setFallbackVisible,
  ]);
}

// §4.5 curated-crawl onboarding: dismissal is per-session so a reload during the
// same visit doesn't re-nag, but a fresh session gets the offer again. sessionStorage
// (not localStorage) keeps it a gentle, per-visit prompt.
const ONBOARDING_DISMISSED_KEY = "pubmax_onboarding_dismissed";
const EMPTY_ROUTE: Venue[] = [];

const DETAIL_STATUS_STYLE: CSSProperties = {
  margin: "0 18px 10px",
  padding: "10px 12px",
  border: "1px solid rgba(211, 164, 74, 0.28)",
  borderRadius: "8px",
  background: "rgba(211, 164, 74, 0.1)",
  color: "var(--ink)",
  fontSize: "0.82rem",
  fontWeight: 700,
};

const DETAIL_WARNING_STYLE: CSSProperties = {
  ...DETAIL_STATUS_STYLE,
  borderColor: "rgba(209, 99, 83, 0.34)",
  background: "rgba(209, 99, 83, 0.12)",
};

type VenueDetailStatus = "idle" | "loading" | "ready" | "unavailable";

type UserLocation = {
  lat: number;
  lng: number;
};

function detailStatusFor(
  selectedVenueId: string,
  detailById: Map<string, Venue>,
  detailStatusById: Map<string, VenueDetailStatus>,
): VenueDetailStatus {
  if (!selectedVenueId) return "idle";
  if (detailById.has(selectedVenueId)) return "ready";
  return detailStatusById.get(selectedVenueId) ?? "loading";
}

function venueUpdateKey(venue: Venue): string {
  const firstPrice = venue.prices[0];
  return firstPrice ? venueGroupingKey(firstPrice) : venue.id;
}

function readOnboardingDismissed(): boolean {
  if (typeof window === "undefined") return true; // SSR: never render the overlay server-side
  try {
    return window.sessionStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

// G3: per-band session dismiss for the Place story deep-link chip. Distinct from
// ONBOARDING_DISMISSED_KEY so dismissing one never silences the other.
function readBandChipDismissed(bandId: string): boolean {
  if (!bandId || typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(bandChipDismissedKey(bandId)) === "1";
  } catch {
    return false;
  }
}

export default function PubMap({
  cityId = DEFAULT_CITY_ID,
}: {
  cityId?: CityId;
}) {
  const city = getCity(cityId);
  const cityLandmarks = useMemo(() => landmarksForCity(cityId), [cityId]);
  const cityStoryBands = useMemo(() => storyBandsForCity(cityId), [cityId]);
  const cityCuratedCrawls = useMemo(() => curatedCrawlsForCity(cityId), [cityId]);
  // Stable identity — a fresh cityMaxBounds() array every render remounts MapLibre
  // (PubMapCanvas init effect depends on maxBounds) and flickers the loading chrome.
  const cityBounds = useMemo(() => cityMaxBounds(city), [city]);
  const searchParams = useSearchParams();
  useEffect(() => {
    markPubmaxTiming("pubmax:map-chunk-ready");
  }, []);
  // Deep-link /map/<city> (and CitySwitcher arrivals) stick as the Map/Drop
  // preference so the next tab tap does not bounce back to London.
  useEffect(() => {
    writePreferredCity(cityId);
  }, [cityId]);
  // Seed the crawl from the shareable URL (falls back to defaults / honors
  // ?style=heritage from the landing page). Lazy useState keeps this off effects
  // and avoids a mount-only useMemo the React Compiler cannot preserve.
  // URL is the only share/restore source — do NOT resurrect a previous hand-built
  // crawl from localStorage on a clean /map tab click (that bloated the address
  // bar with stale ?mode=build&pubs=… every time someone returned to Map).
  const [seed] = useState<MapSeed>(() => buildMapSeed(currentSearch(), cityId));
  // Freeze arrival search with the seed so fit-on-arrival does not flip when the
  // user later maps a route or the address bar syncs.
  const [arrivalSearch] = useState(() => currentSearch());
  // §4.5: did the page arrive with any crawl-shaping URL param (a shared/deep
  // link)? Captured ONCE at mount — useCrawlUrlSync starts writing mode/style back
  // to the URL after ~300ms, so re-reading location.search later would be wrong.
  // If any of these are present, the arrival is intentional and we never onboard.
  const [arrivedWithCrawlParams] = useState(
    () => hasCrawlArrivalParams(currentSearch()) || hasMapLogIntent(currentSearch()),
  );
  // `loaded` means the slim map index has settled. The full price dataset is no
  // longer fetched on /map mount; full details arrive lazily per selected venue.
  const [loaded, setLoaded] = useState(false);
  // Wave K2 — WebGL style + scene ready. Keep loading chrome until both slim
  // pins and the basemap have arrived (warmup can make slim arrive first).
  // Canvas owns hang recovery (reportMapError lifts this via onMapReady).
  const [mapCanvasReady, setMapCanvasReady] = useState(false);
  // Canvas has committed to its user-facing error fallback (WebGL/tiles/etc.).
  // We drop the loading skeleton immediately in that case even if slim pins
  // are still in flight, so the fallback card isn't hidden behind chrome.
  const [mapCanvasErrored, setMapCanvasErrored] = useState(false);
  // Issue #35 — two-stage load. `slimPins` are Venue-SHAPE pins built from the
  // ~400 KB slim index (or instantly from its IndexedDB mirror), painted BEFORE
  // the ~5.6 MB full dataset lands so the first interactive pin appears fast.
  // They carry only what pubsToGeoJSON needs (id/name/coords/cheapestPrice);
  // hasStory + prices degrade to inert defaults until hydration (see lib/slimPins).
  const [slimPins, setSlimPins] = useState<Venue[]>([]);
  const [detailById, setDetailById] = useState<Map<string, Venue>>(() => new Map());
  const [detailStatusById, setDetailStatusById] = useState<Map<string, VenueDetailStatus>>(
    () => new Map(),
  );
  const [selectedVenueId, setSelectedVenueId] = useState<string>(seed.selectedVenueId);
  const [venueInitialTab, setVenueInitialTab] = useState<TabKey>("pints");
  const [filters, setFilters] = useState<Filters>(seed.filters);
  const [mode, setMode] = useState<CrawlMode>(seed.mode);
  const [builtIds, setBuiltIds] = useState<string[]>(seed.builtIds);
  // Issue #15 story bands: the active band id ("" = none), seeded from the URL
  // and synced back so a band link reproduces. The band overlay + picker live
  // inside PubMapCanvas; PubMap only owns the shareable state.
  const [activeBandId, setActiveBandId] = useState<string>(seed.bandId);
  // Live landmark selection for shareable ?landmark= URLs (seeded once, then
  // updated when the user opens/dismisses a landmark card on the map).
  const [activeLandmarkId, setActiveLandmarkId] = useState<string>(seed.landmarkId ?? "");
  // Map-first layout: the planner (left drawer) is hidden until the user asks
  // for it. Curated crawl arrivals stay map-first (polyline + chip); other
  // shared/restored crawl links still open straight into planning.
  const [planningOpen, setPlanningOpen] = useState<boolean>(() =>
    shouldOpenPlanningInitially(seed.builtIds, seed.mode, currentSearch()),
  );
  // Explicit route mapping: a suggested crawl can exist without drawing on the
  // clean first map. Once the user chooses "Map route" (or a curated/nearby
  // crawl), keep the line visible even if the mobile planner closes.
  const [routeMapped, setRouteMapped] = useState<boolean>(seed.routeMapped);
  // Lights ActiveRoundChip immediately after Plan-drawer Start Round (stay-on-map).
  const [activeRoundStartedCode, setActiveRoundStartedCode] = useState<string | null>(null);
  // Favorite pint: re-prices the map to one beer. Persisted per-device.
  // A beer brand deep-link (`?drink=beer&brand=guinness`) seeds the same path.
  const [favoritePint, setFavoritePintState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    if (seed.filters.drinkCategory === "beer" && seed.filters.drinkBrand) {
      return seed.filters.drinkBrand;
    }
    return getFavoritePint();
  });
  // "Show saved only": a viewer convenience that narrows the map + list to pubs
  // this device has saved. The toggle lives here (ControlRail renders it); the
  // saved-id set is read lazily and re-read on each toggle so a just-saved pub
  // appears without a reload. localStorage-only for the signed-out demo — that's
  // fine, this is a per-viewer view, not shared state.
  const [savedOnly, setSavedOnly] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set<string>() : readSavedVenueIds(),
  );
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  // The curated crawl whose blurb is shown under the route title. Seeded from
  // ?crawl= / matching pubs= on curated arrival; cleared when the user mutates stops.
  const [activeCrawl, setActiveCrawl] = useState<CuratedCrawl | null>(seed.activeCrawl);
  // Issue #31 alt crawl style ("kind of night" label). Seeded from the URL and
  // synced back so a shared link reproduces it. Only shapes copy + the .ics
  // export noun; the scoring crawlStyle is untouched.
  const [altStyle, setAltStyle] = useState<AltCrawlStyle>(seed.altStyle);
  // §4.5 onboarding: has the viewer dismissed (or acted on) the "Start with a
  // story" overlay this session? Lazy init reads sessionStorage once, SSR-safe.
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(readOnboardingDismissed);
  // G3: per-band dismiss set for the Place story deep-link chip. Seeded from the
  // arrival band; grows when the viewer dismisses or switches to an already-
  // dismissed band this session.
  const [dismissedBandIds, setDismissedBandIds] = useState<Set<string>>(() => {
    if (!seed.bandId || !readBandChipDismissed(seed.bandId)) return new Set();
    return new Set([seed.bandId]);
  });
  const [logIntentFallbackVisible, setLogIntentFallbackVisible] = useState(false);

  // Community Pint Drops: fetch/submit/report state lives in the hook.
  // City-scoped so Manchester demo seeds colour Manchester pins without
  // leaking into the London feed/landing.
  const pintDrops = usePintDrops(cityId);
  const { dropsByVenueId, venueSignals, refreshVenueDrops, closeComposer, setComposerOpen } =
    pintDrops;
  // Live map pins (issue #37): refetch the drops layer on a new-drop signal (or
  // a 30s poll when realtime is unavailable). Self-contained, signal-only.
  useLiveDrops(pintDrops.refreshAllDrops);

  // Mobile bottom-sheet drag (GH #17) — state + pointer handlers live in
  // useSheetDrag. Two instances: venue (right) and planner (left). A fling
  // past peek dismisses that sheet. "half" is the default resting snap;
  // open/pick handlers re-assert it below.
  const dismissSheet = useCallback(() => {
    setSelectedVenueId("");
    closeComposer();
  }, [closeComposer, setSelectedVenueId]);
  const {
    sheetSnap,
    setSheetSnap,
    sheetDragY,
    setSheetDragY,
    onSheetDragStart,
    onSheetDragMove,
    onSheetDragEnd,
  } = useSheetDrag(dismissSheet);

  // Ref so fling-dismiss can call the same closePlanning as chrome buttons
  // without a hook ↔ callback cycle (useSheetDrag needs onDismiss up front).
  const closePlanningRef = useRef<() => void>(() => {
    setPlanningOpen(false);
  });
  const {
    sheetSnap: plannerSheetSnap,
    setSheetSnap: setPlannerSheetSnap,
    sheetDragY: plannerSheetDragY,
    setSheetDragY: setPlannerSheetDragY,
    onSheetDragStart: onPlannerSheetDragStart,
    onSheetDragMove: onPlannerSheetDragMove,
    onSheetDragEnd: onPlannerSheetDragEnd,
  } = useSheetDrag(() => {
    closePlanningRef.current();
  });

  const closePlanning = useCallback(() => {
    setPlanningOpen(false);
    setPlannerSheetSnap("half");
    setPlannerSheetDragY(null);
  }, [setPlannerSheetDragY, setPlannerSheetSnap]);
  useLayoutEffect(() => {
    closePlanningRef.current = closePlanning;
  }, [closePlanning]);

  const openPlanning = useCallback(() => {
    // Mobile: mutual exclusion with the venue sheet (planner stacks above it
    // in z-order; keeping both open made Escape/dismiss order confusing).
    if (isMobileViewport()) {
      setSelectedVenueId("");
      closeComposer();
      setSheetSnap("half");
      setSheetDragY(null);
    }
    setPlanningOpen(true);
    setPlannerSheetSnap("half");
    setPlannerSheetDragY(null);
  }, [
    closeComposer,
    setPlannerSheetDragY,
    setPlannerSheetSnap,
    setSelectedVenueId,
    setSheetDragY,
    setSheetSnap,
  ]);

  const togglePlanning = useCallback(() => {
    if (planningOpen) closePlanning();
    else openPlanning();
  }, [closePlanning, openPlanning, planningOpen]);

  // Issue #35 — stage 1: paint pins from the slim index. This resolves in ~400 KB
  // (or instantly from IndexedDB), and is the ONLY initial venue payload for the
  // map. Full pub detail is fetched lazily via /api/venue/[id] when inspected.
  // Non-London cities load `/data/cities/{id}/venues_slim.json` via CityConfig.
  // City switches reset pins asynchronously so we never setState in the effect
  // body (react-hooks/set-state-in-effect) — same pattern as MapToolbar.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setLoaded(false);
      setSlimPins([]);
    });
    loadSlimVenuesForCity(cityId)
      .then((slim) => {
        if (cancelled || slim.length === 0) return;
        setSlimPins(slimVenuesToPins(slim));
        markPubmaxTiming("pubmax:first-pins");
        markPubmaxTiming("pubmax:slim-venues-ready");
      })
      .catch(() => {
        // Slim fetch failed with no offline mirror — render the honest empty
        // state instead of falling back to the full 6 MB client payload.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  useEffect(() => {
    if (!selectedVenueId || detailById.has(selectedVenueId)) return;
    // Always go through warmVenueDetail (cache hit → Promise.resolve) so we
    // never setState synchronously in the effect body (react-hooks/set-state-in-effect).
    let cancelled = false;
    warmVenueDetail(selectedVenueId)
      .then((venue) => {
        if (cancelled) return;
        if (!venue) throw new Error("Bad venue detail payload");
        setDetailById((current) => {
          const next = new Map(current);
          next.set(selectedVenueId, venue);
          return next;
        });
        setDetailStatusById((current) => {
          const next = new Map(current);
          next.delete(selectedVenueId);
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDetailStatusById((current) => {
          const next = new Map(current);
          next.set(selectedVenueId, "unavailable");
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedVenueId, detailById]);

  // Sourced price-refresh layer (issue #23): London-only JSON; community drops
  // always outrank it inside mergePriceUpdates. Skip the fetch for other cities
  // and ignore any stale London updates while viewing them (no setState clear).
  const [priceUpdates, setPriceUpdates] = useState<PriceUpdate[]>([]);
  useEffect(() => {
    if (cityId !== "london") return;
    let cancelled = false;
    fetch("/data/price_updates/latest.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        setPriceUpdates(parsePriceUpdates(raw));
      })
      .catch(() => {
        // No update file (or bad JSON) — baseline + community prices stand.
      });
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  const baseVenues = useMemo(() => mergeLazyDetailPins(slimPins, detailById), [slimPins, detailById]);
  const venues = useMemo<Venue[]>(
    () =>
      mergePriceUpdates(
        mergeVenueDrops(baseVenues, dropsByVenueId),
        cityId === "london" ? priceUpdates : [],
        venueUpdateKey,
      ),
    [baseVenues, dropsByVenueId, priceUpdates, cityId],
  );
  const venueById = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);
  // Base narrowing: the existing filter pipeline (story filters, price, query,
  // pint-drops). Favorite-pint re-prices inside PubMapCanvas and never changes
  // membership, so it isn't part of this set.
  const pipelineVenues = useMemo(
    () => filterMapVenues(venues, filters, (id) => Boolean(venueSignals.get(id)?.hasPintDrops)),
    [venues, filters, venueSignals],
  );
  // "Saved only" composes ON TOP of the pipeline: when on, keep only venues in
  // the saved set. When off it's a no-op, so all existing behavior is preserved.
  const filteredVenues = useMemo(
    () => (savedOnly ? pipelineVenues.filter((v) => savedIds.has(v.id)) : pipelineVenues),
    [pipelineVenues, savedOnly, savedIds],
  );

  // Deep-links from /pubs (?sel=) must still paint the pin even if a filter
  // would otherwise hide a scraped gazetteer pub.
  const canvasVenues = useMemo(
    () => withForcedVenue(filteredVenues, venueById, selectedVenueId),
    [filteredVenues, venueById, selectedVenueId],
  );

  const hasReactiveLogIntent = hasMapLogIntent(searchParams);
  const shouldBuildSuggestedRoute = !hasReactiveLogIntent || planningOpen || routeMapped;
  const suggestedRoute = useMemo(
    () => (shouldBuildSuggestedRoute ? buildCrawlRoute(filteredVenues, filters) : EMPTY_ROUTE),
    [shouldBuildSuggestedRoute, filteredVenues, filters],
  );
  const builtRoute = useMemo(
    () => builtIds.map((id) => venueById.get(id)).filter((v): v is Venue => Boolean(v)),
    [builtIds, venueById],
  );
  const route = mode === "suggest" ? suggestedRoute : builtRoute;
  const routeMappedActive = routeMapped && route.length >= 2;
  const routeForMap = useMemo(
    () => (routeMappedActive ? route : EMPTY_ROUTE),
    [routeMappedActive, route],
  );
  const routeForMapLegs = useMemo(() => buildRouteLegs(routeForMap, "walk"), [routeForMap]);
  const distanceFromUserKm = useMemo(() => {
    const firstStop = route[0];
    if (!firstStop || !userLocation) return null;
    return haversineKm(
      [userLocation.lng, userLocation.lat],
      [firstStop.longitude, firstStop.latitude],
    );
  }, [route, userLocation]);

  const selectedVenue = useMemo(
    () => (selectedVenueId ? venueById.get(selectedVenueId) : route[0]),
    [route, selectedVenueId, venueById],
  );
  const selectedVenueResolvable = selectedVenueId ? venueById.has(selectedVenueId) : false;
  const selectedDetailStatus = detailStatusFor(selectedVenueId, detailById, detailStatusById);

  // Keep the URL in sync so "Copy link" shares the current crawl.
  useCrawlUrlSync(
    useMemo(
      () => ({
        mode,
        filters,
        builtIds,
        selectedVenueId,
        bandId: activeBandId,
        altStyle,
        landmarkId: activeLandmarkId,
        crawlId: activeCrawl?.id ?? "",
      }),
      [
        mode,
        filters,
        builtIds,
        selectedVenueId,
        activeBandId,
        altStyle,
        activeLandmarkId,
        activeCrawl?.id,
      ],
    ),
  );

  // Load the venue's community Pint Drops whenever the inspected venue changes.
  const selectedId = selectedVenue?.id;
  useEffect(() => {
    if (!selectedId) {
      return;
    }
    return refreshVenueDrops(selectedId);
  }, [selectedId, refreshVenueDrops]);

  // Refresh-safety net: mirror the hand-built stops to localStorage. This effect
  // ONLY writes storage (no setState — react-hooks/set-state-in-effect is an
  // error here). The explicit Clear action removes the key via clearBuilt.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (builtIds.length) {
      window.localStorage.setItem(BUILT_STORAGE_KEY, JSON.stringify(builtIds));
    } else {
      window.localStorage.removeItem(BUILT_STORAGE_KEY);
    }
  }, [builtIds]);

  const selectVenue = useCallback(
    (id: string, initialTab: TabKey = "pints") => {
      if (!id) return;
      prefetchVenue(id);
      if (isMobileViewport()) closePlanning();
      setVenueInitialTab(initialTab);
      setSelectedVenueId(id);
      closeComposer();
      setSheetSnap("half"); // a fresh pick always opens at the readable mid-height snap
      setSheetDragY(null);
    },
    [closeComposer, closePlanning, setSelectedVenueId, setSheetSnap, setSheetDragY],
  );

  const prefetchVenueDetail = useCallback((id: string) => {
    prefetchVenue(id);
    // Also populate the shared warm cache so select can skip a second fetch.
    void warmVenueDetail(id);
  }, []);

  const logNearbyCandidates = useMemo(
    () => buildLogNearbyCandidates(filteredVenues, undefined, userLocation),
    [filteredVenues, userLocation],
  );

  const showLoadedRoute = useCallback(
    (firstStopId: string) => {
      openPlanning();
      if (isMobileViewport()) {
        setSelectedVenueId("");
        setVenueInitialTab("pints");
        closeComposer();
        setSheetSnap("half");
        setSheetDragY(null);
        return;
      }
      selectVenue(firstStopId);
    },
    [
      closeComposer,
      openPlanning,
      selectVenue,
      setSelectedVenueId,
      setSheetDragY,
      setSheetSnap,
    ],
  );

  // Persist the favorite-pint choice as the user picks it (null = clear).
  const changeFavoritePint = useCallback((beerId: string | null) => {
    setFavoritePintState(beerId);
    if (beerId) persistFavoritePint(beerId);
    else clearFavoritePint();
  }, []);

  // Flip "Saved only". Re-read the saved set from localStorage on every toggle
  // (event handler, not an effect) so a pub saved elsewhere this session is
  // reflected the moment the filter is turned on — no stale set, no reload.
  const changeSavedOnly = useCallback((next: boolean) => {
    if (next) setSavedIds(readSavedVenueIds());
    setSavedOnly(next);
  }, []);

  // Dismiss the §4.5 onboarding overlay and remember it for the session. Event
  // handler, so setState is fine; the sessionStorage write is best-effort.
  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
      } catch {
        // sessionStorage can throw (private mode / quota) — the state flag alone
        // still closes the overlay for this render session.
      }
    }
  }, []);

  // G3: dismiss the band deep-link chip for this band id (session-scoped).
  const dismissBandChip = useCallback(() => {
    const id = activeBandId;
    if (!id) return;
    setDismissedBandIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(bandChipDismissedKey(id), "1");
      } catch {
        // Best-effort; in-memory flag still closes the chip this session.
      }
    }
  }, [activeBandId]);

  const filteredVenueCount = filteredVenues.length;
  const firstRouteId = route[0]?.id ?? "";
  const firstFilteredVenueId = filteredVenues[0]?.id ?? "";
  const focusMapSearch = useCallback(() => {
    const search = document.getElementById("mapSearchInput") as HTMLInputElement | null;
    if (search) search.focus();
  }, []);

  const resetLogIntentFilters = useCallback(() => {
    setSavedOnly(false);
    setSavedIds(readSavedVenueIds());
    setFilters(seedCrawlState("").filters);
    closePlanning();
    focusMapSearch();
  }, [closePlanning, focusMapSearch, setFilters]);

  const openComposerForLog = useCallback(() => {
    closePlanning();
    setSheetSnap("full");
    setSheetDragY(null);
    dismissOnboarding();
    setComposerOpen(true);
  }, [closePlanning, dismissOnboarding, setComposerOpen, setSheetDragY, setSheetSnap]);

  const pickLogNearbyVenue = useCallback(
    (venueId: string) => {
      setLogIntentFallbackVisible(false);
      selectVenue(venueId);
      openComposerForLog();
    },
    [openComposerForLog, selectVenue],
  );

  const handleInspectorTabSelect = useCallback(
    (nextTab: TabKey) => {
      if (!isMobileViewport()) return;
      setSheetSnap(nextTab === "overview" ? "half" : "full");
      setSheetDragY(null);
    },
    [setSheetDragY, setSheetSnap],
  );

  // Core-loop entry point: the mobile Log FAB links to /map?log=1. Once the
  // fast venue list exists, turn that intent into the existing single composer
  // path: pick the best visible pub, open its sheet, and open the composer.
  useLogIntent({
    hasLogIntent: hasReactiveLogIntent,
    loaded,
    firstFilteredVenueId,
    firstRouteId,
    selectedVenueId,
    selectedVenueResolvable,
    selectVenue,
    openComposerForLog,
    setFallbackVisible: setLogIntentFallbackVisible,
  });

  // Keyboard shortcuts: "/" focuses search (unless already typing), Esc clears
  // the selected venue. The effect only adds/removes a DOM listener — the handler
  // calls setState, which is allowed (react-hooks/set-state-in-effect forbids
  // setState in the effect BODY, not in listeners it registers).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (event.key === "/" && !typing) {
        const search = document.getElementById("mapSearchInput") as HTMLInputElement | null;
        if (search) {
          event.preventDefault();
          search.focus();
        }
      } else if (event.key === "Escape") {
        // Topmost first: planner (higher z on mobile) then venue detail.
        if (planningOpen) {
          closePlanning();
          return;
        }
        setSelectedVenueId((current) => {
          if (!current) return current;
          closeComposer();
          return "";
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeComposer, closePlanning, planningOpen]);

  const toggleBuiltStop = useCallback((id: string) => {
    setBuiltIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
    setRouteMapped(true);
    setActiveCrawl(null); // a manual stop change is no longer "the curated crawl"
  }, []);

  // Reverse the hand-built route: start from the opposite end. Event handler, so
  // setState is fine; URL-sync picks up the new builtIds order automatically.
  const reverseRoute = useCallback(() => {
    setBuiltIds((current) => [...current].reverse());
    setRouteMapped(true);
    setActiveCrawl(null);
  }, []);

  const clearBuilt = useCallback(() => {
    setBuiltIds([]);
    setRouteMapped(false);
    setActiveCrawl(null);
    // Explicit Clear also drops the refresh-safety net.
    if (typeof window !== "undefined") window.localStorage.removeItem(BUILT_STORAGE_KEY);
  }, []);

  // Trust fix (§4.3): a pin tap INSPECTS ONLY, in both modes. It never mutates
  // the crawl — otherwise browsing pubs in build mode silently adds/removes
  // stops and destroys a carefully-built route. The crawl is mutated ONLY via
  // the explicit Add/Remove button in VenueInspector (which calls toggleBuiltStop).
  const handleVenueClick = useCallback(
    (id: string) => {
      selectVenue(id);
    },
    [selectVenue],
  );

  // Load a named curated crawl into Build mode. URL-sync makes it shareable.
  const loadCuratedCrawl = useCallback(
    (crawl: CuratedCrawl) => {
      setMode("build");
      setBuiltIds(crawl.venueIds);
      setRouteMapped(true);
      setFilters((current) => filtersForCuratedCrawl(current, crawl));
      setAltStyle(crawl.altStyle ?? "pint"); // "kind of night" label for copy
      setActiveCrawl(crawl); // its blurb shows under the route title until mutated
      showLoadedRoute(crawl.venueIds[0] ?? "");
      dismissOnboarding(); // picking a crawl from the overlay closes + remembers it
    },
    [
      dismissOnboarding,
      setActiveCrawl,
      setAltStyle,
      setBuiltIds,
      setFilters,
      setMode,
      setRouteMapped,
      showLoadedRoute,
    ],
  );

  // Issue #15: "Start a crawl here" from a landmark card. The canvas hands us the
  // nearest pub ids (2-3, already resolved via lib/haversine); we drop them into
  // Build mode exactly like a curated crawl so the URL (?mode=build&pubs=…) makes
  // it shareable. No new mechanism — this reuses the curated-crawl path.
  // Issue #15 landmark → journey actions (see useLandmarkJourney above).
  const { startCrawlFromPubs, askPubmaxxerAtPub } = useLandmarkJourney({
    selectVenue,
    showLoadedRoute,
    dismissOnboarding,
    setMode,
    setBuiltIds,
    setRouteMapped,
    setActiveCrawl,
    setPlanningOpen: (open) => {
      if (open) openPlanning();
      else closePlanning();
    },
  });

  // "Pubs near me": ask for location, build a crawl from the nearest matching
  // venues. Event handler (not an effect) so setState here is fine. Degrades
  // gracefully — feature-detect geolocation, catch denial, never throws.
  const startNearbyCrawl = useCallback(() => {
    setNearbyError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNearbyError("Location isn't available in this browser.");
      return;
    }
    setNearbyLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setNearbyLoading(false);
        setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        const ids = nearestVenueIds(
          position.coords.latitude,
          position.coords.longitude,
          filteredVenues,
          filters.stopCount,
        );
        if (ids.length === 0) {
          setNearbyError("No pubs match your filters near you — try widening them.");
          return;
        }
        setMode("build");
        setBuiltIds(ids);
        setRouteMapped(true);
        setActiveCrawl(null); // a near-me crawl isn't a curated one
        showLoadedRoute(ids[0]);
      },
      () => {
        setNearbyLoading(false);
        setNearbyError("Couldn't get your location. Grant access and try again.");
      },
    );
  }, [
    filteredVenues,
    filters.stopCount,
    setActiveCrawl,
    setBuiltIds,
    setMode,
    setNearbyError,
    setNearbyLoading,
    setRouteMapped,
    setUserLocation,
    showLoadedRoute,
  ]);

  const mapCurrentRoute = useCallback(() => {
    if (route.length < 2) return;
    setRouteMapped(true);
    dismissOnboarding();
    if (isMobileViewport()) closePlanning();
  }, [route.length, closePlanning, dismissOnboarding, setRouteMapped]);

  const hideMappedRoute = useCallback(() => {
    setRouteMapped(false);
  }, [setRouteMapped]);

  const checkLastTrainAtRouteEnd = useCallback(() => {
    const finalStop = route[route.length - 1];
    if (!finalStop) return;
    closePlanning();
    selectVenue(finalStop.id, "getting-home");
  }, [closePlanning, route, selectVenue]);

  const detailOpen = Boolean(selectedVenueId && selectedVenue);

  // G3: Place story deep-link chip when `?band=` resolves. Takes priority over
  // curated onboarding so the two never fight.
  const activeBand = useMemo(
    () => bandByIdForCity(cityId, activeBandId),
    [cityId, activeBandId],
  );
  const showBandChip = shouldShowBandOnboardingChip({
    loaded,
    activeBandId,
    bandResolved: Boolean(activeBand),
    chipDismissed:
      dismissedBandIds.has(activeBandId) || readBandChipDismissed(activeBandId),
  });
  // §4.5: show the "Start with a story" onboarding overlay only on a clean first
  // paint — never while the band deep-link chip is showing (G3 priority), and
  // never when this city has no curated crawls to offer.
  const showOnboarding = shouldShowCuratedOnboarding({
    loaded,
    onboardingDismissed,
    arrivedWithCrawlParams,
    mode,
    builtIdsCount: builtIds.length,
    hasActiveCrawl: Boolean(activeCrawl),
    selectedVenueId,
    showBandChip,
    curatedCrawlCount: cityCuratedCrawls.length,
  });
  // Show the first four curated crawls as the onboarding picks.
  const onboardingCrawls = cityCuratedCrawls.slice(0, 4);

  return (
    <main
      className={
        // The `sheet-full` marker only ever matters ≤640px (mapToolbar.css
        // gates every rule that reads it behind that same breakpoint) — it
        // lets the map's floating controls (toolbar/legend) get out of the
        // way while the mobile sheet is at its most-expanded snap, per the
        // thumb-reach control pass (GH #17 user story 17).
        "appShell dark" +
        (planningOpen ? " planning-open" : "") +
        (detailOpen ? " detail-open" : "") +
        // sheet-full: hide floating map chrome when either mobile sheet is at
        // its most-expanded snap (venue detail OR planner). Peek/half keep
        // the map usable — chrome stays visible above the sheet.
        ((detailOpen && sheetSnap === "full") ||
        (planningOpen && plannerSheetSnap === "full")
          ? " sheet-full"
          : "") +
        (routeMappedActive ? " route-mapped" : "") +
        (showOnboarding ? " onboarding-open" : "")
      }
    >
      <SiteNav active="map" />

      {/* Full-bleed map is the base layer; every panel slides in over it. */}
      <section className="mapStage">
        {/* Wave K2 / Issue #35 — keep the pitched-London loading chrome until
            BOTH the slim pin index and WebGL basemap scene are ready. Warmup
            can make slim pins arrive before tiles; retiring early left a blank
            canvas. Copy matches MapLoadingSkeleton for a seamless handoff. */}
        {!mapCanvasErrored && (!mapCanvasReady || (slimPins.length === 0 && !loaded)) ? (
          <div
            className="mapLoading"
            role="status"
            aria-busy="true"
            aria-live="polite"
            aria-label={`Loading the ${city.displayName} pub map. Checking cached pins, then warming live prices.`}
          >
            <div className="mapLoadingScene" aria-hidden="true">
              <span className="mapLoadingStreet mapLoadingStreet--one" />
              <span className="mapLoadingStreet mapLoadingStreet--two" />
              <span className="mapLoadingRiver" />
              <span className="mapLoadingPin mapLoadingPin--pint mapLoadingPin--one" />
              <span className="mapLoadingPin mapLoadingPin--amber mapLoadingPin--two" />
              <span className="mapLoadingPin mapLoadingPin--brick mapLoadingPin--three" />
              <span className="mapLoadingPin mapLoadingPin--pint mapLoadingPin--four" />
            </div>
            <div className="mapLoadingCopy">
              <span className="mapLoadingEyebrow">{city.displayName} pub map</span>
              <span>Checking cached pins, then warming live prices.</span>
            </div>
          </div>
        ) : null}
        <PubMapCanvas
          venues={canvasVenues}
          // Clean first view stays route-free. Once the user maps a crawl, the
          // line remains visible even if the mobile planner closes.
          route={routeForMap}
          selectedVenueId={selectedVenueId}
          onVenueClick={handleVenueClick}
          onRouteStopClick={selectVenue}
          onVenuePrefetch={prefetchVenueDetail}
          venueSignals={venueSignals}
          favoritePint={favoritePint}
          drinkCategory={filters.drinkCategory || null}
          activeBandId={activeBandId}
          onBandChange={setActiveBandId}
          onStartCrawl={startCrawlFromPubs}
          onAskPubmaxxer={askPubmaxxerAtPub}
          initialLandmarkId={seed.landmarkId}
          onLandmarkSelect={(landmark) => setActiveLandmarkId(landmark?.id ?? "")}
          onMapReady={setMapCanvasReady}
          onMapErrored={setMapCanvasErrored}
          mapView={city.mapView}
          maxBounds={cityBounds}
          fitCityOnArrival={shouldFitCityBoundsOnArrival(
            arrivalSearch,
            seed.routeMapped,
          )}
          poisPath={city.poisPath}
          transitLinesPath={city.transitLinesPath}
          cityLandmarks={cityLandmarks}
          cityStoryBands={cityStoryBands}
          cityId={cityId}
        />
        <MapToolbar
          query={filters.query}
          onQueryChange={(query) => setFilters((current) => ({ ...current, query }))}
          favoritePint={favoritePint}
          onFavoritePintChange={changeFavoritePint}
          drinkCategory={filters.drinkCategory}
          drinkBrand={filters.drinkBrand}
          onDrinkLensChange={({ drinkCategory, drinkBrand }) =>
            setFilters((current) => ({
              ...current,
              drinkCategory,
              drinkBrand,
              // Keep cocktail amenity in sync with the drink lens.
              requireCocktails:
                drinkCategory === "cocktail" ? true : drinkCategory ? false : current.requireCocktails,
            }))
          }
          planningOpen={planningOpen}
          onTogglePlanning={togglePlanning}
          filters={filters}
          onFiltersChange={setFilters}
          cityId={cityId}
        />
        <CitySuggestBanner cityId={cityId} />
        {cityId === "london" ? <CityStatusBanner cityId={cityId} /> : null}
        {logIntentFallbackVisible ? (
          <div className="logIntentFallback" role="status" aria-live="polite">
            <div>
              <strong>Pick a pub to log a Pint Drop</strong>
              <p className="description">
                {userLocation
                  ? "Nearest pubs to you first. Choose one, search, or tap the map — then we\u2019ll open the Pint Drop composer."
                  : "We won\u2019t guess which pub you\u2019re in. Choose one nearby, search, or tap the map — then we\u2019ll open the Pint Drop composer."}
              </p>
            </div>
            {logNearbyCandidates.length > 0 ? (
              <ul className="logIntentNearbyList" aria-label="Nearby pubs to log">
                {logNearbyCandidates.map((candidate) => {
                  const dist =
                    typeof candidate.distanceKm === "number" &&
                    Number.isFinite(candidate.distanceKm)
                      ? formatLogNearbyDistance(candidate.distanceKm)
                      : "";
                  return (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className="logIntentNearbyBtn"
                        onClick={() => pickLogNearbyVenue(candidate.id)}
                        onPointerEnter={() => prefetchVenueDetail(candidate.id)}
                        onTouchStart={() => prefetchVenueDetail(candidate.id)}
                      >
                        <span>{candidate.name}</span>
                        <span className="logIntentNearbyMeta">
                          {dist ? <span className="logIntentNearbyDist">{dist}</span> : null}
                          <span>{candidate.priceLabel}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="logIntentActions">
              <button type="button" className="addStopBtn" onClick={focusMapSearch}>
                Search pubs
              </button>
              {filteredVenueCount === 0 ? (
                <button type="button" className="addStopBtn" onClick={resetLogIntentFilters}>
                  Show all pubs
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <ActiveRoundChip refreshKey={activeRoundStartedCode} />
        {routeMappedActive ? (
          <div className="mappedRouteChip" role="status" aria-live="polite">
            <RouteIcon size={16} aria-hidden="true" />
            <div>
              <strong>{route.length} stops mapped</strong>
              <span>
                <Footprints size={12} aria-hidden="true" />
                {routeForMapLegs.totalKm.toFixed(1)} km, {routeForMapLegs.totalMinutes} min walk
              </span>
            </div>
            <button type="button" onClick={openPlanning}>
              Edit
            </button>
            <button
              type="button"
              onClick={checkLastTrainAtRouteEnd}
              aria-label="Check last train at final stop"
              title="Last train"
            >
              <TrainFront size={14} aria-hidden="true" />
            </button>
            <button type="button" onClick={hideMappedRoute} aria-label="Hide mapped crawl">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {/* G3: Place story deep-link chip — corridor title + one-line copy when
            `?band=` resolves. Distinct dismiss key from curated onboarding;
            suppresses that overlay while visible. */}
        {showBandChip && activeBand ? (
          <div className="bandOnboardingChip" role="status" aria-live="polite">
            <div>
              <strong>{activeBand.title}</strong>
              <span>{truncateBandCopy(activeBand.copy)}</span>
            </div>
            <button type="button" onClick={dismissBandChip}>
              Walk this story
            </button>
            <button
              type="button"
              onClick={dismissBandChip}
              aria-label="Dismiss Place story intro"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {/* Wave J declutter: Prices control owns the key on all viewports
            (pin colours + popover). Static mid-map legend removed. */}
        <MapPriceControl filters={filters} onFiltersChange={setFilters} />

        {/* §4.5 onboarding overlay: a dismissible "Start with a story" card that
            offers curated crawls on a clean first paint. It's the mobile
            onboarding (control rail is hidden on small screens) and never blocks
            the map — the backdrop and the link both close it. */}
        {showOnboarding ? (
          <div
            className="mapOnboarding"
            role="dialog"
            aria-modal="false"
            aria-labelledby="onboardingTitle"
          >
            <button
              type="button"
              className="mapOnboardingScrim"
              aria-label="Dismiss and explore the map"
              onClick={dismissOnboarding}
            />
            <div className="mapOnboardingCard">
              <button
                type="button"
                className="mapOnboardingClose"
                onClick={dismissOnboarding}
                aria-label="Close"
              >
                <X size={16} />
              </button>
              <p className="eyebrow">New here?</p>
              <h2 id="onboardingTitle">Start with a story</h2>
              <p className="mapOnboardingLead">
                Curated crawls — one generation&rsquo;s pubs, handed to the next. Pick one to drop it
                on the map, or explore on your own.
              </p>
              <div className="mapOnboardingList">
                {onboardingCrawls.map((crawl) => (
                  <button
                    key={crawl.id}
                    type="button"
                    className="mapOnboardingCrawl"
                    aria-label={`Load the ${crawl.name} crawl — ${crawl.venueIds.length} stops`}
                    onClick={() => loadCuratedCrawl(crawl)}
                  >
                    <span className="mapOnboardingCrawlHead">
                      <strong>{crawl.name}</strong>
                      <span className="mapOnboardingCount">
                        {crawl.venueIds.length} stop{crawl.venueIds.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="mapOnboardingBlurb">{crawl.blurb}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="mapOnboardingDismiss"
                onClick={dismissOnboarding}
              >
                Dismiss / explore the map
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Left drawer: the whole crawl planner, on demand.
          On mobile (≤640px) this is a drag bottom-sheet with the same snap
          points as the venue sheet (peek/half/full — lib/sheetSnap.ts). Opens
          at half so the map stays partially visible. Desktop is unchanged —
          side drawer, no gesture. */}
      <div
        className={
          (planningOpen ? "mapDrawer left open" : "mapDrawer left") +
          (planningOpen ? ` sheet-${plannerSheetSnap}` : "") +
          (plannerSheetDragY !== null ? " sheet-dragging" : "")
        }
        aria-hidden={!planningOpen}
        aria-modal={planningOpen && plannerSheetSnap === "full" ? true : undefined}
        role={planningOpen && plannerSheetSnap === "full" ? "dialog" : undefined}
        aria-label={planningOpen && plannerSheetSnap === "full" ? "Crawl planner" : undefined}
        style={
          plannerSheetDragY !== null
            ? {
                transform: `translateY(${Math.max(0, sheetTranslateY(plannerSheetSnap, typeof window === "undefined" ? 0 : window.innerHeight) + plannerSheetDragY)}px)`,
                transition: "none",
              }
            : undefined
        }
      >
        <div
          className="mapDrawerHead sheetDragHandle plannerSheetHead"
          onPointerDown={onPlannerSheetDragStart}
          onPointerMove={onPlannerSheetDragMove}
          onPointerUp={onPlannerSheetDragEnd}
          onPointerCancel={onPlannerSheetDragEnd}
        >
          <span className="venueSheetGrabZone" aria-hidden="true">
            <span className="venueSheetGrab" />
          </span>
        </div>
        {planningOpen ? (
          <>
            <button
              type="button"
              className="plannerMapButton"
              onClick={closePlanning}
            >
              <MapPinned size={16} aria-hidden="true" />
              View {city.displayName} map
            </button>
            <ControlRail
              mode={mode}
              onModeChange={setMode}
              filters={filters}
              onFiltersChange={setFilters}
              filteredVenues={filteredVenues}
              builtCount={builtIds.length}
              onClearBuilt={clearBuilt}
              onLoadCrawl={loadCuratedCrawl}
              onNearbyCrawl={startNearbyCrawl}
              nearbyLoading={nearbyLoading}
              nearbyError={nearbyError}
              savedOnly={savedOnly}
              onSavedOnlyChange={changeSavedOnly}
              curatedCrawls={cityCuratedCrawls}
              cityDisplayName={city.displayName}
              cityId={cityId}
            />
            <RoutePanel
              mode={mode}
              crawlStyle={filters.crawlStyle}
              altStyle={altStyle}
              onAltStyleChange={setAltStyle}
              route={route}
              filteredVenues={filteredVenues}
              builtIds={builtIds}
              activeVenueId={selectedVenue?.id}
              venueSignals={venueSignals}
              crawlBlurb={activeCrawl?.blurb}
              crawlName={activeCrawl?.name}
              crawlId={activeCrawl?.id}
              routeMapped={routeMappedActive}
              originDistanceKm={distanceFromUserKm}
              onMapRoute={mapCurrentRoute}
              onHideRoute={hideMappedRoute}
              onCheckLastTrain={checkLastTrainAtRouteEnd}
              onSelectVenue={selectVenue}
              onToggleStop={toggleBuiltStop}
              onReverseRoute={reverseRoute}
              cityDisplayName={city.displayName}
              cityId={cityId}
              poisPath={city.poisPath}
              onRoundStarted={setActiveRoundStartedCode}
            >
              {loaded && filteredVenues.length === 0 ? (
                savedOnly && savedIds.size === 0 ? (
                  <section className="venueInspector" style={{ textAlign: "center" }}>
                    <p className="description" style={{ marginTop: 0 }}>
                      No saved pubs yet — tap a pub and Save it, then flip &ldquo;Saved only&rdquo;
                      back on to see just your list.
                    </p>
                    <button
                      type="button"
                      className="addStopBtn"
                      onClick={() => changeSavedOnly(false)}
                    >
                      Show all pubs
                    </button>
                  </section>
                ) : (
                  <section className="venueInspector" style={{ textAlign: "center" }}>
                    <p className="description" style={{ marginTop: 0 }}>
                      No pubs match these filters — try widening your price or clearing your story
                      filters.
                    </p>
                    <button
                      type="button"
                      className="addStopBtn"
                      onClick={() => setFilters(seedCrawlState("").filters)}
                    >
                      Clear filters
                    </button>
                  </section>
                )
              ) : null}
            </RoutePanel>
          </>
        ) : null}
      </div>

      {/* Right drawer: the selected pub's detail — opens only on an explicit pick.
          On mobile (≤640px) this is a true drag bottom-sheet with snap points
          (peek/half/full — lib/sheetSnap.ts). The snap class drives the resting
          transform in CSS; sheetDragY (a live px offset) only exists mid-drag, so
          a release always lands back on a snap-driven CSS transition, never a
          hand-picked pixel position. Desktop ignores both — no drag handlers
          fire above the gesture breakpoint, and the extra classes/attrs are
          no-ops there (see venueSheet.css / globals.css .mapDrawer rules). */}
      <div
        className={
          (detailOpen ? "mapDrawer right open" : "mapDrawer right") +
          (detailOpen ? ` sheet-${sheetSnap}` : "") +
          (sheetDragY !== null ? " sheet-dragging" : "")
        }
        aria-hidden={!detailOpen}
        // The sheet only claims modal semantics at its "full" snap, where it
        // visually covers virtually the whole viewport (92vh) — at peek/half
        // enough of the map stays visible/reachable that a true modal trap
        // would be wrong (the user can still see and return to the map).
        aria-modal={detailOpen && sheetSnap === "full" ? true : undefined}
        role={detailOpen && sheetSnap === "full" ? "dialog" : undefined}
        aria-label={detailOpen && sheetSnap === "full" ? "Pub detail" : undefined}
        style={
          sheetDragY !== null
            ? {
                transform: `translateY(${Math.max(0, sheetTranslateY(sheetSnap, typeof window === "undefined" ? 0 : window.innerHeight) + sheetDragY)}px)`,
                transition: "none",
              }
            : undefined
        }
      >
        <div
          className="mapDrawerHead sheetDragHandle"
          onPointerDown={onSheetDragStart}
          onPointerMove={onSheetDragMove}
          onPointerUp={onSheetDragEnd}
          onPointerCancel={onSheetDragEnd}
        >
          <button
            type="button"
            className="drawerClose"
            onClick={() => {
              setSelectedVenueId("");
              closeComposer();
            }}
            aria-label="Close pub detail"
          >
            <X size={16} />
          </button>
        </div>
        {detailOpen && selectedVenue ? (
          <>
            {selectedDetailStatus === "loading" ? <VenueSheetSkeleton /> : null}
            {selectedDetailStatus === "unavailable" ? (
              <div style={DETAIL_WARNING_STYLE} role="status">
                Showing fast map details. Full pub notes are unavailable right now.
              </div>
            ) : null}
            <VenueInspector
              venue={selectedVenue}
              mode={mode}
              inCrawl={builtIds.includes(selectedVenue.id)}
              latestContributorPrice={venueSignals.get(selectedVenue.id)?.latestContributorPrice}
              onToggleStop={toggleBuiltStop}
              onSelectVenue={selectVenue}
              initialTab={venueInitialTab}
              pintDrops={pintDrops}
              onGrabDragStart={onSheetDragStart}
              onGrabDragMove={onSheetDragMove}
              onGrabDragEnd={onSheetDragEnd}
              onTabSelect={handleInspectorTabSelect}
              cityLandmarks={cityLandmarks}
              cityStoryBands={cityStoryBands}
              cityCuratedCrawls={cityCuratedCrawls}
              cityId={cityId}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
