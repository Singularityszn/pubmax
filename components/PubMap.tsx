"use client";

import { MapPinned, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import SiteNav from "@/components/nav/SiteNav";
import "@/components/map/venueSheet.css";
import "@/components/map/spillComposer.css";
import "@/components/map/logIntentFallback.css";

import {
  buildCrawlRoute,
  mergeVenueDrops,
  type Filters,
  type Venue,
} from "@/lib/venues";
import { filterMapVenues, withForcedVenue } from "@/lib/filterMapVenues";
import { mergePriceUpdates, parsePriceUpdates, type PriceUpdate } from "@/lib/priceUpdates";
import { nearestVenueIds } from "@/lib/nearby";
import PubMapCanvas from "@/components/PubMapCanvas";
import ControlRail, { type CrawlMode } from "@/components/map/ControlRail";
import { type CuratedCrawl } from "@/lib/curatedCrawls";
import { curatedCrawlsForCity } from "@/lib/cityCuratedCrawls";
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
import TonightOverlayChip from "@/components/map/TonightOverlayChip";
import { useCrawlJourneys } from "@/components/map/useCrawlJourneys";
import { useTonightOpportunities } from "@/components/map/useTonightOpportunities";
import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import TonightLane from "@/components/map/TonightLane";
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
import { LogIntentFallback } from "@/components/map/pubmap/LogIntentFallback";
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
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { slimVenuesToPins } from "@/lib/slimPins";
import { buildRouteLegs } from "@/lib/routeLegs";
import { haversineKm } from "@/lib/haversine";
import { mergeLazyDetailPins } from "@/lib/lazyVenueDetail";
import {
  buildLogNearbyCandidates,
  hasMapLogIntent,
} from "@/lib/mapLogIntent";
import prefetchVenue from "@/lib/prefetchVenue";
import { warmVenueDetail } from "@/lib/warmVenueDetail";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import {
  bandChipDismissedKey,
  shouldShowBandOnboardingChip,
  shouldShowCuratedOnboarding,
} from "@/lib/bandOnboardingChip";
import { shouldFitCityBoundsOnArrival, shouldOpenPlanningInitially, shouldFitQueryVenuesOnArrival } from "@/lib/mapArrival";
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
  return typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
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
  const [tonightOverlayVisible, setTonightOverlayVisible] = useState(false);
  const [tonightDismissed, setTonightDismissed] = useState<boolean>(
    readTonightOverlayDismissed,
  );

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
  const {
    byToIndex: journeyByToIndex,
    loading: journeyLoading,
    totalMinutes: journeyTotalMinutes,
  } = useCrawlJourneys(route, isLondon);
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
          mapView={city.mapView}
          maxBounds={cityBounds}
          fitCityOnArrival={shouldFitCityBoundsOnArrival(
            arrivalSearch,
            seed.routeMapped,
          )}
          fitQueryOnArrival={shouldFitQueryVenuesOnArrival(arrivalSearch)}
          poisPath={city.poisPath}
          transitLinesPath={city.transitLinesPath}
          cityLandmarks={cityLandmarks}
          cityStoryBands={cityStoryBands}
          cityId={cityId}
          tonightOpportunities={tonightOpportunities}
          tonightOverlayVisible={isLondon && tonightOverlayVisible && !tonightDismissed}
          onTonightOpportunityClick={handleTonightOpportunityClick}
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
        {isLondon ? <CityStatusBanner cityId={cityId} /> : null}
        {isLondon && tonightStatus === "ready" && !tonightDismissed ? (
          <TonightOverlayChip
            count={tonightOpportunities.length}
            active={tonightOverlayVisible}
            onToggle={() => setTonightOverlayVisible((visible) => !visible)}
            onDismiss={dismissTonightOverlay}
          />
        ) : null}
        {isLondon ? (
          <TonightLane
            rows={whatsOnTonight.rows}
            asOf={whatsOnTonight.asOf}
            status={whatsOnTonight.status}
            onSelectVenue={(id) => selectVenue(id)}
          />
        ) : null}
        {logIntentFallbackVisible ? (
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
        <ActiveRoundChip refreshKey={activeRoundStartedCode} />
        {routeMappedActive ? (
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
        {showBandChip && activeBand ? (
          <BandOnboardingChip
            title={activeBand.title}
            copy={activeBand.copy}
            onWalkStory={dismissBandChip}
            onDismiss={dismissBandChip}
          />
        ) : null}
        {/* Wave J declutter: Prices control owns the key on all viewports
            (pin colours + popover). Static mid-map legend removed. */}
        <MapPriceControl filters={filters} onFiltersChange={setFilters} />

        {/* §4.5 onboarding overlay: a dismissible "Start with a story" card that
            offers curated crawls on a clean first paint. It's the mobile
            onboarding (control rail is hidden on small screens) and never blocks
            the map — the backdrop and the link both close it. */}
        {showOnboarding ? (
          <MapOnboardingOverlay
            crawls={onboardingCrawls}
            onLoadCrawl={loadCuratedCrawl}
            onDismiss={dismissOnboarding}
          />
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
