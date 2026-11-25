import { useLayoutEffect, useMemo } from "react";
import { useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import { EMPTY_MAP_SURFACE_STATE, useMapSurfaceNavigation } from "@/components/map/pubmap/useMapSurfaceNavigation";
import type { CrawlUrlState } from "@/lib/crawlUrl";
import { initialFilters, type Filters } from "@/lib/venues";

export function mapState(
  query: string,
  drinkCategory: Filters["drinkCategory"],
  selectedVenueId: string,
): CrawlUrlState {
  const filters: Filters = {
    ...initialFilters,
    query,
    drinkCategory,
    requireCocktails: drinkCategory === "cocktail",
  };
  return {
    mode: "suggest",
    filters,
    builtIds: [],
    selectedVenueId,
  };
}

export let openHistorySurface: ReturnType<typeof useMapSurfaceNavigation>["open"];
export let closeHistorySurfaces: ReturnType<typeof useMapSurfaceNavigation>["home"];
export let leaveHistorySurface: ReturnType<typeof useMapSurfaceNavigation>["leave"];

export function HistoryHarness({
  query,
  drinkCategory = "",
  selectedVenueId = "",
  holdCleanUrl = false,
  crawlStyle = initialFilters.crawlStyle,
  maxPrice = initialFilters.maxPrice,
  zone = initialFilters.zone,
  plan,
  pending = false,
}: {
  query: string;
  drinkCategory?: Filters["drinkCategory"];
  selectedVenueId?: string;
  holdCleanUrl?: boolean;
  crawlStyle?: Filters["crawlStyle"];
  maxPrice?: number;
  zone?: Filters["zone"];
  plan?: Pick<CrawlUrlState, "mode" | "builtIds" | "crawlId" | "altStyle">;
  pending?: boolean;
}) {
  const state = useMemo(() => {
    const current = mapState(query, drinkCategory, selectedVenueId);
    return { ...current, ...plan, filters: { ...current.filters, crawlStyle, maxPrice, zone } };
  }, [query, drinkCategory, selectedVenueId, crawlStyle, maxPrice, zone, plan]);
  const onSurfaceClose = useCrawlUrlSync(state, holdCleanUrl, pending);
  const trail = useMapSurfaceNavigation({
    arrivalSearch: window.location.search,
    surfaceId: "none",
    surfaceTitle: "",
    surfaceState: EMPTY_MAP_SURFACE_STATE,
    selectionHint: "",
    onRestore: () => {},
    onHome: () => {},
    onSurfaceClose,
  });
  useLayoutEffect(() => {
    openHistorySurface = trail.open;
    closeHistorySurfaces = trail.home;
    leaveHistorySurface = trail.leave;
  }, [trail.open, trail.home, trail.leave]);
  return null;
}

