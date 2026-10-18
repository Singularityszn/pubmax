"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  loadLondonFoodPlaces,
  type LondonFoodPlace,
  type LondonFoodPlaceStatus,
} from "@/lib/londonFoodPlaces";
import { isLondonVenueId } from "@/lib/londonVenueShards";
import { londonFoodPlaceSelection } from "@/lib/pubMap";

type LondonFoodPlacesState = {
  status: LondonFoodPlaceStatus;
  byId: ReadonlyMap<string, LondonFoodPlace>;
};

const NO_PLACES: readonly LondonFoodPlace[] = [];

/**
 * The London food pack (lib/londonFoodPlaces.ts), read the first time `wanted`
 * turns true and held for the rest of the visit. The map wants it only for a
 * `venue-osm-` selection, because a counter has no pin and opens only from a
 * link. A failed read is asked for again the next time `wanted` turns true.
 */
function useLondonFoodPlaces(wanted: boolean): LondonFoodPlacesState {
  const [status, setStatus] = useState<LondonFoodPlaceStatus>("idle");
  const [places, setPlaces] = useState<readonly LondonFoodPlace[]>(NO_PLACES);
  const requested = useRef(false);

  useEffect(() => {
    if (!wanted || requested.current) return;
    requested.current = true;
    queueMicrotask(() => setStatus("loading"));
    loadLondonFoodPlaces().then(
      (loaded) => {
        setPlaces(loaded);
        setStatus("ready");
      },
      () => {
        requested.current = false;
        setStatus("failed");
      },
    );
  }, [wanted]);

  const byId = useMemo(
    () => new Map(places.map((place) => [place.id, place] as const)),
    [places],
  );
  return { status, byId };
}

/**
 * The counter a map selection opens, and whether the map may let the selection
 * go. The pack is read only for a `venue-osm-` selection on a London map, and
 * the selection is let go only when the other London sources (the coffee pilot
 * and the restaurants) and this one all would, because an id one source cannot
 * place may be another's.
 */
export function useLondonFoodSelection(input: {
  isLondon: boolean;
  selectedVenueId: string;
  otherSourcesRelease: boolean;
}): { place: LondonFoodPlace | null; release: boolean } {
  const wanted = input.isLondon && isLondonVenueId(input.selectedVenueId);
  const read = useLondonFoodPlaces(wanted);
  const pick = londonFoodPlaceSelection({
    shown: input.isLondon,
    selectedVenueId: input.selectedVenueId,
    status: read.status,
    byId: read.byId,
  });
  return { place: pick.place, release: input.otherSourcesRelease && pick.release };
}
