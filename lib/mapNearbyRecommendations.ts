import { haversineKm } from "@/lib/haversine";
import { WALKABLE_RADIUS_KM, WIDENED_RADIUS_KM, walkMinutesFromKm } from "@/lib/nearMeAnswer";
import type { NightProfileInput } from "@/lib/nightProfile";
import type { DrinkCategory } from "@/lib/drinks";
import { filterVenues, initialFilters, NO_PINT_PRICE_CAP, type Filters, type Venue } from "@/lib/venues";
import { isPublicRankablePub } from "@/lib/venueKindFilters";

export type NearbyPrice = {
  priceGbp: number;
  drinkLabel: string;
  measureLabel: string;
  category: DrinkCategory;
  sourceLabel?: string;
  sourceUrl?: string;
  observedAt?: string;
  /** False means that the source does not identify the serving measure. */
  servingKnown?: boolean;
};

export type MapNearbyCard = {
  venue: Venue;
  price: NearbyPrice;
  distanceKm: number;
  walkMinutes: number;
  roles: Array<"cheapest" | "best-match">;
  reasons: string[];
};

export type MapNearbyPreferences = {
  filters: Filters;
  blockedConstraints: string[];
  unassessedPreferences: string[];
};

/** Explicit current choices, including false, override saved account choices. */
export function resolveMapNearbyFilters(
  current: Filters,
  savedProfile: NightProfileInput | null = null,
  currentFilterKeys: readonly (keyof Filters)[] = [],
): MapNearbyPreferences {
  const filters = { ...current };
  const blockedConstraints: string[] = [];
  const unassessedPreferences: string[] = [];
  const context = savedProfile?.context;
  if (!context) return { filters, blockedConstraints, unassessedPreferences };
  const chosen = (key: keyof Filters) => currentFilterKeys.includes(key) || current[key] !== initialFilters[key];
  const apply = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    if (!chosen(key)) filters[key] = value;
  };
  const drinkChosen = chosen("drinkCategory") || chosen("drinkBrand") || chosen("drinkSubtype") || chosen("requireNonAlcoholic");
  if (!drinkChosen) {
    if (context.drinkCategory) apply("drinkCategory", context.drinkCategory);
    if (context.zeroProof) apply("requireNonAlcoholic", true);
  }
  for (const need of context.accessibility) {
    if (need === "step-free") apply("requireStepFree", true);
    else if (need === "accessible-toilet") apply("requireAccessibleToilet", true);
    // Reliable seating and seated service describe different facts.
    else blockedConstraints.push(need);
  }
  for (const need of context.foodNeeds) {
    if (need === "food") apply("requireFood", true);
    else blockedConstraints.push(need);
  }
  unassessedPreferences.push(...context.atmosphere.filter((value) => !["historic", "garden", "sports", "music", "lively"].includes(value)));
  if (context.budgetLimitPence !== null) unassessedPreferences.push("whole-night budget");
  unassessedPreferences.push(...context.transportConstraints);
  return { filters, blockedConstraints, unassessedPreferences };
}

export type MapNearbyOptions = {
  location: { lat: number; lng: number };
  venues: readonly Venue[];
  filters: Filters;
  savedProfile?: NightProfileInput | null;
  currentFilterKeys?: readonly (keyof Filters)[];
  /** Return only a trusted price for the exact requested drink and measure. */
  priceForVenue: (venue: Venue, effectiveFilters: Filters) => NearbyPrice | null;
  hasPintDrops?: (venueId: string) => boolean;
  openNowState?: (venueId: string) => boolean | "unknown";
  /** Directory-matched branch IDs, never an operator inferred from its name. */
  wetherspoonsMatchedIds?: ReadonlySet<string>;
  /** A radius beyond 2.5 km requires a separate, explicit user choice. */
  fartherRadiusKm?: number;
};

export type MapNearbyRecommendations = MapNearbyPreferences & {
  cards: MapNearbyCard[];
  scope: "walkable" | "widened" | "farther" | "none";
  radiusKm: number;
  qualifyingWithinWalk: number;
};

function validPoint(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180;
}

function preferenceReasons(venue: Venue, options: MapNearbyOptions): string[] {
  const context = options.savedProfile?.context;
  if (!context) return [];
  const chosen = (key: keyof Filters) => options.currentFilterKeys?.includes(key)
    || options.filters[key] !== initialFilters[key];
  const reasons: string[] = [];
  if (context.atmosphere.includes("historic") && !chosen("requireHeritage") && venue.hasStory) reasons.push("Heritage on record");
  if (context.atmosphere.includes("garden") && !chosen("requireBeerGarden") && venue.amenities.beerGarden) reasons.push("Beer garden on record");
  if (context.atmosphere.includes("sports") && !chosen("requireLiveSports") && venue.amenities.liveSports) reasons.push("Live sports on record");
  if ((context.atmosphere.includes("music") || context.atmosphere.includes("lively")) && venue.amenities.liveMusic) reasons.push("Live music on record");
  if (context.wetherspoonsPreferred && options.wetherspoonsMatchedIds?.has(venue.id)) reasons.push("Matches your saved Wetherspoon preference");
  return reasons;
}

