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

export default function PubMap() {
  // Seed the crawl from the shareable URL (falls back to defaults / honors
  // ?style=heritage from the landing page). Lazy init keeps this off effects.
  const seed = useMemo(
    () => seedCrawlState(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
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
  const filteredVenues = useMemo(() => filterVenues(venues, filters), [venues, filters]);

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

  const selectVenue = useCallback(
    (id: string) => {
      setSelectedVenueId(id);
      closeComposer();
    },
    [closeComposer],
  );

  const toggleBuiltStop = useCallback((id: string) => {
    setBuiltIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
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
        onClearBuilt={() => setBuiltIds([])}
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
        onSelectVenue={selectVenue}
        onToggleStop={toggleBuiltStop}
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
