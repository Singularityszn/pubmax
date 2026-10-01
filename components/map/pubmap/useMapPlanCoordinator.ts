"use client";

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { CrawlMode } from "@/components/map/ControlRail";
import { buildRouteLegs } from "@/lib/routeLegs";
import type { NightAreaSlug } from "@/lib/nightAreas";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";
import type { GeneratedMobilePlan } from "@/components/plan/MobilePlanActivation";
import { cleanSelectedDrinkPriceEvidence, selectedDrinkPriceEvidenceForPrice, type SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";

import type { RouteDrinkIntent } from "@/lib/crawlUrl";
import type { MapLensPrice } from "@/lib/mapExperienceLens";

export type GeneratedMapRoutePricing = {
  /** Only explicit shared/restored intent rereads current public price authority. */
  readCurrentQuotes?: boolean;
  context: Pick<GeneratedMobilePlan["context"], "drinkCategory" | "zeroProof">;
  budget: GeneratedMobilePlan["budget"] | null;
  venueIds: readonly string[];
  quotes: ReadonlyMap<string, SelectedDrinkPriceEvidence>;
};

/** Restored intent never restores a generated budget or server proof. */
export function currentMapRoutePricing(
  pricing: GeneratedMapRoutePricing | null,
  currentPrices: ReadonlyMap<string, MapLensPrice>,
): GeneratedMapRoutePricing | null {
  if (!pricing?.readCurrentQuotes) return pricing;
  const quotes = new Map<string, SelectedDrinkPriceEvidence>();
  for (const id of pricing.venueIds) {
    const price = currentPrices.get(id);
    const quote = price?.venueId === id ? selectedDrinkPriceEvidenceForPrice(price, pricing.context) : null;
    if (quote) quotes.set(id, quote);
  }
  return { ...pricing, budget: null, quotes };
}

type InitialPlanState = {
  routeDrinkIntent?: RouteDrinkIntent | null;
  mode: CrawlMode;
  builtIds: string[];
  routeMapped: boolean;
  planningOpen: boolean;
  nightArea: NightAreaSlug | null;
};

/** Owns mobile planning activation state so PubMap does not coordinate it piecemeal. */
export function useMapPlanCoordinator(initial: InitialPlanState) {
  const [mode, setMode] = useState<CrawlMode>(initial.mode);
  const [builtIds, setBuiltIdsState] = useState<string[]>(initial.builtIds);
  const [generatedPricing, setGeneratedPricing] = useState<GeneratedMapRoutePricing | null>(() => initial.routeDrinkIntent && initial.builtIds.length
    ? { context: initial.routeDrinkIntent, venueIds: [...initial.builtIds], budget: null, quotes: new Map(), readCurrentQuotes: true }
    : null);
  const [routeMapped, setRouteMapped] = useState(initial.routeMapped);
  const [planningOpen, setPlanningOpen] = useState(initial.planningOpen);
  const [plannedNightArea, setPlannedNightArea] = useState<NightAreaSlug | null>(initial.nightArea);

  // An edit keeps the requested drink, but cannot keep the old route's totals or quotes.
  const setBuiltIds = useCallback<Dispatch<SetStateAction<string[]>>>((ids) => {
    setBuiltIdsState(ids);
    setGeneratedPricing((current) => current
      ? { ...current, budget: null, quotes: new Map(), readCurrentQuotes: false }
      : null);
  }, []);
  const replaceBuiltIds = useCallback((ids: string[]) => {
    setBuiltIdsState(ids);
    setGeneratedPricing(null);
  }, []);
  const reverseBuiltIds = useCallback(() => {
    setBuiltIdsState((current) => [...current].reverse());
  }, []);
  const activateGeneratedPlan = useCallback((nightArea: NightAreaSlug | null, venueIds: string[], generated?: GeneratedMobilePlan) => {
    setMode("build");
    setBuiltIdsState(venueIds);
    setRouteMapped(true);
    setPlannedNightArea(nightArea);
    const quotes = new Map<string, SelectedDrinkPriceEvidence>();
    for (const stop of generated?.stops ?? []) {
      const quote = cleanSelectedDrinkPriceEvidence(stop.selectedDrinkPriceEvidence);
      if (quote && !generated?.context.zeroProof && quote.category === generated?.context.drinkCategory) {
        quotes.set(stop.venueId, quote);
      }
    }
    setGeneratedPricing(generated ? {
      context: { drinkCategory: generated.context.drinkCategory, zeroProof: generated.context.zeroProof },
      budget: { ...generated.budget }, venueIds: [...venueIds], quotes,
    } : null);
  }, []);

  return {
    mode,
    setMode,
    builtIds,
    setBuiltIds,
    replaceBuiltIds,
    reverseBuiltIds,
    generatedPricing,
    routeMapped,
    setRouteMapped,
    planningOpen,
    setPlanningOpen,
    plannedNightArea,
    setPlannedNightArea,
    activateGeneratedPlan,
  };
}

/** Resolves exactly one route presentation: explicit mapped route first, restored plan second. */
export function useMapPlanPresentation({
  mode,
  builtIds,
  routeMapped,
  suggestedRoute,
  activePlanRoute,
  venueById,
}: {
  mode: CrawlMode;
  builtIds: string[];
  routeMapped: boolean;
  suggestedRoute: Venue[];
  activePlanRoute: Venue[];
  venueById: ReadonlyMap<string, Venue>;
}) {
  // Crawl routes price stops as pints, so a bar/food id that sneaks into
  // builtIds (old URL, stale localStorage) must never resolve into the route.
  const builtRoute = useMemo(
    () =>
      builtIds
        .map((id) => venueById.get(id))
        .filter((venue): venue is Venue => venue !== undefined && isPubVenue(venue)),
    [builtIds, venueById],
  );
  const route = mode === "suggest" ? suggestedRoute : builtRoute;
  const routeMappedActive = routeMapped && route.length >= 2;
  const routeForMap = useMemo(
    () => (routeMappedActive ? route : activePlanRoute),
    [activePlanRoute, route, routeMappedActive],
  );
  const routeForMapLegs = useMemo(() => buildRouteLegs(routeForMap, "walk"), [routeForMap]);

  return { route, routeMappedActive, routeForMap, routeForMapLegs };
}
