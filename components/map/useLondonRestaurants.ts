"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  loadLondonRestaurants,
  type LondonRestaurant,
  type LondonRestaurantStatus,
} from "@/lib/londonRestaurants";

export type LondonRestaurantsState = {
  status: LondonRestaurantStatus;
  restaurants: readonly LondonRestaurant[];
  byId: ReadonlyMap<string, LondonRestaurant>;
};

const NO_RESTAURANTS: readonly LondonRestaurant[] = [];

/**
 * The London restaurant pack, read the first time `wanted` turns true and held
 * for the rest of the visit (lib/londonRestaurants.ts
 * `londonRestaurantPackWanted`). A failed read is asked for again the next
 * time `wanted` turns true, rather than on every render.
 */
export function useLondonRestaurants(wanted: boolean, selectedVenueId?: string): LondonRestaurantsState {
  const [status, setStatus] = useState<LondonRestaurantStatus>("idle");
  const [restaurants, setRestaurants] = useState<readonly LondonRestaurant[]>(NO_RESTAURANTS);
  const [settledScope, setSettledScope] = useState<string | null>(null);
  const requested = useRef<string | null>(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    const scope = selectedVenueId ?? "all";
    if (!wanted) {
      queueMicrotask(() => setStatus(current => current === "failed" ? "idle" : current));
      return;
    }
    if (requested.current === "all" || requested.current === scope) return;
    requested.current = scope;
    const request = ++latestRequest.current;
    let settled = false;
    queueMicrotask(() => setStatus("loading"));
    loadLondonRestaurants(fetch, selectedVenueId).then(
      (loaded) => {
        settled = true;
        if (request !== latestRequest.current) return;
        setRestaurants(loaded);
        setSettledScope(scope);
        setStatus("ready");
      },
      () => {
        settled = true;
        if (request !== latestRequest.current) return;
        requested.current = null;
        setSettledScope(scope);
        setStatus("failed");
      },
    );
    return () => {
      if (!settled && request === latestRequest.current) {
        latestRequest.current += 1;
        requested.current = null;
      }
    };
  }, [wanted, selectedVenueId]);

  const byId = useMemo(
    () => new Map(restaurants.map((restaurant) => [restaurant.id, restaurant] as const)),
    [restaurants],
  );
  const changingScope = settledScope !== null && !(settledScope === "all" && status === "ready") && settledScope !== (selectedVenueId ?? "all");
  return { status: changingScope ? "loading" : status, restaurants, byId };
}

/**
 * `restaurants`, or the list this hook last returned while that one holds the
 * same restaurants in the same order. The canvas resets its restaurant source
 * for every new list, and a tap rebuilds the drawn list without changing it.
 */
export function useStableRestaurantList<T extends { id: string }>(
  restaurants: readonly T[],
): readonly T[] {
  const ids = useMemo(() => restaurants.map((restaurant) => restaurant.id).join(" "), [restaurants]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids are the list's identity
  return useMemo(() => restaurants, [ids]);
}
