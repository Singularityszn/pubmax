"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { updateMapFilterIntent, type MapFilterIntent } from "@/lib/mapFilterIntent";
import type { Filters } from "@/lib/venues";

export function useMapDiscoveryFilters(initial: Filters): [Filters, Dispatch<SetStateAction<Filters>>, readonly (keyof Filters)[]] {
  const [state, setState] = useState<MapFilterIntent>(() => ({ filters: initial, currentFilterKeys: [] }));
  const setFilters = useCallback<Dispatch<SetStateAction<Filters>>>((action) => {
    setState((previous) => updateMapFilterIntent(
      previous,
      typeof action === "function" ? action(previous.filters) : action,
    ));
  }, []);
  return [state.filters, setFilters, state.currentFilterKeys];
}
