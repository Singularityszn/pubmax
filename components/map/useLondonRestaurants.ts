"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  loadLondonRestaurants,
  londonRestaurantLayerMode,
  londonRestaurantPackWanted,
  type LondonRestaurant,
  type LondonRestaurantStatus,
} from "@/lib/londonRestaurants";

export type LondonRestaurantsState = {
  mode: ReturnType<typeof londonRestaurantLayerMode>;
  status: LondonRestaurantStatus;
  restaurants: readonly LondonRestaurant[];
  byId: ReadonlyMap<string, LondonRestaurant>;
};

const NO_RESTAURANTS: readonly LondonRestaurant[] = [];

type LondonRestaurantLayerInput = Omit<Parameters<typeof londonRestaurantLayerMode>[0], "selectedVenueId">
  & Omit<Parameters<typeof londonRestaurantPackWanted>[0], "shown">;

export function useLondonRestaurants(input: LondonRestaurantLayerInput): LondonRestaurantsState {
  const { selectedVenueId } = input;
  const mode = londonRestaurantLayerMode({
    ...input,
    selectedVenueId: input.selectedIsCafe ? undefined : selectedVenueId,
  });
  const wanted = londonRestaurantPackWanted({ ...input, shown: mode !== "off" });
  const scope = mode === "selection" ? selectedVenueId : "all";
  const [status, setStatus] = useState<LondonRestaurantStatus>("idle");
  const [restaurants, setRestaurants] = useState<readonly LondonRestaurant[]>(NO_RESTAURANTS);
  const [settledRead, setSettledRead] = useState<{ scope: string; selectedVenueId: string } | null>(null);
  const requested = useRef<{ scope: string; selectedVenueId: string; settled: boolean } | null>(null);

  useEffect(() => () => {
    if (!requested.current?.settled) requested.current = null;
  }, [wanted, scope]);

  useEffect(() => {
    if (!wanted) {
      queueMicrotask(() => setStatus(current => current === "failed" ? "idle" : current));
      return;
    }
    if (requested.current?.scope === "all" || requested.current?.scope === scope) {
      requested.current.selectedVenueId = selectedVenueId;
      return;
    }
    const request = { scope, selectedVenueId, settled: false };
    requested.current = request;
    queueMicrotask(() => setStatus("loading"));
    loadLondonRestaurants(fetch, scope === "all" ? undefined : selectedVenueId).then(
      (loaded) => {
        if (request !== requested.current) return;
        request.settled = true;
        setRestaurants(loaded);
        setSettledRead({ scope, selectedVenueId: request.selectedVenueId });
        setStatus("ready");
      },
      () => {
        if (request !== requested.current) return;
        requested.current = null;
        setSettledRead({ scope, selectedVenueId: request.selectedVenueId });
        setStatus("failed");
      },
    );
  }, [wanted, selectedVenueId, scope]);

  const byId = useMemo(
    () => new Map(restaurants.map((restaurant) => [restaurant.id, restaurant] as const)),
    [restaurants],
  );
  const changingScope = settledRead !== null && !(settledRead.scope === "all" && status === "ready")
    && (settledRead.scope !== scope || settledRead.selectedVenueId !== selectedVenueId);
  return { mode, status: changingScope ? "loading" : status, restaurants, byId };
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
