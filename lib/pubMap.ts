// Pure helpers extracted from components/PubMap.tsx (F1 decomposition).
//
// Server-safe: NO "use client", no window/DOM reads, no React. These live off
// PubMap's complexity budget and are unit-tested in __tests__/pubMap.test.ts.
// seedCrawlState is imported from the pure @/lib/crawlUrl (NOT the client
// @/components/map/useCrawlUrl re-export) so this module never pulls a client
// boundary in.

import { venueGroupingKey, type Filters, type Venue } from "@/lib/venues";
import { type CuratedCrawl } from "@/lib/curatedCrawls";
import { curatedCrawlsForCity, curatedCrawlByIdForCity } from "@/lib/cityCuratedCrawls";
import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { seedCrawlState } from "@/lib/crawlUrl";
import { isDrinkShapeArrival } from "@/lib/mapArrival";

// §4.5: did the page arrive with any crawl-shaping URL param (a shared/deep
// link)? If any are present the arrival is intentional and we never onboard.
// Module-level (pure) so the branch lives off PubMap's complexity budget.
// `drink=` counts (landing drink-shape taps) but is NOT a planner-open signal.
export function hasCrawlArrivalParams(search: string): boolean {
  // Intentional deep links (landmark/band/food/log/etc.) must also suppress
  // curated onboarding — not only crawl planner params (#79 follow-up).
  return /[?&](pubs|sel|style|mode|q|drink|cocktails|landmark|band|food|max|alt|log|crawl)=/.test(
    search,
  );
}

// Issue #15: normalise a landmark's nearest-pub ids into crawl stops — drop
// blanks, cap at three. Module-level (pure) so the branch lives outside the
// PubMap component body and off its complexity budget.
export function crawlStopsFromPubIds(ids: string[]): string[] {
  return ids.filter(Boolean).slice(0, 3);
}

// Issue #31: fold a curated crawl's style choices onto the current filters. A
// mocktail crawl composes with the non-alcoholic filter — the honest, minimal
// way an alt style touches the actual route. Module-level (pure) so the branch
// lives off PubMap's complexity budget.
export function filtersForCuratedCrawl(current: Filters, crawl: CuratedCrawl): Filters {
  return {
    ...current,
    crawlStyle: crawl.crawlStyle,
    requireNonAlcoholic: crawl.altStyle === "mocktail" ? true : current.requireNonAlcoholic,
  };
}

/** Resolve a curated crawl from ?crawl= or an exact pubs= stop list match. */
export function resolveSeededCuratedCrawl(
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

export type MapSeed = ReturnType<typeof seedCrawlState> & {
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
export function buildMapSeed(search: string, cityId: CityId = DEFAULT_CITY_ID): MapSeed {
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

export type VenueDetailStatus = "idle" | "loading" | "ready" | "unavailable";

export function detailStatusFor(
  selectedVenueId: string,
  detailById: Map<string, Venue>,
  detailStatusById: Map<string, VenueDetailStatus>,
): VenueDetailStatus {
  if (!selectedVenueId) return "idle";
  if (detailById.has(selectedVenueId)) return "ready";
  return detailStatusById.get(selectedVenueId) ?? "loading";
}

/**
 * Quiet honesty for a `?sel=` that never resolved to a known pub.
 * Waits until the map index has settled and the detail warm has reported
 * unavailable, so a still-loading curated pin never flashes the note.
 * UK base ids are a separate path (ring / hint restore), never "unknown".
 */
export function isUnknownMapSelection(input: {
  loaded: boolean;
  selectedVenueId: string;
  resolvable: boolean;
  ukBase: boolean;
  detailStatus: VenueDetailStatus;
}): boolean {
  if (!input.loaded || !input.selectedVenueId) return false;
  if (input.ukBase) return false;
  if (input.resolvable) return false;
  return input.detailStatus === "unavailable";
}

/** Visible copy for an unknown `?sel=` - empty-state voice, no plumbing. */
export const UNKNOWN_MAP_SELECTION_NOTE = "That pub is not one we know.";

export function venueUpdateKey(venue: Venue): string {
  const firstPrice = venue.prices[0];
  return firstPrice ? venueGroupingKey(firstPrice) : venue.id;
}

export function normaliseTonightVenueLookup(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
