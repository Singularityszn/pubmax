"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import SiteNav from "@/components/nav/SiteNav";

import {
  buildCrawlRoute,
  filterVenues,
  groupVenuePrices,
  mergeVenueDrops,
  type Filters,
  type Venue,
  type VenuePrice,
} from "@/lib/venues";
import { nearestVenueIds } from "@/lib/nearby";
import PubMapCanvas from "@/components/PubMapCanvas";
import ControlRail, { type CrawlMode } from "@/components/map/ControlRail";
import { curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import RoutePanel from "@/components/map/RoutePanel";
import VenueInspector from "@/components/map/VenueInspector";
import MapToolbar from "@/components/map/MapToolbar";
import { usePintDrops } from "@/components/map/usePintDrops";
import { seedCrawlState, useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import {
  clearFavoritePint,
  getFavoritePint,
  setFavoritePint as persistFavoritePint,
} from "@/lib/favoritePint";
import { getSaved } from "@/lib/savedPubs";

// The set of venue ids this device has saved (any list). Read from the client
// saved-pub store; SSR-safe (getSaved returns [] on the server). Used only to
// narrow the map/list when the viewer flips "Saved only" on.
function readSavedVenueIds(): Set<string> {
  return new Set(getSaved().map((entry) => entry.venueId));
}

// mergeVenueDrops (lib/venues.ts) folds drops into DERIVED SUMMARY SIGNALS only:
// a bare price is never a story, and demo seeds never move prices or hasStory.

// localStorage is a refresh-safety net for hand-built routes; the URL stays the
// canonical share format. Only the built-mode stop ids are stored.
const BUILT_STORAGE_KEY = "pubmax_built_ids";

function readStoredBuiltIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BUILT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

// §4.5 curated-crawl onboarding: dismissal is per-session so a reload during the
// same visit doesn't re-nag, but a fresh session gets the offer again. sessionStorage
// (not localStorage) keeps it a gentle, per-visit prompt.
const ONBOARDING_DISMISSED_KEY = "pubmax_onboarding_dismissed";

function readOnboardingDismissed(): boolean {
  if (typeof window === "undefined") return true; // SSR: never render the overlay server-side
  try {
    return window.sessionStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function PubMap() {
  // Seed the crawl from the shareable URL (falls back to defaults / honors
  // ?style=heritage from the landing page). Lazy init keeps this off effects.
  // If the URL carries no hand-built crawl but localStorage does, seed from it —
  // a refresh-safety net that never fights the URL (URL wins when present).
  const seed = useMemo(() => {
    const search = typeof window === "undefined" ? "" : window.location.search;
    const seeded = seedCrawlState(search);
    if (seeded.builtIds.length === 0) {
      const stored = readStoredBuiltIds();
      if (stored.length) return { ...seeded, mode: "build" as const, builtIds: stored };
    }
    return seeded;
  }, []);
  // §4.5: did the page arrive with any crawl-shaping URL param (a shared/deep
  // link)? Captured ONCE at mount — useCrawlUrlSync starts writing mode/style back
  // to the URL after ~300ms, so re-reading location.search later would be wrong.
  // If any of these are present, the arrival is intentional and we never onboard.
  const arrivedWithCrawlParams = useMemo(() => {
    if (typeof window === "undefined") return false;
    return /[?&](pubs|sel|style|mode|q)=/.test(window.location.search);
  }, []);
  const [rows, setRows] = useState<VenuePrice[]>([]);
  // `loaded` flips true only when the fetch resolves — lets the UI tell a
  // still-loading empty from a genuine zero-result. Set in the fetch handler
  // below (never in a bare effect: react-hooks/set-state-in-effect is an error).
  const [loaded, setLoaded] = useState(false);
  const [selectedVenueId, setSelectedVenueId] = useState<string>(seed.selectedVenueId);
  const [filters, setFilters] = useState<Filters>(seed.filters);
  const [mode, setMode] = useState<CrawlMode>(seed.mode);
  const [builtIds, setBuiltIds] = useState<string[]>(seed.builtIds);
  // Map-first layout: the planner (left drawer) is hidden until the user asks
  // for it — but a shared/restored crawl link opens straight into planning so
  // the route isn't invisible on arrival.
  const [planningOpen, setPlanningOpen] = useState<boolean>(
    () =>
      seed.builtIds.length > 0 ||
      seed.mode === "build" ||
      (typeof window !== "undefined" && /[?&](style|sel|mode|q)=/.test(window.location.search)),
  );
  // Favorite pint: re-prices the map to one beer. Persisted per-device; the
  // guard mirrors readStoredBuiltIds so SSR and hydration read the same source.
  const [favoritePint, setFavoritePintState] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getFavoritePint(),
  );
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
  // The curated crawl whose blurb is shown under the route title. Cleared the
  // moment the user manually mutates the stops (add/remove/reverse/clear).
  const [activeCrawl, setActiveCrawl] = useState<CuratedCrawl | null>(null);
  // §4.5 onboarding: has the viewer dismissed (or acted on) the "Start with a
  // story" overlay this session? Lazy init reads sessionStorage once, SSR-safe.
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(readOnboardingDismissed);

  // Community Pint Drops: fetch/submit/report state lives in the hook.
  const pintDrops = usePintDrops();
  const { dropsByVenueId, venueSignals, refreshVenueDrops, closeComposer } = pintDrops;

  useEffect(() => {
    // Reliability: abort a hung fetch after a timeout and guard the response so a
    // slow/failed CDN degrades to the friendly empty state instead of freezing on
    // the skeleton forever. `loaded` still flips on every settled path.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    fetch("/data/pint_prices_app_dataset.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: VenuePrice[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => {
        // Network / timeout / parse error — leave rows empty; the empty state
        // (not a permanent skeleton) renders once `loaded` flips below.
      })
      .finally(() => {
        clearTimeout(timeout);
        setLoaded(true);
      });
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const baseVenues = useMemo(() => groupVenuePrices(rows), [rows]);
  const venues = useMemo(
    () => mergeVenueDrops(baseVenues, dropsByVenueId),
    [baseVenues, dropsByVenueId],
  );
  const venueById = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);
  // Base narrowing: the existing filter pipeline (story filters, price, query,
  // pint-drops). Favorite-pint re-prices inside PubMapCanvas and never changes
  // membership, so it isn't part of this set.
  const pipelineVenues = useMemo(
    () => filterVenues(venues, filters, (id) => Boolean(venueSignals.get(id)?.hasPintDrops)),
    [venues, filters, venueSignals],
  );
  // "Saved only" composes ON TOP of the pipeline: when on, keep only venues in
  // the saved set. When off it's a no-op, so all existing behavior is preserved.
  const filteredVenues = useMemo(
    () => (savedOnly ? pipelineVenues.filter((v) => savedIds.has(v.id)) : pipelineVenues),
    [pipelineVenues, savedOnly, savedIds],
  );

  const suggestedRoute = useMemo(
    () => buildCrawlRoute(filteredVenues, filters),
    [filteredVenues, filters],
  );
  const builtRoute = useMemo(
    () => builtIds.map((id) => venueById.get(id)).filter((v): v is Venue => Boolean(v)),
    [builtIds, venueById],
  );
  const route = mode === "suggest" ? suggestedRoute : builtRoute;

  const selectedVenue = useMemo(
    () => venueById.get(selectedVenueId) ?? route[0],
    [route, selectedVenueId, venueById],
  );

  // Keep the URL in sync so "Copy link" shares the current crawl.
  useCrawlUrlSync(
    useMemo(
      () => ({ mode, filters, builtIds, selectedVenueId }),
      [mode, filters, builtIds, selectedVenueId],
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
    (id: string) => {
      setSelectedVenueId(id);
      closeComposer();
    },
    [closeComposer],
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
        // Close the venue detail first; a second Escape closes the planner.
        setSelectedVenueId((current) => {
          if (current) {
            closeComposer();
            return "";
          }
          setPlanningOpen(false);
          return current;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeComposer]);

  const toggleBuiltStop = useCallback((id: string) => {
    setBuiltIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
    setActiveCrawl(null); // a manual stop change is no longer "the curated crawl"
  }, []);

  // Reverse the hand-built route: start from the opposite end. Event handler, so
  // setState is fine; URL-sync picks up the new builtIds order automatically.
  const reverseRoute = useCallback(() => {
    setBuiltIds((current) => [...current].reverse());
    setActiveCrawl(null);
  }, []);

  const clearBuilt = useCallback(() => {
    setBuiltIds([]);
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
      setFilters((current) => ({ ...current, crawlStyle: crawl.crawlStyle }));
      setActiveCrawl(crawl); // its blurb shows under the route title until mutated
      setPlanningOpen(true); // a loaded crawl needs the planner visible
      selectVenue(crawl.venueIds[0] ?? "");
      dismissOnboarding(); // picking a crawl from the overlay closes + remembers it
    },
    [selectVenue, dismissOnboarding],
  );

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
        setActiveCrawl(null); // a near-me crawl isn't a curated one
        setPlanningOpen(true);
        selectVenue(ids[0]);
      },
      () => {
        setNearbyLoading(false);
        setNearbyError("Couldn't get your location. Grant access and try again.");
      },
    );
  }, [filteredVenues, filters.stopCount, selectVenue]);

  const detailOpen = Boolean(selectedVenueId) && loaded;

  // §4.5: show the "Start with a story" onboarding overlay only on a clean first
  // paint — data loaded, nothing selected, suggest mode, no hand-built stops, no
  // active curated crawl, the page didn't arrive via a shared crawl link, and the
  // viewer hasn't already dismissed it this session. Never blocks the map: it's a
  // dismissible overlay, and it's the primary onboarding on mobile (rail hidden).
  const showOnboarding =
    loaded &&
    !onboardingDismissed &&
    !arrivedWithCrawlParams &&
    mode === "suggest" &&
    builtIds.length === 0 &&
    !activeCrawl &&
    !selectedVenueId;
  // Show the first four curated crawls as the onboarding picks.
  const onboardingCrawls = curatedCrawls.slice(0, 4);

  return (
    <main className="appShell dark">
      <SiteNav active="map" />

      {/* Full-bleed map is the base layer; every panel slides in over it. */}
      <section className="mapStage">
        {!loaded ? (
          <div className="mapLoading" aria-live="polite">
            <span aria-hidden="true" className="mapLoadingDot" />
            Loading London&rsquo;s pubs…
          </div>
        ) : null}
        <PubMapCanvas
          venues={filteredVenues}
          // The crawl only draws on the map while the planner is open — the
          // clean first view is pubs + POIs, never a route the user didn't ask for.
          route={planningOpen ? route : []}
          selectedVenueId={selectedVenueId}
          onVenueClick={handleVenueClick}
          onRouteStopClick={selectVenue}
          venueSignals={venueSignals}
          favoritePint={favoritePint}
        />
        <MapToolbar
          query={filters.query}
          onQueryChange={(query) => setFilters((current) => ({ ...current, query }))}
          favoritePint={favoritePint}
          onFavoritePintChange={changeFavoritePint}
          planningOpen={planningOpen}
          onTogglePlanning={() => setPlanningOpen((open) => !open)}
        />
        <div className="mapLegend">
          <span>
            <i className="green" /> ≤ £5.50
          </span>
          <span>
            <i className="amber" /> £5.50-£7
          </span>
          <span>
            <i className="red" /> £7+
          </span>
          <span>
            <i className="brassRing" /> heritage
          </span>
          <span>
            <i className="gold" /> writer
          </span>
        </div>

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

      {/* Left drawer: the whole crawl planner, on demand. */}
      <div
        className={planningOpen ? "mapDrawer left open" : "mapDrawer left"}
        aria-hidden={!planningOpen}
      >
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
        />
        <RoutePanel
          mode={mode}
          crawlStyle={filters.crawlStyle}
          route={route}
          filteredVenues={filteredVenues}
          builtIds={builtIds}
          activeVenueId={selectedVenue?.id}
          venueSignals={venueSignals}
          crawlBlurb={activeCrawl?.blurb}
          crawlName={activeCrawl?.name}
          onSelectVenue={selectVenue}
          onToggleStop={toggleBuiltStop}
          onReverseRoute={reverseRoute}
        >
          {loaded && filteredVenues.length === 0 ? (
            savedOnly && savedIds.size === 0 ? (
              <section className="venueInspector" style={{ textAlign: "center" }}>
                <p className="description" style={{ marginTop: 0 }}>
                  No saved pubs yet — tap a pub and Save it, then flip &ldquo;Saved only&rdquo; back
                  on to see just your list.
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
      </div>

      {/* Right drawer: the selected pub's detail — opens only on an explicit pick. */}
      <div
        className={detailOpen ? "mapDrawer right open" : "mapDrawer right"}
        aria-hidden={!detailOpen}
      >
        <div className="mapDrawerHead">
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
          <VenueInspector
            venue={selectedVenue}
            mode={mode}
            inCrawl={builtIds.includes(selectedVenue.id)}
            latestContributorPrice={venueSignals.get(selectedVenue.id)?.latestContributorPrice}
            onToggleStop={toggleBuiltStop}
            pintDrops={pintDrops}
          />
        ) : null}
      </div>
    </main>
  );
}
