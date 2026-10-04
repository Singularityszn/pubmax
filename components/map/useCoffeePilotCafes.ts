"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { CoffeePilotCafe } from "@/lib/coffeePilot";
import { loadCoffeePilotCafes } from "@/lib/coffeePilotLoader";

type CoffeePilotStatus = "idle" | "loading" | "ready" | "failed";

export type CoffeePilotState = {
  status: CoffeePilotStatus;
  cafes: readonly CoffeePilotCafe[];
  byId: ReadonlyMap<string, CoffeePilotCafe>;
};

const NO_CAFES: readonly CoffeePilotCafe[] = [];

/**
 * The Shoreditch pilot cafes, read the first time `wanted` turns true and held
 * for the rest of the visit. A failed read stays failed until the next visit
 * rather than retrying on every lane switch.
 */
export function useCoffeePilotCafes(wanted: boolean): CoffeePilotState {
  const [status, setStatus] = useState<CoffeePilotStatus>("idle");
  const [cafes, setCafes] = useState<readonly CoffeePilotCafe[]>(NO_CAFES);

  const started = useRef(false);

  useEffect(() => {
    if (!wanted || started.current) return;
    started.current = true;
    queueMicrotask(() => setStatus("loading"));
    loadCoffeePilotCafes().then(
      (loaded) => {
        setCafes(loaded);
        setStatus("ready");
      },
      () => setStatus("failed"),
    );
  }, [wanted]);

  const byId = useMemo(
    () => new Map(cafes.map((cafe) => [cafe.id, cafe] as const)),
    [cafes],
  );
  return { status, cafes, byId };
}