/** Select two roles from the same constrained pool. Never widen beyond the chosen radius. */
export function rankMapNearbyRecommendations(options: MapNearbyOptions): MapNearbyRecommendations {
  const preferences = resolveMapNearbyFilters(options.filters, options.savedProfile, options.currentFilterKeys);
  const requestedRadius = options.fartherRadiusKm;
  const radiusKm = requestedRadius !== undefined && Number.isFinite(requestedRadius) && requestedRadius > WIDENED_RADIUS_KM
    ? requestedRadius : WIDENED_RADIUS_KM;
  const empty: MapNearbyRecommendations = { ...preferences, cards: [], scope: "none", radiusKm, qualifyingWithinWalk: 0 };
  if (!validPoint(options.location.lat, options.location.lng) || preferences.blockedConstraints.length) return empty;
  const candidates: Array<MapNearbyCard & { matchCount: number }> = [];
  // The price callback owns drink selectors and the cap below. Legacy menu gaps must not hide trusted drink evidence.
  const filterInputs = {
    ...preferences.filters,
    maxPrice: Number.POSITIVE_INFINITY,
    drinkCategory: "",
    drinkBrand: "",
    drinkSubtype: "",
  };
  const filtered = filterVenues([...options.venues], filterInputs, options.hasPintDrops, options.openNowState);
  for (const venue of filtered) {
    if (!isPublicRankablePub(venue) || !validPoint(venue.latitude, venue.longitude)) continue;
    const distanceKm = haversineKm([options.location.lng, options.location.lat], [venue.longitude, venue.latitude]);
    if (distanceKm > radiusKm) continue;
    const price = options.priceForVenue(venue, preferences.filters);
    if (!price || !Number.isFinite(price.priceGbp) || price.priceGbp <= 0 || !price.drinkLabel.trim() || (!price.measureLabel.trim() && price.servingKnown !== false)) continue;
    if (preferences.filters.drinkCategory && price.category !== preferences.filters.drinkCategory) continue;
    if (preferences.filters.requireNonAlcoholic && price.category !== "soft-drink" && price.category !== "alcohol-free") continue;
    if (price.category === "beer" && preferences.filters.maxPrice < NO_PINT_PRICE_CAP && price.priceGbp > preferences.filters.maxPrice) continue;
    const reasons = preferenceReasons(venue, options);
    candidates.push({ venue, price, distanceKm, walkMinutes: walkMinutesFromKm(distanceKm), roles: [], reasons, matchCount: reasons.length });
  }
  const walkable = candidates.filter((card) => card.distanceKm <= WALKABLE_RADIUS_KM);
  const widened = candidates.filter((card) => card.distanceKm <= WIDENED_RADIUS_KM);
  const pool = walkable.length ? walkable : widened.length ? widened : candidates;
  if (!pool.length) return empty;
  const byDistance = (a: MapNearbyCard, b: MapNearbyCard) => a.distanceKm - b.distanceKm || a.price.priceGbp - b.price.priceGbp || a.venue.id.localeCompare(b.venue.id);
  const cheapest = [...pool].sort((a, b) => a.price.priceGbp - b.price.priceGbp || byDistance(a, b))[0]!;
  const best = [...pool].sort((a, b) => b.matchCount - a.matchCount || byDistance(a, b))[0]!;
  const toCard = (entry: typeof cheapest, roles: MapNearbyCard["roles"]): MapNearbyCard => ({
    venue: entry.venue, price: entry.price, distanceKm: entry.distanceKm, walkMinutes: entry.walkMinutes,
    roles, reasons: entry.reasons,
  });
  const cards = cheapest.venue.id === best.venue.id
    ? [toCard(cheapest, ["cheapest", "best-match"])]
    : [toCard(cheapest, ["cheapest"]), toCard(best, ["best-match"])];
  return {
    ...preferences, cards,
    radiusKm: pool === walkable ? WALKABLE_RADIUS_KM : pool === widened ? WIDENED_RADIUS_KM : radiusKm,
    scope: pool === walkable ? "walkable" : pool === widened ? "widened" : "farther",
    qualifyingWithinWalk: walkable.length,
  };
}
