"use client";

// Postcode progress against our whole London pub list, never the pins in
// view: a filter or a pan must not change how much of N1 you have done. The
// list is the map's own slim index, asked for only once "Your postcodes" is on.

import { useEffect, useMemo, useState } from "react";

import { beenHereProgress, type BeenHereProgress, type DistrictPub } from "@/lib/beenHereProgress";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { loadSlimVenuesForCityResult } from "@/lib/venuesSlim";

let londonPubs: Promise<DistrictPub[] | null> | null = null;

function loadLondonPubs(): Promise<DistrictPub[] | null> {
  londonPubs ??= loadSlimVenuesForCityResult("london").then(
    ({ rows, status }) => {
      if (status !== "ready") {
        londonPubs = null;
        return null;
      }
      const pubs = rows
        .filter((row) => !row.retired && isPubVenueKind(row.kind))
        .map((row) => ({ id: row.id, lat: row.lat, lng: row.lng, searchText: row.filterHints?.searchText }));
      if (pubs.length === 0) {
        londonPubs = null;
        return null;
      }
      return pubs;
    },
    (error: unknown) => {
      londonPubs = null;
      throw error;
    },
  );
  return londonPubs;
}

/** Null until the list has loaded, and while `on` is false. */
export function useLondonBeenHereProgress(on: boolean, visited: ReadonlySet<string>): BeenHereProgress | null {
  const [pubs, setPubs] = useState<DistrictPub[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    loadLondonPubs().then(
      (rows) => {
        if (live) setPubs(rows);
      },
      () => {
        // No list, no figures: the layer draws nothing rather than guess.
      },
    );
    return () => {
      live = false;
    };
  }, [on]);
  return useMemo(() => (on && pubs ? beenHereProgress(pubs, visited) : null), [on, pubs, visited]);
}
