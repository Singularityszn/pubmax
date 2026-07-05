"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import RoutePanel from "@/components/map/RoutePanel";
import VenueInspector from "@/components/map/VenueInspector";
import { usePintDrops } from "@/components/map/usePintDrops";
import { seedCrawlState, useCrawlUrlSync } from "@/components/map/useCrawlUrl";

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
  const [rows, setRows] = useState<VenuePrice[]>([]);
  // `loaded` flips true only when the fetch resolves — lets the UI tell a
  // still-loading empty from a genuine zero-result. Set in the fetch handler
  // below (never in a bare effect: react-hooks/set-state-in-effect is an error).
  const [loaded, setLoaded] = useState(false);
  const [selectedVenueId, setSelectedVenueId] = useState<string>(seed.selectedVenueId);
  const [filters, setFilters] = useState<Filters>(seed.filters);
  const [mode, setMode] = useState<CrawlMode>(seed.mode);
  const [builtIds, setBuiltIds] = useState<string[]>(seed.builtIds);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  // The curated crawl whose blurb is shown under the route title. Cleared the
  // moment the user manually mutates the stops (add/remove/reverse/clear).
  const [activeCrawl, setActiveCrawl] = useState<CuratedCrawl | null>(null);

  // Community Pint Drops: fetch/submit/report state lives in the hook.
  const pintDrops = usePintDrops();
  const { dropsByVenueId, venueSignals, refreshVenueDrops, closeComposer } = pintDrops;

  useEffect(() => {
    fetch("/data/pint_prices_app_dataset.json")
      .then((response) => response.json())
      .then((data: VenuePrice[]) => setRows(data))
      // Flip `loaded` in the fetch handler (settled path), not a bare effect,
      // so an empty result reads as "no matches" and never a permanent skeleton.
      .finally(() => setLoaded(true));
  }, []);

  const baseVenues = useMemo(() => groupVenuePrices(rows), [rows]);
  const venues = useMemo(
    () => mergeVenueDrops(baseVenues, dropsByVenueId),
    [baseVenues, dropsByVenueId],
  );
  const venueById = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);
  const filteredVenues = useMemo(
    () => filterVenues(venues, filters, (id) => Boolean(venueSignals.get(id)?.hasPintDrops)),
    [venues, filters, venueSignals],
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
        setSelectedVenueId("");
        closeComposer();
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

  const handleVenueClick = useCallback(
    (id: string) => {
      selectVenue(id);
      if (mode === "build") toggleBuiltStop(id);
    },
    [mode, selectVenue, toggleBuiltStop],
  );

  // Load a named curated crawl into Build mode. URL-sync makes it shareable.
  const loadCuratedCrawl = useCallback(
    (crawl: CuratedCrawl) => {
      setMode("build");
      setBuiltIds(crawl.venueIds);
      setFilters((current) => ({ ...current, crawlStyle: crawl.crawlStyle }));
      setActiveCrawl(crawl); // its blurb shows under the route title until mutated
      selectVenue(crawl.venueIds[0] ?? "");
    },
    [selectVenue],
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
        selectVenue(ids[0]);
      },
      () => {
        setNearbyLoading(false);
        setNearbyError("Couldn't get your location. Grant access and try again.");
      },
    );
  }, [filteredVenues, filters.stopCount, selectVenue]);

  return (
    <main className="appShell dark">
      <nav className="siteNav appNav" aria-label="Site navigation">
        <Link href="/">Home</Link>
        <Link href="/map" aria-current="page">
          Map
        </Link>
        <Link href="/admin">Admin</Link>
      </nav>

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
      />

      <section className="mapStage">
        {!loaded ? (
          <div
            aria-live="polite"
            style={{
              position: "absolute",
              top: "18px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 5,
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 16px",
              borderRadius: "999px",
              background: "var(--panel-raised)",
              border: "1px solid var(--line)",
              color: "var(--ink-soft)",
              fontSize: "13px",
              boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "9px",
                height: "9px",
                borderRadius: "50%",
                background: "var(--brass)",
                animation: "pulse 1.4s ease-in-out infinite",
              }}
            />
            Loading London&rsquo;s pubs…
          </div>
        ) : null}
        <PubMapCanvas
          venues={filteredVenues}
          route={route}
          selectedVenueId={selectedVenueId}
          onVenueClick={handleVenueClick}
          onRouteStopClick={selectVenue}
          venueSignals={venueSignals}
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
      </section>

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
        {!loaded ? (
          <section className="venueInspector" aria-live="polite" aria-busy="true">
            <p className="description muted" style={{ marginTop: 0 }}>
              Loading London&rsquo;s pubs…
            </p>
            <div style={{ display: "grid", gap: "10px", marginTop: "6px" }}>
              {[0.85, 0.6, 0.75, 0.5].map((w, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  style={{
                    display: "block",
                    height: "12px",
                    width: `${w * 100}%`,
                    borderRadius: "6px",
                    background: "var(--line)",
                    opacity: 0.6,
                    animation: "pulse 1.4s ease-in-out infinite",
                    animationDelay: `${i * 0.12}s`,
                  }}
                />
              ))}
            </div>
          </section>
        ) : filteredVenues.length === 0 ? (
          <section className="venueInspector" style={{ textAlign: "center" }}>
            <p className="description" style={{ marginTop: 0 }}>
              No pubs match these filters — try widening your price or clearing your story filters.
            </p>
            <button
              type="button"
              className="addStopBtn"
              onClick={() => setFilters(seedCrawlState("").filters)}
            >
              Clear filters
            </button>
          </section>
        ) : selectedVenue ? (
          <VenueInspector
            venue={selectedVenue}
            mode={mode}
            inCrawl={builtIds.includes(selectedVenue.id)}
            latestContributorPrice={venueSignals.get(selectedVenue.id)?.latestContributorPrice}
            onToggleStop={toggleBuiltStop}
            pintDrops={pintDrops}
          />
        ) : null}
      </RoutePanel>
    </main>
  );
}
