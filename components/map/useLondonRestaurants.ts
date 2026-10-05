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
export function useLondonRestaurants(wanted: boolean): LondonRestaurantsState {
  const [status, setStatus] = useState<LondonRestaurantStatus>("idle");
  const [restaurants, setRestaurants] = useState<readonly LondonRestaurant[]>(NO_RESTAURANTS);
  const requested = useRef(false);

  useEffect(() => {
    if (!wanted || requested.current) return;
    requested.current = true;
    queueMicrotask(() => setStatus("loading"));
    loadLondonRestaurants().then(
      (loaded) => {
        setRestaurants(loaded);
        setStatus("ready");
      },
      () => {
        requested.current = false;
        setStatus("failed");
      },
    );
  }, [wanted]);

  const byId = useMemo(
    () => new Map(restaurants.map((restaurant) => [restaurant.id, restaurant] as const)),
    [restaurants],
  );
  return { status, restaurants, byId };
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
