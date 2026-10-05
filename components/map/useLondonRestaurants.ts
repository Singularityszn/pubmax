"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { LondonVenue } from "@/lib/londonVenueShards";
import {
  loadLondonRestaurants,
  type LondonRestaurantStatus,
} from "@/lib/londonRestaurants";

export type LondonRestaurantsState = {
  status: LondonRestaurantStatus;
  restaurants: readonly LondonVenue[];
  byId: ReadonlyMap<string, LondonVenue>;
};

const NO_RESTAURANTS: readonly LondonVenue[] = [];

/**
 * The London restaurant pack, read the first time `wanted` turns true and held
 * for the rest of the visit (lib/londonRestaurants.ts
 * `londonRestaurantPackWanted`). A failed read is asked for again the next
 * time `wanted` turns true, rather than on every render.
 */
export function useLondonRestaurants(wanted: boolean): LondonRestaurantsState {
  const [status, setStatus] = useState<LondonRestaurantStatus>("idle");
  const [restaurants, setRestaurants] = useState<readonly LondonVenue[]>(NO_RESTAURANTS);
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
