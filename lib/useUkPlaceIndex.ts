"use client";

import { useCallback, useRef, useState } from "react";

import {
  parseUkPlaceIndex,
  UK_PLACE_INDEX_PATH,
  type UkPlace,
  type UkPlaceIndexStatus,
} from "@/lib/ukPlaceSearch";

/**
 * The UK place index read the Places tab's town search makes.
 *
 * The index is the map's own base layer, two megabytes of place names, so it is
 * never part of a surface's first paint: a caller asks for it only once its own
 * answer has run out. It is NOT the only browser read of that file: the map's own search
 * (`components/PubMap.tsx`) and its suggestion banner
 * (`components/map/CitySuggestBanner.tsx`) read it on their own lanes, with
 * their own lifecycles, and converging those is a separate piece of work.
 *
 * `load` is IDEMPOTENT while a read is in flight or done, and it hands back the
 * parsed rows. A FAILED read clears the held promise, so the next call is the
 * retry: the Places tab makes that call from an effect keyed on its query, so
 * it cannot leave a reader who lost the network mid-word stuck on the failure
 * line.
 */
export function useUkPlaceIndex(): {
  status: UkPlaceIndexStatus;
  places: UkPlace[];
  load: () => Promise<UkPlace[]>;
} {
  const [state, setState] = useState<{
    status: UkPlaceIndexStatus;
    places: UkPlace[];
  }>({ status: "idle", places: [] });
  const pending = useRef<Promise<UkPlace[]> | null>(null);

  const load = useCallback((): Promise<UkPlace[]> => {
    if (pending.current) return pending.current;
    setState({ status: "loading", places: [] });
    const read = fetch(UK_PLACE_INDEX_PATH)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const places = parseUkPlaceIndex(await response.json());
        setState({ status: "ready", places });
        return places;
      })
      .catch(() => {
        pending.current = null;
        setState({ status: "error", places: [] });
        return [] as UkPlace[];
      });
    pending.current = read;
    return read;
  }, []);

  return { status: state.status, places: state.places, load };
}
