"use client";

import { MapPinned, ShieldCheck, Sparkles, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import SiteNav from "@/components/nav/SiteNav";
import ThemeToggle from "@/components/ThemeToggle";
import "@/components/map/venueSheet.css";
import "@/components/map/spillComposer.css";
import "@/components/map/logIntentFallback.css";

import {
  buildCrawlRoute,
  formatPrice,
  mergeVenueDrops,
  type Filters,
  type Venue,
} from "@/lib/venues";
import { filterMapVenues, withForcedVenue } from "@/lib/filterMapVenues";
import { mergePriceUpdates, parsePriceUpdates, type PriceUpdate } from "@/lib/priceUpdates";
import { nearestVenueIds, nearbyVenuesForMap } from "@/lib/nearby";
import { buildMapVenueListModel } from "@/lib/mapVenueList";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { MOBILE_MEDIA_QUERY } from "@/lib/breakpoints";
import PubMapCanvas from "@/components/PubMapCanvas";
import MobileMapShell from "@/components/mobile/MobileMapShell";
import { Sheet } from "@/components/ui/sheet";
import MobileTflPanel, { useMobileTflStatus } from "@/components/mobile/MobileTflPanel";
import { SearchField } from "@/components/ui/search-field";
import { Button } from "@/components/ui/button";
import type { GeneratedMobilePlan } from "@/components/plan/MobilePlanActivation";
const MobilePlanActivation = dynamic(
  () =>
    import("@/components/plan/MobilePlanActivation").then(
      (m) => m.MobilePlanActivation,
    ),
  { ssr: false },
);
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DrinkShapeChips from "@/components/map/DrinkShapeChips";
import FavoritePintPicker from "@/components/map/FavoritePintPicker";
import PersonaLensPicker from "@/components/map/PersonaLensPicker";
import PersonaLensCard from "@/components/map/PersonaLensCard";
import { usePersonaTonightCategory } from "@/components/map/usePersonaTonight";
import { findPersonaById, personaHighlightsPubs, type PersonaDrink } from "@/lib/personaDrinks";
import MapLayersControl from "@/components/map/MapLayersControl";
// Perf (mobile map budget): the planner rail/route panel, venue inspector,
// mobile plan activation, and the desktop-only map chrome below are NOT on the
// first mobile map paint — the planner and inspector only mount after a user
// opens them (planningOpen / detailOpen), and the desktop chrome never mounts
// on a phone viewport at all. Statically importing them fused their JS into the
// eager map chunk that must parse before the WebGL canvas can mount. Loading
// them via next/dynamic (ssr:false — the whole PubMap tree is already client
// only) splits each into its own lazy chunk fetched on demand, so a cold mobile
// /map load ships materially less JS to parse before first tile paint.
const ControlRail = dynamic(() => import("@/components/map/ControlRail"), {
  ssr: false,
});
import { type CuratedCrawl } from "@/lib/curatedCrawls";
import { curatedCrawlsForCity } from "@/lib/cityCuratedCrawls";
import { landmarksForCity } from "@/lib/cityLandmarks";
import { storyBandsForCity, bandByIdForCity } from "@/lib/cityStoryBands";
const RoutePanel = dynamic(() => import("@/components/map/RoutePanel"), {
  ssr: false,
});
import ActiveRoundChip from "@/components/map/ActiveRoundChip";
import type { TabKey } from "@/components/map/VenueInspector";
const VenueInspector = dynamic(
  () => import("@/components/map/VenueInspector"),
  { ssr: false },
);
import VenueSheetSkeleton from "@/components/map/VenueSheetSkeleton";
const MapToolbar = dynamic(() => import("@/components/map/MapToolbar"), {
  ssr: false,
});
// List view (a11y keyboard venue path) joins the off-critical-path dynamic set:
// it renders on demand, so it must not enter the eager map chunk (#306 budget).
const MapVenueList = dynamic(() => import("@/components/map/MapVenueList"), {
  ssr: false,
});
const MapPriceControl = dynamic(
  () => import("@/components/map/MapPriceControl"),
  { ssr: false },
);
const CitySuggestBanner = dynamic(
  () => import("@/components/map/CitySuggestBanner"),
  { ssr: false },
);
const CityStatusBanner = dynamic(
  () => import("@/components/map/CityStatusBanner"),
  { ssr: false },
);
import { useCrawlJourneys } from "@/components/map/useCrawlJourneys";
import { useTonightOpportunities } from "@/components/map/useTonightOpportunities";
import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
const TonightLane = dynamic(() => import("@/components/map/TonightLane"), {
  ssr: false,
});
import type { LocationRequestStatus } from "@/components/map/VenueGettingThere";
const MapConciergeAsk = dynamic(
  () => import("@/components/map/MapConciergeAsk"),
  { ssr: false },
);
import { trackEvent } from "@/lib/analytics";
import { writePreferredCity } from "@/lib/cityPreference";
import { usePintDrops } from "@/components/map/usePintDrops";
import { useLiveDrops } from "@/components/map/useLiveDrops";
import { useSheetDrag } from "@/components/map/useSheetDrag";
import { useBuiltIdsPersistence } from "@/components/map/pubmap/useBuiltIdsPersistence";
import { useSelParamSync } from "@/components/map/pubmap/useSelParamSync";
import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";
import { useLandmarkJourney } from "@/components/map/pubmap/useLandmarkJourney";
import { useLogIntent } from "@/components/map/pubmap/useLogIntent";
import { MappedRouteChip } from "@/components/map/pubmap/MappedRouteChip";
import { BandOnboardingChip } from "@/components/map/pubmap/BandOnboardingChip";
import { MapOnboardingOverlay } from "@/components/map/pubmap/MapOnboardingOverlay";
const LogIntentFallback = dynamic(
  () =>
    import("@/components/map/pubmap/LogIntentFallback").then(
      (m) => m.LogIntentFallback,
    ),
  { ssr: false },
);
import { useActivePlanRoute } from "@/components/map/pubmap/useActivePlanRoute";
import { useMapPlanCoordinator, useMapPlanPresentation } from "@/components/map/pubmap/useMapPlanCoordinator";
import { planStopsToRouteVenues } from "@/lib/activePlanRoute";
import { sheetTranslateY } from "@/lib/sheetSnap";
import { seedCrawlState, useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import type { AltCrawlStyle } from "@/lib/crawlUrl";
import {
  clearFavoritePint,
  getFavoritePint,
  setFavoritePint as persistFavoritePint,
} from "@/lib/favoritePint";
import { getSaved } from "@/lib/savedPubs";
import { createSlimShardLoader, type MapBounds, type SlimShardLoader } from "@/lib/slimShards";
import type { SlimVenue } from "@/lib/venuesSlim";
import {
  cityMaxBounds,
  DEFAULT_CITY_ID,
  getCity,
  type CityId,
} from "@/lib/cities";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { slimVenuesToPins } from "@/lib/slimPins";
import { computeZonePintIndex } from "@/lib/zones";
import ZonePicker from "@/components/map/ZonePicker";
import { haversineKm } from "@/lib/haversine";
import { mergeLazyDetailPins } from "@/lib/lazyVenueDetail";
import {
  buildLogNearbyCandidates,
  hasMapLogIntent,
} from "@/lib/mapLogIntent";
import prefetchVenue from "@/lib/prefetchVenue";
import { warmVenueDetail } from "@/lib/warmVenueDetail";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import { markPalRouteActivation } from "@/lib/pubPal";
import {
  bandChipDismissedKey,
  shouldShowBandOnboardingChip,
  shouldShowCuratedOnboarding,
} from "@/lib/bandOnboardingChip";
import {
  shouldOpenPlanningInitially,
  shouldFitQueryVenuesOnArrival,
  resolveQueryRestoreFit,
} from "@/lib/mapArrival";
import { getNightArea, nearestNightAreaForViewport, nightAreaForMapQuery } from "@/lib/nightAreas";
import { defaultPoiHiddenForViewport } from "@/lib/poiToggleGroups";
import {
  readMobileMapSession,
  withCityCameraAttitude,
  writeMobileMapSession,
  type MobileShellState,
  type MapOverlay,
  type MapViewportSnapshot,
  type NearbyMapResult,
} from "@/lib/mobileShell";
import {
  hasCrawlArrivalParams,
  filtersForCuratedCrawl,
  buildMapSeed,
  detailStatusFor,
  venueUpdateKey,
  normaliseTonightVenueLookup,
  type MapSeed,
  type VenueDetailStatus,
} from "@/lib/pubMap";

// The "Near me now" instant-answer cards (Cycle 3, Lane 1). Loaded lazily so it
// never rides in the eager map chunk (perf budget, PR #306) — it only mounts
// when the Near-me sheet opens, and answers from the already-loaded venues.
const NearMeNow = dynamic(() => import("@/components/nearme/NearMeNow"), { ssr: false });

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

// hasCrawlArrivalParams (pure §4.5 deep-link probe) now lives in @/lib/pubMap.

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function subscribeMobileViewport(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function mobileViewportSnapshot(): boolean {
  return isMobileViewport();
}

// mergeVenueDrops (lib/venues.ts) folds drops into DERIVED SUMMARY SIGNALS only:
// a bare price is never a story, and demo seeds never move prices or hasStory.

// Hand-built stop ids are mirrored to localStorage while a crawl is active.
// Clean /map arrivals do NOT auto-restore from this key (that made tab links
// look weird by dumping stale ?pubs= into the address bar). The URL is the
// only share/restore source.
const BUILT_STORAGE_KEY = "pubmax_built_ids";

// crawlStopsFromPubIds, filtersForCuratedCrawl, resolveSeededCuratedCrawl,
// MapSeed and buildMapSeed (all pure) now live in @/lib/pubMap.

// useLandmarkJourney and useLogIntent now live in
// components/map/pubmap/useLandmarkJourney.ts and .../useLogIntent.ts.

// §4.5 curated-crawl onboarding: dismissal is per-session so a reload during the
// same visit doesn't re-nag, but a fresh session gets the offer again. sessionStorage
// (not localStorage) keeps it a gentle, per-visit prompt.
const ONBOARDING_DISMISSED_KEY = "pubmax_onboarding_dismissed";
const TONIGHT_OVERLAY_DISMISSED_KEY = "pubmaxx.tonightOverlay.dismissed";
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

// VenueDetailStatus, detailStatusFor and venueUpdateKey (all pure) now live in
// @/lib/pubMap.

type UserLocation = {
  lat: number;
  lng: number;
};

function readOnboardingDismissed(): boolean {
  if (typeof window === "undefined") return true; // SSR: never render the overlay server-side
  try {
    return window.sessionStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function readTonightOverlayDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(TONIGHT_OVERLAY_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

// normaliseTonightVenueLookup (pure) now lives in @/lib/pubMap.

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
  const mobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    mobileViewportSnapshot,
    () => false,
  );
  const isLondon = cityId === "london";
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
  const [restoredMobileSession] = useState(() => {
    if (currentSearch()) return null;
    const saved = readMobileMapSession();
    return saved?.cityId === cityId ? saved : null;
  });
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
  // Pair settlement with its city. On a client-side city switch there is one
  // render before the loading effect clears old pins; this prevents that prior
  // city's index from producing a transient, dishonest search result.
  const [loadedCityId, setLoadedCityId] = useState<CityId | null>(null);
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
  const [selectedVenueId, setSelectedVenueId] = useState<string>(
    seed.selectedVenueId || restoredMobileSession?.selectedVenueId || "",
  );
  const [venueInitialTab, setVenueInitialTab] = useState<TabKey>("overview");
  const [filters, setFilters] = useState<Filters>(restoredMobileSession?.filters ?? seed.filters);
  const [mapOverlay, setMapOverlay] = useState<MapOverlay>(() => {
    const restored = restoredMobileSession?.openSheet;
    return restored && !["venue", "planner"].includes(restored) ? restored : "none";
  });
  const [mapViewport, setMapViewport] = useState<MapViewportSnapshot>(() =>
    restoredMobileSession?.viewport
      ? withCityCameraAttitude(restoredMobileSession.viewport, city.mapView)
      : city.mapView,
  );
  const [poiHidden, setPoiHidden] = useState(defaultPoiHiddenForViewport);
  const [mobileLayersTab, setMobileLayersTab] = useState<"layers" | "prices" | "events" | "transit">("layers");
  const tflStatus = useMobileTflStatus();
  const [nearbyMapResult, setNearbyMapResult] = useState<NearbyMapResult | null>(null);
  const {
    mode,
    setMode,
    builtIds,
    setBuiltIds,
    routeMapped,
    setRouteMapped,
    planningOpen,
    setPlanningOpen,
    plannedNightArea,
    activateGeneratedPlan,
  } = useMapPlanCoordinator({
    mode: seed.mode,
    builtIds: seed.builtIds,
    routeMapped: seed.routeMapped,
    nightArea: restoredMobileSession?.nightArea ?? null,
    planningOpen: !seed.selectedVenueId &&
      restoredMobileSession?.openSheet !== "venue" &&
      (restoredMobileSession?.openSheet === "planner" ||
        shouldOpenPlanningInitially(seed.builtIds, seed.mode, currentSearch())),
  });
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
  // Explicit route mapping: a suggested crawl can exist without drawing on the
  // clean first map. Once the user chooses "Map route" (or a curated/nearby
  // crawl), keep the line visible even if the mobile planner closes.
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
  // Purpose-limited copy used only after the viewer explicitly asks for travel
  // times. A location granted for "Pubs near me" must not silently become a
  // precise journey request for every venue they inspect.
  const [venueJourneyLocation, setVenueJourneyLocation] =
    useState<UserLocation | null>(null);
  const [locationRequestStatus, setLocationRequestStatus] =
    useState<LocationRequestStatus>("idle");
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
  const [tonightOverlayVisible, setTonightOverlayVisible] = useState(false);
  const [tonightDismissed, setTonightDismissed] = useState<boolean>(
    readTonightOverlayDismissed,
  );
  // W2: the live-events lane is map-first — a compact top chip until requested.
  const [tonightLaneOpen, setTonightLaneOpen] = useState(false);
  const [mapListOpen, setMapListOpen] = useState(false);

  // Community Pint Drops: fetch/submit/report state lives in the hook.
  // City-scoped so Manchester demo seeds colour Manchester pins without
  // leaking into the London feed/landing.
  const pintDrops = usePintDrops(cityId);
  const { dropsByVenueId, venueSignals, refreshVenueDrops, closeComposer, setComposerOpen } =
    pintDrops;
  // Live map pins (issue #37): refetch the drops layer on a new-drop signal (or
  // a 30s poll when realtime is unavailable). Self-contained, signal-only.
  useLiveDrops(pintDrops.refreshAllDrops);
  const { opportunities: tonightOpportunities, status: tonightStatus } =
    useTonightOpportunities(isLondon);
  // W1: PRIMARY What's-On spine — venueId-joined pub events on tonight. Feeds
  // the pin badges (summary) and the Tonight lane (rows).
  const whatsOnTonight = useWhatsOnTonight(isLondon);

  // Mobile bottom-sheet drag (GH #17) — state + pointer handlers live in
  // useSheetDrag. Two instances: venue (right) and planner (left). A fling
  // past peek dismisses that sheet. "half" is the default resting snap;
  // open/pick handlers re-assert it below.
  const dismissSheet = useCallback(() => {
    setSelectedVenueId("");
    setMapOverlay("none");
    closeComposer();
    if (hasMapLogIntent(currentSearch())) setLogIntentFallbackVisible(true);
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
    setMapOverlay("none");
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
    setMapOverlay("none");
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

  // Issue #35 + Cycle-5 sharding — stage 1: paint pins from the slim index's
  // CORE shard (inner-London priced index, ~515 KB, or instantly from
  // IndexedDB). This is the ONLY eager first-paint venue payload; the hollow
  // Outer-London boroughs (#315) stream in lazily as the viewport intersects
  // them or near-me geolocates into them (see the two effects below). Full pub
  // detail is still fetched lazily via /api/venue/[id] when inspected.
  //
  // One code path: the shard loader (lib/slimShards.ts) hides fetching, dedup,
  // offline mirroring, and the single-file fallback for cities that ship no
  // manifest (non-London packs behave exactly as before). City switches reset
  // pins asynchronously so we never setState in the effect body.
  const slimLoaderRef = useRef<SlimShardLoader | null>(null);

  // Merge lazily-loaded shard venues into the painted pins, dedup by id. A
  // no-op update returns the previous array so React skips a re-render.
  const mergeSlimVenues = useCallback((rows: SlimVenue[]) => {
    if (rows.length === 0) return;
    setSlimPins((prev) => {
      const byId = new Map(prev.map((pin) => [pin.id, pin]));
      let added = false;
      for (const pin of slimVenuesToPins(rows)) {
        if (!byId.has(pin.id)) {
          byId.set(pin.id, pin);
          added = true;
        }
      }
      return added ? Array.from(byId.values()) : prev;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loader = createSlimShardLoader(cityId);
    slimLoaderRef.current = loader;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setLoaded(false);
      setLoadedCityId(null);
      setSlimPins([]);
    });
    loader
      .core()
      .then((slim) => {
        if (cancelled || slim.length === 0) return;
        setSlimPins(slimVenuesToPins(slim));
        markPubmaxTiming("pubmax:first-pins");
        markPubmaxTiming("pubmax:slim-venues-ready");
      })
      .catch(() => {
        // Core fetch failed with no offline mirror — render the honest empty
        // state instead of falling back to the full 6 MB client payload.
      })
      .finally(() => {
        if (!cancelled) {
          setLoadedCityId(cityId);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
      if (slimLoaderRef.current === loader) slimLoaderRef.current = null;
    };
  }, [cityId]);

  // Lazy outer shards: whenever the map settles on a viewport, load the shards
  // it intersects and merge their pins. Already-loaded shards are skipped by
  // the loader; a failed shard is not marked loaded, so a later moveend retries
  // it — the map keeps working with whatever loaded.
  const handleMapBoundsChange = useCallback(
    (bounds: MapBounds) => {
      const loader = slimLoaderRef.current;
      if (!loader) return;
      void loader
        .inBounds(bounds)
        .then((rows) => mergeSlimVenues(rows))
        .catch(() => {
          // Keep loaded shards; a later moveend retries this one.
        });
    },
    [mergeSlimVenues],
  );

  // Near-me: geolocating into a hollow outer borough loads that borough's shard
  // (with one retry inside the loader) so the nearby pins exist. Until it lands
  // the near-me flows fall back honestly to the already-loaded pins.
  useEffect(() => {
    const loc = userLocation ?? venueJourneyLocation;
    if (!loc) return;
    const loader = slimLoaderRef.current;
    if (!loader) return;
    let cancelled = false;
    void loader
      .nearPoint(loc.lat, loc.lng)
      .then((rows) => {
        if (!cancelled) mergeSlimVenues(rows);
      })
      .catch(() => {
        // Honest fallback: keep whatever pins already loaded.
      });
    return () => {
      cancelled = true;
    };
  }, [userLocation, venueJourneyLocation, mergeSlimVenues]);

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
  // Zone pint index (nearest-station fare zone medians) for the zone picker.
  // Computed off the full venue set so the strip's numbers don't shift as the
  // user filters — it's a stable "here's the lay of the land" reference.
  const zoneIndex = useMemo(() => computeZonePintIndex(venues), [venues]);
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
  const nearbyVenueIds = useMemo(
    () => nearbyMapResult ? new Set(nearbyMapResult.venueIds) : null,
    [nearbyMapResult],
  );
  const mapMembershipVenues = useMemo(
    () => nearbyVenueIds
      ? filteredVenues.filter((venue) => nearbyVenueIds.has(venue.id))
      : filteredVenues,
    [filteredVenues, nearbyVenueIds],
  );
  const canvasVenues = useMemo(
    () => withForcedVenue(mapMembershipVenues, venueById, selectedVenueId),
    [mapMembershipVenues, venueById, selectedVenueId],
  );
  // A11Y finding #1 — keyboard/SR-reachable model of the venues on the map,
  // ordered nearest-first to the viewport centre. Same set the canvas paints.
  const mapVenueListModel = useMemo(
    () => buildMapVenueListModel(mapMembershipVenues, mapViewport.center),
    [mapMembershipVenues, mapViewport.center],
  );

  const hasReactiveLogIntent = hasMapLogIntent(searchParams);
  const shouldBuildSuggestedRoute = !hasReactiveLogIntent || planningOpen || routeMapped;
  const suggestedRoute = useMemo(
    () => (shouldBuildSuggestedRoute ? buildCrawlRoute(filteredVenues, filters) : EMPTY_ROUTE),
    [shouldBuildSuggestedRoute, filteredVenues, filters],
  );
  // C2 — a plan that's "on tonight" (lib/activePlan) draws on the map through
  // the SAME route paint the crawl planner uses. useActivePlanRoute carries the
  // live plan's stops; planStopsToRouteVenues resolves them (ordered, deduped,
  // real pins only) against the live venue index. Honest-empty: no active plan,
  // or none of its stops on the map, → [] → no overlay.
  const activePlanStops = useActivePlanRoute();
  const activePlanRoute = useMemo(
    () => planStopsToRouteVenues(activePlanStops, venueById),
    [activePlanStops, venueById],
  );
  const { route, routeMappedActive, routeForMap, routeForMapLegs } = useMapPlanPresentation({
    mode,
    builtIds,
    routeMapped,
    suggestedRoute,
    activePlanRoute,
    venueById,
  });
  // A suggested route exists behind the clean map, but its TfL legs are only
  // useful once the planner is open or the viewer explicitly maps it.
  const {
    byToIndex: journeyByToIndex,
    loading: journeyLoading,
    totalMinutes: journeyTotalMinutes,
  } = useCrawlJourneys(route, isLondon && (planningOpen || routeMappedActive));
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

  const venueIdByNormalisedName = useMemo(() => {
    const map = new Map<string, string>();
    for (const venue of venues) {
      const key = normaliseTonightVenueLookup(venue.name);
      if (key && !map.has(key)) map.set(key, venue.id);
    }
    return map;
  }, [venues]);

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

  useEffect(() => {
    if (tonightStatus !== "ready" || tonightDismissed) return;
    Promise.resolve().then(() => setTonightOverlayVisible(true));
  }, [tonightStatus, tonightDismissed]);

  // Refresh-safety net: mirror hand-built stops to localStorage (see
  // components/map/pubmap/useBuiltIdsPersistence.ts).
  useBuiltIdsPersistence(builtIds, BUILT_STORAGE_KEY);

  const selectVenue = useCallback(
    (id: string, initialTab: TabKey = "overview") => {
      if (!id) return;
      prefetchVenue(id);
      setTonightLaneOpen(false);
      setMapOverlay("none");
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

  // ?sel= client-nav sync — verbatim in components/map/pubmap/useSelParamSync.ts.
  const selParam = searchParams?.get("sel") ?? "";
  useSelParamSync({ selParam, selectedVenueId, selectVenue });

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

  // Persona "Drink like..." lens. The picker sets filters.drinkCategory so the
  // lens RIDES the existing drink-category filter path (filterVenues +
  // pubsToGeoJSON) instead of forking a new pin pipeline; we only track WHICH
  // persona is active so the card can render. Conditions cross-link: personas
  // whose category fits tonight sort first (usePersonaTonightCategory reuses the
  // shared /api/tonight-conditions verdict, no duplicated weather rules).
  const [personaLensId, setPersonaLensId] = useState<string | null>(null);
  const personaTonightCategory = usePersonaTonightCategory(isLondon);

  const selectPersona = useCallback((persona: PersonaDrink | null) => {
    if (!persona) {
      setPersonaLensId(null);
      setFilters((current) => ({
        ...current,
        drinkCategory: "",
        drinkBrand: "",
        requireCocktails: false,
      }));
      return;
    }
    setPersonaLensId(persona.id);
    setFavoritePintState(null);
    // Non-alcoholic / uncovered orders (water, Cherry Coke, milk) would filter
    // the map to empty, so we leave the drink filter cleared and just show the
    // card, no lens dead-end. Everything else rides the drink-category path.
    const highlights = personaHighlightsPubs(persona);
    setFilters((current) => ({
      ...current,
      drinkCategory: highlights ? persona.drinkCategory : "",
      drinkBrand: "",
      requireCocktails: highlights && persona.drinkCategory === "cocktail",
    }));
  }, []);

  // The card shows while the active persona still owns the live drink lens.
  // Highlighting personas hold the card while their category is the active
  // filter; non-highlighting (non-alcoholic) personas hold it while no other
  // drink lens has taken over (drinkCategory stays cleared). Either way,
  // selecting a different lens by any control implicitly retires the card.
  const activePersona = useMemo(() => {
    if (!personaLensId) return null;
    const persona = findPersonaById(personaLensId);
    if (!persona) return null;
    const owns = personaHighlightsPubs(persona)
      ? persona.drinkCategory === filters.drinkCategory
      : filters.drinkCategory === "";
    return owns ? persona : null;
  }, [personaLensId, filters.drinkCategory]);

  // Flip "Saved only". Re-read the saved set from localStorage on every toggle
  // (event handler, not an effect) so a pub saved elsewhere this session is
  // reflected the moment the filter is turned on — no stale set, no reload.
  const changeSavedOnly = useCallback((next: boolean) => {
    if (next) setSavedIds(readSavedVenueIds());
    setSavedOnly(next);
  }, []);

  const handleTonightOpportunityClick = useCallback(
    (op: ThingsToDoOpportunity) => {
      const label = op.place?.name?.trim() || op.title.trim();
      if (!label) return;
      const venueId = venueIdByNormalisedName.get(normaliseTonightVenueLookup(label));
      if (venueId) {
        selectVenue(venueId);
        return;
      }
      setFilters((current) => ({ ...current, query: label }));
    },
    [selectVenue, venueIdByNormalisedName],
  );

  const dismissTonightOverlay = useCallback(() => {
    setTonightDismissed(true);
    setTonightOverlayVisible(false);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(TONIGHT_OVERLAY_DISMISSED_KEY, "1");
      } catch {
        // Best-effort; in-memory state still hides the chip for this session.
      }
    }
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

  // --- Search fly-to / fit (map search was a dead end) --------------------
  // Typing a pub name narrowed the pin set but never moved the camera, so at
  // city zoom the matches simply vanished. Now: a single match flies to and
  // opens that venue (reusing selectVenue → the canvas cinematic + venue
  // sheet); multiple matches re-frame the camera onto the matched set via a
  // token the canvas watches. The live venue set is read through a ref so
  // unrelated churn (drops/signals) never yanks the camera; only a query
  // change drives a move.
  const [searchFitToken, setSearchFitToken] = useState(0);
  const filteredVenuesRef = useRef(filteredVenues);
  useEffect(() => {
    filteredVenuesRef.current = filteredVenues;
  }, [filteredVenues]);
  const selectTopSearchMatch = useCallback(() => {
    const top = filteredVenuesRef.current[0];
    if (top) selectVenue(top.id);
  }, [selectVenue]);

  const trimmedMapQuery = filters.query.trim();
  const didMountSearchFlyRef = useRef(false);
  useEffect(() => {
    // Leave first paint to arrival framing; only react to user-driven typing.
    if (!didMountSearchFlyRef.current) {
      didMountSearchFlyRef.current = true;
      return;
    }
    // Too short to be a deliberate lookup; don't move the camera on a stray key.
    if (trimmedMapQuery.length < 2) return;
    const handle = window.setTimeout(() => {
      const matches = filteredVenuesRef.current;
      if (matches.length === 1) {
        // Exactly one match: fly to it and open its sheet (reuses the pin path).
        selectVenue(matches[0].id);
      } else if (matches.length > 1) {
        // A set of matches: frame them all so none stay hidden off-screen.
        setSearchFitToken((token) => token + 1);
      }
    }, 320);
    return () => window.clearTimeout(handle);
  }, [trimmedMapQuery, selectVenue]);

  // #397: a query restored from the URL (?q=) must fly to its matches exactly
  // like typed search does (#371). The typed-search effect above deliberately
  // skips first paint, and the arrival framing prop can miss the restore on the
  // slow two-stage venue load (mapReady fires before slim pins match) — leaving
  // the query in the field and a pin count on screen while the camera sits on
  // the default view with no match in sight. Drive the same select-one /
  // fit-many result here once the map is ready and the slim pins have matched.
  // A zero-result query never moves the camera and never claims pins.
  const didRestoreQueryFlyRef = useRef(false);
  useEffect(() => {
    if (didRestoreQueryFlyRef.current) return;
    if (!mapCanvasReady) return;
    if (!shouldFitQueryVenuesOnArrival(arrivalSearch)) return;
    // A restored selection (?sel=) owns the camera; don't fight its fly-to.
    if (seed.selectedVenueId) return;
    const matches = filteredVenues;
    const fit = resolveQueryRestoreFit(matches.length);
    // "none" means still loading (no match yet) or an honest zero-result query;
    // either way, leave the camera alone and don't latch the once-guard.
    if (fit === "none") return;
    const firstMatchId = matches[0]?.id;
    // Defer the state write out of the effect body (matches the typed-search
    // effect above) and latch on the actual fire, so re-renders while the pins
    // are still settling reschedule cleanly instead of losing the fly-to.
    const handle = window.setTimeout(() => {
      didRestoreQueryFlyRef.current = true;
      if (fit === "select-single" && firstMatchId) {
        selectVenue(firstMatchId);
      } else if (fit === "fit-many") {
        setSearchFitToken((token) => token + 1);
      }
    }, 0);
    return () => window.clearTimeout(handle);
  }, [mapCanvasReady, filteredVenues, arrivalSearch, seed.selectedVenueId, selectVenue]);

  const focusMapSearch = useCallback(() => {
    const search = (document.getElementById("mobileMapSearchInput") ?? document.getElementById("mapSearchInput")) as HTMLInputElement | null;
    if (search) search.focus();
  }, []);

  const resetLogIntentFilters = useCallback(() => {
    setSavedOnly(false);
    setSavedIds(readSavedVenueIds());
    setFilters(seedCrawlState("").filters);
    closePlanning();
    focusMapSearch();
  }, [closePlanning, focusMapSearch, setFilters]);

  // #395 R1: clear only the search query and unfilter the map. Used by the
  // mobile active-search chip so a restored (or typed) query is never an
  // invisible filter. Leaves every other filter and the camera untouched.
  const clearMapQuery = useCallback(() => {
    setFilters((current) => ({ ...current, query: "" }));
  }, [setFilters]);

  const openComposerForLog = useCallback(() => {
    closePlanning();
    setVenueInitialTab("pints");
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

  // Keyboard shortcuts: "/" focuses search, Esc clears selection / closes the
  // planner (see components/map/pubmap/useMapKeyboardShortcuts.ts).
  useMapKeyboardShortcuts({ planningOpen, closePlanning, closeComposer, setSelectedVenueId });

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
      // W1: a pin carrying a What's-On badge was tapped → badge_tap (the typed
      // rail's map-badge signal). Silent for pins without a tonight badge.
      if (whatsOnTonight.summary.has(id)) trackEvent("badge_tap");
      selectVenue(id);
    },
    [selectVenue, whatsOnTonight.summary],
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
  const requestVenueLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationRequestStatus("unavailable");
      return;
    }

    setLocationRequestStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setVenueJourneyLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationRequestStatus("idle");
      },
      () => {
        setLocationRequestStatus("unavailable");
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 },
    );
  }, []);

  const clearVenueLocation = useCallback(() => {
    setVenueJourneyLocation(null);
    setLocationRequestStatus("idle");
  }, []);

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
          setNearbyError("Nothing within reach matches those filters. Loosen one and the map fills back up.");
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
        setNearbyError("Location's off, so Near me can't reach you. The map still works, and every price on it stands.");
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

  const showNearbyMap = useCallback(() => {
    setNearbyError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNearbyError("Location isn't available in this browser.");
      return;
    }
    setNearbyLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        const nearby = nearbyVenuesForMap(location.lat, location.lng, filteredVenues, {
          radiusKm: 2.5,
          minCount: 20,
          maxCount: Math.max(20, filteredVenues.length),
        });
        const withinRadius = nearby.filter(
          (venue) => haversineKm([location.lng, location.lat], [venue.longitude, venue.latitude]) <= 2.5,
        );
        setUserLocation(location);
        setNearbyMapResult({
          location,
          venueIds: nearby.map((venue) => venue.id),
          radiusKm: 2.5,
          strategy: withinRadius.length >= 20 ? "within-radius" : "nearest-20",
        });
        setNearbyLoading(false);
        // Highlight nearby pins AND present the instant-answer cards (Lane 1):
        // the chip now yields an ANSWER, not just a recentre.
        setMapOverlay("near-me");
      },
      () => {
        setNearbyLoading(false);
        setNearbyError("Location's off, so Near me can't reach you. The map still works, and every price on it stands.");
      },
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 60_000 },
    );
  }, [filteredVenues]);

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
  const activeNightArea = useMemo(() => nightAreaForMapQuery(cityId, filters.query) ??
    (!filters.query.trim() && plannedNightArea ? getNightArea(plannedNightArea) : null),
  [cityId, filters.query, plannedNightArea]);
  const suggestedPlanArea = useMemo(
    () => activeNightArea ?? nearestNightAreaForViewport(cityId, mapViewport.center),
    [activeNightArea, cityId, mapViewport.center],
  );
  const venuesById = useMemo(
    () => new Map(filteredVenues.map((venue) => [venue.id, venue])),
    [filteredVenues],
  );
  const applyGeneratedMobilePlan = useCallback((generated: GeneratedMobilePlan) => {
    const ids = generated.stops.map((stop) => stop.venueId);
    activateGeneratedPlan(generated.context.nightArea, ids);
    markPalRouteActivation();
    setActiveCrawl(null);
    if (generated.context.nightArea) {
      trackEvent("night_description_submitted", {
        area: generated.context.nightArea,
        daypart: generated.context.daypart,
      });
    }
  }, [activateGeneratedPlan, setActiveCrawl]);
  const coordinatedMobileOverlay: MapOverlay = logIntentFallbackVisible
    ? "moment"
    : detailOpen
      ? "venue"
      : planningOpen
        ? "planner"
        : mapOverlay;
  const mobileShellState: MobileShellState = {
    overlay: coordinatedMobileOverlay,
    viewport: mapViewport,
    selectedVenueId: selectedVenueId || null,
    cityId,
    nightArea: activeNightArea?.slug ?? null,
  };

  const changeMapOverlay = useCallback((next: MapOverlay) => {
    if (next !== "moment") setLogIntentFallbackVisible(false);
    if (next !== "none" && isMobileViewport()) {
      setPlanningOpen(false);
      setSelectedVenueId("");
      closeComposer();
    }
    setMapOverlay(next);
  }, [closeComposer]);

  useEffect(() => {
    writeMobileMapSession({
      viewport: mapViewport,
      filters,
      cityId,
      nightArea: activeNightArea?.slug ?? null,
      selectedVenueId: selectedVenueId || null,
      openSheet: detailOpen
        ? "venue"
        : planningOpen
          ? "planner"
          : mapOverlay !== "none" && mapOverlay !== "search" && mapOverlay !== "moment"
            ? mapOverlay
            : null,
    });
  }, [activeNightArea?.slug, cityId, detailOpen, filters, mapOverlay, mapViewport, planningOpen, selectedVenueId]);

  // #215 a11y — the sheet's close button is the natural first stop for a
  // keyboard/AT user landing in a freshly-opened panel; on close (button,
  // Esc, or a fresh ?sel= navigating away) we hand focus back to whatever
  // triggered the open rather than dropping it to <body>.
  const drawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const preSheetFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (detailOpen) {
      preSheetFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      drawerCloseButtonRef.current?.focus();
    } else if (preSheetFocusRef.current) {
      // The trigger may have unmounted (e.g. a pin re-rendered away) — guard
      // with isConnected so we never call .focus() on a detached node.
      if (preSheetFocusRef.current.isConnected) preSheetFocusRef.current.focus();
      preSheetFocusRef.current = null;
    }
  }, [detailOpen]);

  // A11Y finding #2 — desktop venue drawer focus-trap parity. The desktop right
  // drawer already claims dialog/aria-modal at `full` and owns focus-in/restore
  // (above) + Esc (useMapKeyboardShortcuts); the missing piece was trapping Tab
  // and inert-ing the background. Reuse the SAME trap the mobile sheet uses.
  const detailDrawerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(!mobileViewport && detailOpen && sheetSnap === "full", detailDrawerRef);

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
  // paint — never while the band deep-link chip is showing (G3 priority), never
  // when this city has no curated crawls to offer, and never while the Tonight
  // lane (W1's PRIMARY what's-on spine) has live rows to show — the flagship
  // surface wins first paint over the story upsell so it's never occluded
  // (GateZ regression). Once the lane has no rows (quiet night / non-London),
  // onboarding is free to show as before.
  const tonightLaneHasRows =
    isLondon && whatsOnTonight.status === "ready" && whatsOnTonight.rows.length > 0;
  const tonightLanePending = isLondon && whatsOnTonight.status === "idle";
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
    tonightLaneHasRows,
    tonightLanePending,
  });
  // Show the first four curated crawls as the onboarding picks.
  const onboardingCrawls = cityCuratedCrawls.slice(0, 4);

  const plannerPanel = planningOpen ? (
    <>
      {mobileViewport && isLondon && suggestedPlanArea ? (
        <MobilePlanActivation
          cityId={cityId}
          initialNightArea={suggestedPlanArea.slug}
          venuesById={venuesById}
          onGenerated={applyGeneratedMobilePlan}
        />
      ) : null}
      {!mobileViewport ? <button type="button" className="plannerMapButton" onClick={closePlanning}>
        <MapPinned size={16} aria-hidden="true" />
        View {city.displayName} map
      </button> : null}
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
        journeyByToIndex={journeyByToIndex}
        journeyLoading={journeyLoading}
        journeyTotalMinutes={journeyTotalMinutes}
        cityDisplayName={city.displayName}
        cityId={cityId}
        poisPath={city.poisPath}
        onRoundStarted={setActiveRoundStartedCode}
      >
        {loaded && filteredVenues.length === 0 ? (
          savedOnly && savedIds.size === 0 ? (
            <section className="venueInspector" style={{ textAlign: "center" }}>
              <p className="description" style={{ marginTop: 0 }}>
                No saved pubs yet. Tap a pub and Save it, then flip &ldquo;Saved only&rdquo;
                back on to see just your list.
              </p>
              <button type="button" className="addStopBtn" onClick={() => changeSavedOnly(false)}>
                Show all pubs
              </button>
            </section>
          ) : (
            <section className="venueInspector" style={{ textAlign: "center" }}>
              <p className="description" style={{ marginTop: 0 }}>
                No pubs match these filters. Try widening your price or clearing your story filters.
              </p>
              <button type="button" className="addStopBtn" onClick={() => setFilters(seedCrawlState("").filters)}>
                Clear filters
              </button>
            </section>
          )
        ) : null}
      </RoutePanel>
    </>
  ) : null;

  const venuePanel = detailOpen && selectedVenue ? (
    <>
      <div className="mobileVenuePeekSummary" aria-label="Selected pub summary">
        {typeof selectedVenue.cheapestPrice === "number" ? (
          <span>
            <strong>{formatPrice(selectedVenue.cheapestPrice)}</strong>
            <small>current recorded price</small>
          </span>
        ) : (
          <button
            type="button"
            className="mobileVenuePeekDrop"
            onClick={openComposerForLog}
          >
            <strong>No price yet.</strong>
            <small>Be the first →</small>
          </button>
        )}
        <span>
          <strong>
            {userLocation
              ? `${Math.max(1, Math.ceil(haversineKm(
                  [userLocation.lng, userLocation.lat],
                  [selectedVenue.longitude, selectedVenue.latitude],
                ) * 12.5))} min`
              : "Near me"}
          </strong>
          <small>{userLocation ? "walk" : "for walk time"}</small>
        </span>
        <button
          type="button"
          aria-pressed={builtIds.includes(selectedVenue.id)}
          onClick={() => toggleBuiltStop(selectedVenue.id)}
        >
          {builtIds.includes(selectedVenue.id) ? "In plan" : "Plan stop"}
        </button>
      </div>
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
        onGrabDragStart={mobileViewport ? undefined : onSheetDragStart}
        onGrabDragMove={mobileViewport ? undefined : onSheetDragMove}
        onGrabDragEnd={mobileViewport ? undefined : onSheetDragEnd}
        onTabSelect={handleInspectorTabSelect}
        cityLandmarks={cityLandmarks}
        cityStoryBands={cityStoryBands}
        cityCuratedCrawls={cityCuratedCrawls}
        cityId={cityId}
        userLocation={venueJourneyLocation}
        locationRequestStatus={locationRequestStatus}
        onRequestLocation={requestVenueLocation}
        onClearLocation={clearVenueLocation}
      />
    </>
  ) : null;

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
      {!mobileViewport ? (
        <SiteNav
          active="map"
          mobileMapUtility={
            <MapPriceControl
              placement="header"
              filters={filters}
              onFiltersChange={setFilters}
            />
          }
        />
      ) : null}

      {/* Full-bleed map is the base layer; every panel slides in over it.
          Named region so AT users get a landmark for the map surface (the
          canvas pins are pointer-only; keyboard discovery is the tonight lane
          + search input inside this region). */}
      <section className="mapStage" aria-label={`Interactive pub map of ${city.displayName}`}>
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
            aria-label={`Loading the ${city.displayName} pub map. Finding the pubs. Fetching tonight's prices.`}
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
              <span>Finding the pubs. Fetching tonight&rsquo;s prices.</span>
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
          whatsOnByVenue={whatsOnTonight.summary}
          activeBandId={activeBandId}
          onBandChange={setActiveBandId}
          onStartCrawl={startCrawlFromPubs}
          onAskPubmaxxer={askPubmaxxerAtPub}
          initialLandmarkId={seed.landmarkId}
          onLandmarkSelect={(landmark) => setActiveLandmarkId(landmark?.id ?? "")}
          onMapReady={setMapCanvasReady}
          onMapErrored={setMapCanvasErrored}
          mapView={
            restoredMobileSession?.viewport
              ? withCityCameraAttitude(restoredMobileSession.viewport, city.mapView)
              : city.mapView
          }
          maxBounds={cityBounds}
          fitQueryOnArrival={shouldFitQueryVenuesOnArrival(arrivalSearch)}
          searchFitToken={searchFitToken}
          userLocation={userLocation}
          poisPath={city.poisPath}
          transitLinesPath={city.transitLinesPath}
          cityLandmarks={cityLandmarks}
          cityStoryBands={cityStoryBands}
          cityId={cityId}
          tonightOpportunities={tonightOpportunities}
          tonightOverlayVisible={isLondon && tonightOverlayVisible && !tonightDismissed}
          onTonightOpportunityClick={handleTonightOpportunityClick}
          poiHidden={poiHidden}
          onPoiHiddenChange={setPoiHidden}
          hideLayersControl={mobileViewport}
          onViewportChange={setMapViewport}
          onBoundsChange={handleMapBoundsChange}
        />
        {!mobileViewport ? <MapToolbar
          query={filters.query}
          onQueryChange={(query) => setFilters((current) => ({ ...current, query }))}
          onSubmitQuery={selectTopSearchMatch}
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
          personaId={personaLensId}
          onPersonaSelect={selectPersona}
          personaTonightCategory={personaTonightCategory}
          planningOpen={planningOpen}
          onTogglePlanning={togglePlanning}
          filters={filters}
          onFiltersChange={setFilters}
          searchSettled={loaded && loadedCityId === cityId}
          filteredVenueCount={filteredVenues.length}
          searchableVenueCount={venues.length}
          zoneIndex={zoneIndex}
          cityId={cityId}
        /> : null}
        {!mobileViewport ? <CitySuggestBanner cityId={cityId} onLocationFound={setUserLocation} /> : null}
        {!mobileViewport && isLondon ? <CityStatusBanner cityId={cityId} /> : null}
        {/* F3: concierge as map home — a first-class grounded ask affordance in
            the bottom map-home lane. Rendered before the Tonight lane so its
            sibling CSS lifts the lane above the collapsed pill (no collision). */}
        {!mobileViewport ? <MapConciergeAsk cityId={cityId} onSelectVenue={(id) => selectVenue(id)} /> : null}
        {!mobileViewport && isLondon ? (
          <TonightLane
            rows={whatsOnTonight.rows}
            asOf={whatsOnTonight.asOf}
            status={whatsOnTonight.status}
            open={tonightLaneOpen}
            onOpenChange={setTonightLaneOpen}
            onSelectVenue={(id) => selectVenue(id)}
            overlayCount={
              tonightStatus === "ready" && !tonightDismissed
                ? tonightOpportunities.length
                : 0
            }
            overlayActive={tonightOverlayVisible}
            onToggleOverlay={() =>
              setTonightOverlayVisible((visible) => !visible)
            }
            onDismissOverlay={dismissTonightOverlay}
          />
        ) : null}
        {!mobileViewport && logIntentFallbackVisible ? (
          <LogIntentFallback
            candidates={logNearbyCandidates}
            hasUserLocation={Boolean(userLocation)}
            filteredVenueCount={filteredVenueCount}
            onPickVenue={pickLogNearbyVenue}
            onPrefetchVenue={prefetchVenueDetail}
            onFocusSearch={focusMapSearch}
            onResetFilters={resetLogIntentFilters}
          />
        ) : null}
        {!mobileViewport ? <ActiveRoundChip refreshKey={activeRoundStartedCode} /> : null}
        {!mobileViewport && routeMappedActive ? (
          <MappedRouteChip
            stopCount={route.length}
            totalKm={routeForMapLegs.totalKm}
            totalMinutes={routeForMapLegs.totalMinutes}
            onEdit={openPlanning}
            onCheckLastTrain={checkLastTrainAtRouteEnd}
            onHide={hideMappedRoute}
          />
        ) : null}
        {/* G3: Place story deep-link chip — corridor title + one-line copy when
            `?band=` resolves. Distinct dismiss key from curated onboarding;
            suppresses that overlay while visible. */}
        {!mobileViewport && showBandChip && activeBand ? (
          <BandOnboardingChip
            title={activeBand.title}
            copy={activeBand.copy}
            onWalkStory={dismissBandChip}
            onDismiss={dismissBandChip}
          />
        ) : null}
        {/* Desktop retains the expanded price filter. On phones the compact key
            lives beside the PUBMAXXING wordmark so the bottom action lane can
            breathe above primary navigation. */}
        {!mobileViewport ? (
          <MapPriceControl
            placement="map"
            filters={filters}
            onFiltersChange={setFilters}
          />
        ) : null}

        {activePersona ? (
          <PersonaLensCard
            persona={activePersona}
            matchCount={
              personaHighlightsPubs(activePersona) ? filteredVenueCount : undefined
            }
            onClose={() => selectPersona(null)}
          />
        ) : null}

        {/* A11Y #1 — keyboard/SR "List view": the DOM parallel to the canvas
            pins. Present on both viewports; selection drives the same
            selectVenue the pin tap does. Hidden by CSS while a sheet owns the
            map. */}
        <MapVenueList
          model={mapVenueListModel}
          cityName={city.displayName}
          open={mapListOpen}
          onOpenChange={setMapListOpen}
          loaded={loaded && loadedCityId === cityId}
          onSelectVenue={selectVenue}
          onPrefetchVenue={prefetchVenueDetail}
        />

        <MobileMapShell
          cityLabel={activeNightArea?.name ?? city.displayName}
          overlay={mobileShellState.overlay}
          onOverlayChange={changeMapOverlay}
          activeQuery={trimmedMapQuery}
          onClearQuery={clearMapQuery}
          onNearMe={showNearbyMap}
          nearMeStatus={nearbyLoading ? "requesting" : nearbyMapResult ? "ready" : nearbyError ? "error" : "idle"}
          nearbyCount={nearbyMapResult?.venueIds.length ?? 0}
          tonightCount={whatsOnTonight.rows.length}
          tflCount={tflStatus.issueCount}
          tflStatus={tflStatus.failed ? "unavailable" : !tflStatus.payload ? "checking" : tflStatus.issueCount ? "issues" : "clear"}
          priceLabel={filters.maxPrice < 10 ? `≤£${filters.maxPrice.toFixed(2)}` : "Price"}
          drinkFiltersActive={Boolean(filters.drinkCategory || filters.drinkBrand || filters.requireCocktails)}
          zoneActive={filters.zone !== "" && filters.zone !== "all"}
          listOpen={mapListOpen}
          onListToggle={() => setMapListOpen((open) => !open)}
          priceCapActive={filters.maxPrice < 10}
          planOpen={planningOpen}
          planActive={routeMappedActive || activePlanRoute.length >= 2}
          planStopCount={routeMappedActive ? route.length : activePlanRoute.length}
          planInteractive={mobileViewport}
          onPlan={openPlanning}
          searchContent={
            <SearchField
              id="mobileMapSearchInput"
              value={filters.query}
              onChange={(query) => setFilters((current) => ({ ...current, query }))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  selectTopSearchMatch();
                }
              }}
              placeholder={`Search ${city.displayName} pubs or areas`}
              autoFocus
            />
          }
          filtersContent={
            <div className="mobileMapFilters">
              <DrinkShapeChips filters={filters} onFiltersChange={setFilters} />
              {isLondon ? (
                <ZonePicker
                  variant="inline"
                  zone={filters.zone}
                  onZoneChange={(zone) => setFilters((current) => ({ ...current, zone }))}
                  index={zoneIndex}
                />
              ) : null}
              <FavoritePintPicker
                value={favoritePint}
                onChange={changeFavoritePint}
                drinkCategory={filters.drinkCategory}
                drinkBrand={filters.drinkBrand}
                onDrinkLensChange={({ drinkCategory, drinkBrand }) =>
                  setFilters((current) => ({
                    ...current,
                    drinkCategory,
                    drinkBrand,
                    requireCocktails: drinkCategory === "cocktail",
                  }))
                }
              />
              <PersonaLensPicker
                personaId={personaLensId}
                onSelect={selectPersona}
                tonightCategory={personaTonightCategory}
              />
              <fieldset className="mobilePriceChoices">
                <legend>Maximum pint price</legend>
                {[10, 7, 6, 5.5].map((price) => (
                  <button
                    type="button"
                    key={price}
                    className={filters.maxPrice === price ? "isActive" : ""}
                    aria-pressed={filters.maxPrice === price}
                    onClick={() => setFilters((current) => ({ ...current, maxPrice: price }))}
                  >
                    {price === 10 ? "Any" : `£${price.toFixed(2)}`}
                  </button>
                ))}
              </fieldset>
            </div>
          }
          tflContent={<MobileTflPanel status={tflStatus} />}
          tonightContent={
            <TonightLane
              rows={whatsOnTonight.rows}
              asOf={whatsOnTonight.asOf}
              status={whatsOnTonight.status}
              open
              variant="sheet"
              onOpenChange={() => undefined}
              onSelectVenue={selectVenue}
              overlayCount={tonightStatus === "ready" && !tonightDismissed ? tonightOpportunities.length : 0}
              overlayActive={tonightOverlayVisible}
              onToggleOverlay={() => setTonightOverlayVisible((visible) => !visible)}
              onDismissOverlay={dismissTonightOverlay}
            />
          }
          layersContent={
            <Tabs className="mobileLayersPanel" value={mobileLayersTab} onValueChange={(value) => setMobileLayersTab(value as typeof mobileLayersTab)}>
              <TabsList aria-label="Layer settings sections">
                <TabsTrigger value="layers">Layers</TabsTrigger>
                <TabsTrigger value="prices">Prices</TabsTrigger>
                <TabsTrigger value="events">Events</TabsTrigger>
                <TabsTrigger value="transit">Transit</TabsTrigger>
              </TabsList>
              <TabsContent value="layers" className="mobileLayersPanel">
                <Button className="mobilePlannerLaunch w-full justify-start" onClick={openPlanning}>
                  <MapPinned size={18} aria-hidden="true" />
                  Plan tonight
                </Button>
                {routeMappedActive ? <Button variant="secondary" onClick={hideMappedRoute}>Hide active route</Button> : null}
                <div className="mobileLayersTheme">
                  <div><strong>Map appearance</strong><small>Theme changes preserve this view and its active sheet.</small></div>
                  <ThemeToggle />
                </div>
                <MapLayersControl embedded poiHidden={poiHidden} onPoiHiddenChange={setPoiHidden} activeBandId={activeBandId} onBandChange={setActiveBandId} storyBands={cityStoryBands} cityId={cityId} />
              </TabsContent>
              <TabsContent value="prices" className="mobileMapFilters">
                <DrinkShapeChips filters={filters} onFiltersChange={setFilters} />
                <FavoritePintPicker value={favoritePint} onChange={changeFavoritePint} drinkCategory={filters.drinkCategory} drinkBrand={filters.drinkBrand} onDrinkLensChange={({ drinkCategory, drinkBrand }) => setFilters((current) => ({ ...current, drinkCategory, drinkBrand, requireCocktails: drinkCategory === "cocktail" }))} />
                <fieldset className="mobilePriceChoices"><legend>Maximum pint price</legend>{[10, 7, 6, 5.5].map((price) => <button type="button" key={price} className={filters.maxPrice === price ? "isActive" : ""} aria-pressed={filters.maxPrice === price} onClick={() => setFilters((current) => ({ ...current, maxPrice: price }))}>{price === 10 ? "Any" : `£${price.toFixed(2)}`}</button>)}</fieldset>
              </TabsContent>
              <TabsContent value="events">
                <TonightLane rows={whatsOnTonight.rows} asOf={whatsOnTonight.asOf} status={whatsOnTonight.status} open variant="sheet" onOpenChange={() => undefined} onSelectVenue={selectVenue} overlayCount={tonightStatus === "ready" && !tonightDismissed ? tonightOpportunities.length : 0} overlayActive={tonightOverlayVisible} onToggleOverlay={() => setTonightOverlayVisible((visible) => !visible)} onDismissOverlay={dismissTonightOverlay} />
              </TabsContent>
              <TabsContent value="transit"><MobileTflPanel status={tflStatus} /></TabsContent>
            </Tabs>
          }
          palContent={
            <div className="mobilePalSummon">
              <Sparkles size={28} aria-hidden="true" />
              <h3>Your Pub Pal is ready</h3>
              <p>Ask for a grounded pub pick, a bit of lore, or help shaping tonight.</p>
              <Link href="/pal">Open Pub Pal</Link>
              <small><ShieldCheck size={14} aria-hidden="true" /> It never changes a plan or posts a memory without confirmation.</small>
            </div>
          }
          momentContent={
            <LogIntentFallback
              candidates={logNearbyCandidates}
              hasUserLocation={Boolean(userLocation)}
              filteredVenueCount={filteredVenueCount}
              onPickVenue={pickLogNearbyVenue}
              onPrefetchVenue={prefetchVenueDetail}
              onFocusSearch={() => {
                changeMapOverlay("search");
                requestAnimationFrame(focusMapSearch);
              }}
              onResetFilters={resetLogIntentFilters}
            />
          }
          nearMeContent={
            mapOverlay === "near-me" ? (
              <NearMeNow
                cityId={cityId}
                onSelectVenue={selectVenue}
                initialLocation={userLocation}
                venues={filteredVenues.map((venue) => ({
                  id: venue.id,
                  name: venue.name,
                  lat: venue.latitude,
                  lng: venue.longitude,
                  cheapestPrice: venue.cheapestPrice,
                  borough: venue.primaryBorough,
                }))}
              />
            ) : null
          }
        />

        {/* §4.5 onboarding overlay: a dismissible "Start with a story" card that
            offers curated crawls on a clean first paint. It's the mobile
            onboarding (control rail is hidden on small screens) and never blocks
            the map — the backdrop and the link both close it. */}
        {!mobileViewport && showOnboarding ? (
          <MapOnboardingOverlay
            crawls={onboardingCrawls}
            onLoadCrawl={loadCuratedCrawl}
            onDismiss={dismissOnboarding}
          />
        ) : null}
      </section>

      {mobileViewport ? (
        <Sheet
          kind={detailOpen ? "venue" : planningOpen ? "planner" : null}
          title={detailOpen ? selectedVenue?.name ?? "Pub detail" : "Plan tonight"}
          initialSnap="half"
          requestedSnap={detailOpen ? sheetSnap : plannerSheetSnap}
          onClose={detailOpen ? dismissSheet : closePlanning}
        >
          {detailOpen ? venuePanel : plannerPanel}
        </Sheet>
      ) : null}

      {/* Left drawer: the whole crawl planner, on demand.
          On mobile (≤640px) this is a drag bottom-sheet with the same snap
          points as the venue sheet (peek/half/full — lib/sheetSnap.ts). Opens
          at half so the map stays partially visible. Desktop is unchanged —
          side drawer, no gesture. */}
      {!mobileViewport ? <div
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
        {plannerPanel}
      </div> : null}

      {/* Right drawer: the selected pub's detail — opens only on an explicit pick.
          On mobile (≤640px) this is a true drag bottom-sheet with snap points
          (peek/half/full — lib/sheetSnap.ts). The snap class drives the resting
          transform in CSS; sheetDragY (a live px offset) only exists mid-drag, so
          a release always lands back on a snap-driven CSS transition, never a
          hand-picked pixel position. Desktop ignores both — no drag handlers
          fire above the gesture breakpoint, and the extra classes/attrs are
          no-ops there (see venueSheet.css / globals.css .mapDrawer rules). */}
      {!mobileViewport ? <div
        ref={detailDrawerRef}
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
            ref={drawerCloseButtonRef}
            type="button"
            className="drawerClose"
            onClick={dismissSheet}
            aria-label="Close pub detail"
          >
            <X size={16} />
          </button>
        </div>
        {venuePanel}
      </div> : null}
    </main>
  );
}
