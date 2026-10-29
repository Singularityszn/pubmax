import { initialFilters, type Filters } from "@/lib/venues";

export type MapFilterIntent = {
  filters: Filters;
  currentFilterKeys: readonly (keyof Filters)[];
};

/** Remember explicit resets so saved preferences cannot turn a filter back on. */
export function updateMapFilterIntent(
  state: MapFilterIntent,
  next: Filters,
): MapFilterIntent {
  const keys = Object.keys(initialFilters) as (keyof Filters)[];
  const reset = keys.every((key) => next[key] === initialFilters[key]);
  const changed = keys.filter((key) => reset || state.filters[key] !== next[key]);
  return {
    filters: next,
    currentFilterKeys: [...new Set([...state.currentFilterKeys, ...changed])],
  };
}
