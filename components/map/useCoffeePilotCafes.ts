"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { CoffeePilotCafe, CoffeePilotStatus } from "@/lib/coffeePilot";
import { loadCoffeePilotCafes } from "@/lib/coffeePilotLoader";

export type CoffeePilotState = {
  status: CoffeePilotStatus;
  cafes: readonly CoffeePilotCafe[];
  byId: ReadonlyMap<string, CoffeePilotCafe>;
  /** Read the pilot again after a failed read. */
  retry: () => void;
};

const NO_CAFES: readonly CoffeePilotCafe[] = [];

/**
 * The Shoreditch pilot cafes, read the first time `wanted` turns true and held
 * for the rest of the visit. A failed read stays failed until the reader asks
 * for it again with `retry`, rather than retrying on every lane switch.
 */
export function useCoffeePilotCafes(wanted: boolean): CoffeePilotState {
  const [status, setStatus] = useState<CoffeePilotStatus>("idle");
  const [cafes, setCafes] = useState<readonly CoffeePilotCafe[]>(NO_CAFES);
  const [attempt, setAttempt] = useState(0);

  const startedAttempt = useRef<number | null>(null);

  useEffect(() => {
    if (!wanted || startedAttempt.current === attempt) return;
    startedAttempt.current = attempt;
    queueMicrotask(() => setStatus("loading"));
    loadCoffeePilotCafes().then(
      (loaded) => {
        setCafes(loaded);
        setStatus("ready");
      },
      () => setStatus("failed"),
    );
  }, [attempt, wanted]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  const byId = useMemo(
    () => new Map(cafes.map((cafe) => [cafe.id, cafe] as const)),
    [cafes],
  );
  return { status, cafes, byId, retry };
}

/**
 * Lets a `venue-osm-` selection go once `release` says no London source has a
 * sheet to open for it (lib/pubMap.ts `coffeePilotSelection` and
 * `londonRestaurantSelection`). It leaves through the map trail's own
 * `rejectSelection`, so the venue entry leaves history with the sheet and a
 * later Back cannot land on it.
 */
export function useReleaseLondonVenueSelection(
  release: boolean,
  selectedVenueId: string,
  rejectSelection: (venueId: string) => void,
  setSelectedVenueId: Dispatch<SetStateAction<string>>,
): void {
  useEffect(() => {
    if (!release) return;
    const released = selectedVenueId;
    queueMicrotask(() => {
      rejectSelection(released);
      setSelectedVenueId((current) => (current === released ? "" : current));
    });
  }, [rejectSelection, release, selectedVenueId, setSelectedVenueId]);
}
