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
  const [selectedVenueId, setSelectedVenueId] = useState<string>(seed.selectedVenueId);
  const [filters, setFilters] = useState<Filters>(seed.filters);
  const [mode, setMode] = useState<CrawlMode>(seed.mode);
  const [builtIds, setBuiltIds] = useState<string[]>(seed.builtIds);

  // Community Pint Drops: fetch/submit/report state lives in the hook.
  const pintDrops = usePintDrops();
  const { dropsByVenueId, venueSignals, refreshVenueDrops, closeComposer } = pintDrops;

  useEffect(() => {
    fetch("/data/pint_prices_app_dataset.json")
      .then((response) => response.json())
      .then((data: VenuePrice[]) => setRows(data));
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
      />

      <section className="mapStage">
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
        {selectedVenue ? (
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
