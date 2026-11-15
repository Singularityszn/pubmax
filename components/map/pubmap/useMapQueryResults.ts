"use client";

import { useMemo } from "react";

import { settledPintCapMatches, type PintCapMatches } from "@/lib/pintCapMatches";
import type { Venue } from "@/lib/venues";

export function useMapQueryResults({ canvasVenues, filteredVenues, maxPrice, settled, failed }: {
  canvasVenues: readonly Venue[];
  filteredVenues: readonly Venue[];
  maxPrice: number;
  settled: boolean;
  failed: boolean;
}): { queryVenues: Venue[]; pintCapMatched: PintCapMatches | null; resultCount: number | null } {
  const queryVenues = useMemo(() => {
    const matchingIds = new Set(filteredVenues.map((venue) => venue.id));
    return canvasVenues.filter((venue) => matchingIds.has(venue.id));
  }, [canvasVenues, filteredVenues]);
  const pintCapMatched = useMemo(
    () => settledPintCapMatches(queryVenues, maxPrice, { settled, failed }),
    [settled, failed, queryVenues, maxPrice],
  );
  return { queryVenues, pintCapMatched, resultCount: settled ? queryVenues.length : null };
}
