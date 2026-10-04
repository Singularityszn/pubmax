"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
