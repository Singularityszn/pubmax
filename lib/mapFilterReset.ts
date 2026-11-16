import type { Filters } from "@/lib/venues";

export function resetMapRefinements(current: Filters, defaults: Filters): Filters {
  const { query, crawlStyle, stopCount, routeWindow } = current;
  return { ...defaults, query, crawlStyle, stopCount, routeWindow };
}
