"use client";

// Postcode progress against our whole London pub list, never the pins in
// view: a filter or a pan must not change how much of N1 you have done. The
// list is the map's own slim index, asked for only once "Your postcodes" is on.

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { beenHereProgress, type BeenHereProgress, type DistrictPub } from "@/lib/beenHereProgress";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { loadSlimVenuesForCityResult } from "@/lib/venuesSlim";

let londonPubs: DistrictPub[] | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getLondonPubs(): DistrictPub[] | null {
  return londonPubs;
}

function loadLondonPubs(): Promise<void> {
  if (londonPubs) return Promise.resolve();
  pending ??= loadSlimVenuesForCityResult("london").then(
    ({ rows, status }) => {
      if (status !== "ready") return;
      const pubs = rows
        .filter((row) => !row.retired && isPubVenueKind(row.kind))
        .map((row) => ({ id: row.id, lat: row.lat, lng: row.lng, searchText: row.filterHints?.searchText }));
      if (pubs.length === 0) return;
      londonPubs = pubs;
      for (const listener of listeners) listener();
    },
    () => {},
  ).finally(() => { pending = null; });
  return pending;
}

/** Null until the list has loaded, and while `on` is false. */
export function useLondonBeenHereProgress(on: boolean, visited: ReadonlySet<string>): BeenHereProgress | null {
  const pubs = useSyncExternalStore(subscribe, getLondonPubs, () => null);
  useEffect(() => {
    if (on) void loadLondonPubs();
  }, [on]);
  return useMemo(() => (on && pubs ? beenHereProgress(pubs, visited) : null), [on, pubs, visited]);
}
