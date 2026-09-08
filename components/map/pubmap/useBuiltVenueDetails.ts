"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CrawlMode } from "@/components/map/ControlRail";
import type { CityId } from "@/lib/cities";
import { isNationalBaseVenueId, venueIdMatchesCity } from "@/lib/cityVenueIds";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";
import { warmVenueDetail } from "@/lib/warmVenueDetail";

export type BuiltVenueDetailsState = {
  loadingCount: number;
  failedCount: number;
  missingCount: number;
  retry: () => void;
};

type ReadStatus = "found" | "failed" | "missing";

export function hasUnresolvedBuiltStops(mode: CrawlMode, state?: BuiltVenueDetailsState): boolean {
  return mode === "build" && state !== undefined &&
    state.loadingCount + state.failedCount + state.missingCount > 0;
}

/** A shared crawl must resolve its stops outside the map's loaded cells. */
export function useBuiltVenueDetails({
  cityId,
  builtIds,
  venueById,
  onResolved,
}: {
  cityId: CityId;
  builtIds: readonly string[];
  venueById: ReadonlyMap<string, Venue>;
  onResolved: (venues: ReadonlyMap<string, Venue>) => void;
}): BuiltVenueDetailsState {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    scope: string;
    results: ReadonlyMap<string, ReadStatus>;
  } | null>(null);
  const scope = JSON.stringify([cityId, builtIds, attempt]);
  const results = settled?.scope === scope ? settled.results : undefined;
  const unresolved = useMemo(() => [...new Set(builtIds)].filter((id) => {
    const venue = venueById.get(id);
    return !venue || !isPubVenue(venue);
  }), [builtIds, venueById]);
  const missing = useMemo(() => unresolved.filter((id) =>
    !venueById.has(id) && !isNationalBaseVenueId(id) && venueIdMatchesCity(id, cityId),
  ), [unresolved, cityId, venueById]);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    for (const id of missing) {
      if (results?.has(id)) continue;
      void warmVenueDetail(id).then((result) => {
        if (cancelled) return;
        const status = result.status === "found" &&
          (!isPubVenue(result.venue) || !venueIdMatchesCity(result.venue.id, cityId))
          ? "missing"
          : result.status;
        setSettled((current) => ({
          scope,
          results: new Map(current?.scope === scope ? current.results : []).set(id, status),
        }));
        if (status === "found" && result.status === "found") {
          onResolved(new Map([[id, result.venue]]));
        }
      });
    }
    return () => { cancelled = true; };
  }, [cityId, missing, onResolved, results, scope]);

  return {
    loadingCount: missing.filter((id) => !results?.has(id)).length,
    failedCount: missing.filter((id) => results?.get(id) === "failed").length,
    missingCount: unresolved.length - missing.length +
      missing.filter((id) => results?.get(id) === "missing").length,
    retry,
  };
}
