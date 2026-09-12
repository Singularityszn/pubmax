"use client";

import { useCallback, useRef, useState } from "react";

import {
  parseUkPlaceIndex,
  UK_PLACE_INDEX_PATH,
  type UkPlace,
  type UkPlaceIndexStatus,
} from "@/lib/ukPlaceSearch";

/**
 * The ONE browser read of the UK place index.
 *
 * The index is the map's own base layer, two megabytes of place names, so it is
 * never part of a surface's first paint: a caller asks for it only once its own
 * answer has run out. Both surfaces that search it ask the same question, so
 * they ask it through one loader rather than one four-state machine each.
 *
 * `load` is IDEMPOTENT while a read is in flight or done, and it hands back the
 * parsed rows, because the chooser's geolocation lane needs the places
 * themselves rather than the render state. A FAILED read clears the held
 * promise, so the next call is the retry: the chooser makes that call from its
 * change handler and the picker from an effect keyed on its query, and neither
 * can leave a reader who lost the network mid-word stuck on the failure line.
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
