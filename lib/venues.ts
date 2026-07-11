import { getVenueCuration, type Provenance, type VenueCuration } from "@/lib/curation";
import { firstHttp } from "@/lib/httpUrl";
import {
  findBrand,
  haystackMatchesBrand,
  haystackMatchesCategory,
  parseDrinkCategoryParam,
} from "@/lib/drinkBrands";
import { hasNonAlcoholic } from "@/lib/nonAlcoholicDrinks";
import { getVenueAccessibility } from "@/lib/venueAccessibilitySeeds";
import {
  matchesAccessibilityFilters,
  type VenueAccessibility,
} from "@/lib/venueAccessibility";
import type { VenueMenuCategoryTile } from "@/lib/venueMenuEnrichment";
import { cuisineTagsForVenue } from "@/lib/cuisineTags";

export type CrawlStyle =
  | "balanced"
  | "cheapest"
  | "heritage"
  | "writerTrail"
  | "beerGarden"
  | "sports"
  | "dateNight";

export type VenuePrice = {
  app_price_id: string;
  pub_name: string;
  pint_name: string;
  price_gbp: number | null;
  price_text: string;
  address: string;
  latitude: number;
  longitude: number;
  boroughs_visible: string;
  boroughs_raw_embedded_non_anomaly: string;
  boroughs_raw_embedded_site_anomaly: string;
  primary_borough: string;
  rank_visible_borough: string;
  estimated_average_price_text: string;
  pub_url: string;
  constructed_pub_url: string;
  borough_urls: string;
  phone_number: string;
  email: string;
  website: string;
  booking_link: string;
  image_url: string;
  description: string;
  comment: string;
  food: string;
  cocktails: string;
  beer_garden: string;
  live_sports: string;
  live_music: string;
  pub_quiz: string;
  darts: string;
  pool: string;
  happy_hour: string;
  karaoke: string;
  cool: string;
  source_datasets: string;
  source_row_count: number;
  has_visible_borough_row: boolean;
  has_raw_embedded_map_row: boolean;
  has_individual_pub_page_row: boolean;
  is_clean_canonical_app_row: boolean;
  data_quality_notes: string;
};

export type Venue = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  primaryBorough: string;
  visibleBoroughs: string[];
  prices: VenuePrice[];
  cheapestPrice: number | null;
  cheapestPint: string;
  averagePrice: number | null;
  // Derived summary signal for map markers, filters and scoring. Lights from an
  // editorial heritage note OR a contributor Pint Drop, so mergeVenueDrops never
  // has to overwrite curation.heritageNote to make a venue read as a story pub.
  hasStory: boolean;
  // Live community-price layer, populated by mergeVenueDrops from the newest
  // organic (non-demo) price drop. `latestContributorPrice` is the override the
  // UI shows in place of the static baseline; `latestContributorAt` is that
  // drop's ISO timestamp so the UI can render freshness (formatFreshness).
  // Both null when no organic price drop exists — the baseline stands alone.
  latestContributorPrice: number | null;
  latestContributorAt: string | null;
  amenities: {
    food: boolean;
    cocktails: boolean;
    beerGarden: boolean;
    liveSports: boolean;
    liveMusic: boolean;
    pubQuiz: boolean;
    darts: boolean;
    pool: boolean;
    happyHour: boolean;
    karaoke: boolean;
    // Derived (not a dataset flag): the pub pours at least one non-alcoholic /
    // 0.0 option (Lucky Saint, Guinness 0.0, "…Alcohol Free 0.5%"…).
    nonAlcoholic: boolean;
  };
  website: string;
  /** First http(s) booking_link from price rows — table booking CTA. */
  bookingLink: string;
  /** Curated menu page URL (detail enrichment overlay). */
  menuUrl?: string;
  /** Curated food-order URL (detail enrichment overlay; never invented). */
  orderUrl?: string;
  /** Curated allergy info URL (detail enrichment overlay). */
  allergyInfoUrl?: string;
  /** Curated food category tiles for the Menu hub (detail enrichment). */
  categoryTiles?: VenueMenuCategoryTile[];
  imageUrl: string;
  description: string;
  dataQualityNotes: string[];
  sourceDatasets: string[];
  curation: VenueCuration;
  // Compact facts carried by the slim map index so URL/query filters can work
  // before the heavy venue detail rows are hydrated.
  filterHints?: VenueFilterHints;
  // Publicly-documented accessible-venue facts (PRD issue #28). Present ONLY for
  // the small curated seed of pubs whose access is documented (see
  // lib/venueAccessibilitySeeds.ts); for every other venue this is undefined —
  // honestly UNKNOWN, never fabricated. See lib/venueAccessibility.ts for the
  // predicates + filter contract (an unknown field FAILS a positive filter).
  accessibility?: VenueAccessibility;
};

export type VenueFilterHints = {
  searchText: string;
  amenities: {
    food: boolean;
    cocktails: boolean;
    beerGarden: boolean;
    liveSports: boolean;
    nonAlcoholic: boolean;
  };
  curation: {
    nearWater: boolean;
    hasStory: boolean;
  };
  canonical: boolean;
  /**
   * True when the venue came from a London chain/guide scrape (Young's,
   * Nicholson's, Greene King, Eating Europe gazetteer). Used for map halos and
   * drink-accent fallbacks — never invents prices.
   */
  scraped?: boolean;
  /**
   * Soft cuisine / plate tags (roast, thai, pizza, …). Optional — absent on
   * most slim rows; when present they are short lowercase tokens for UI chips
   * and Discover "Hungry?" deep-links, never a hard filter gate.
   */
  cuisineTags?: string[];
  // Optional drink-lens hints from the slim index (Wave C). Populated
  // pragmatically from pint names / amenity flags — not a full menu DB.
  drinkCategories?: string[];
  drinkBrands?: string[];
};

export type Filters = {
  query: string;
  maxPrice: number;
  crawlStyle: CrawlStyle;
  stopCount: number;
  routeWindow: number;
  requireBeerGarden: boolean;
  requireNonAlcoholic: boolean;
  requireLiveSports: boolean;
  requireFood: boolean;
  requireCocktails: boolean;
  requireWater: boolean;
  requireHeritage: boolean;
  requirePintDrops: boolean;
  canonicalOnly: boolean;
  // Accessible-venue filters (PRD issue #28). Each, when on, narrows to pubs
  // KNOWN to have that facet — an unknown fact fails the filter (see
  // lib/venueAccessibility.matchesAccessibilityFilters). Off = no-op.
  requireStepFree: boolean;
  requireAccessibleToilet: boolean;
  requireSeatedService: boolean;
  // Drink-lens filters (Wave C / Discover deep-links). Empty string = off.
  // drinkCategory is a DrinkCategory id; drinkBrand is a curated brand id from
  // lib/drinkBrands. Cocktail / low-no still prefer the amenity flags above.
  drinkCategory: string;
  drinkBrand: string;
  // Cuisine-lens filter (food pin lens). A single cuisine tag token (e.g.
  // "pizza", "burger") — when set, all visible pub pins swap to food glyphs
  // for that kind. Empty string = off (falls back to drink pins or, when
  // requireFood is on, per-venue food-kind inference).
  cuisineTag: string;
};

export function truthyFlag(value: string): boolean {
  return ["yes", "true", "y", "1"].includes(String(value).trim().toLowerCase());
}

export function splitList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatPrice(value: number | null): string {
  return typeof value === "number" ? `£${value.toFixed(2)}` : "No price";
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function venueGroupingKey(row: VenuePrice): string {
  return [
    normaliseVenueKeyPart(row.pub_name),
    normaliseVenueKeyPart(row.address),
    row.latitude.toFixed(5),
    row.longitude.toFixed(5),
  ].join("|");
}

export function stableVenueIdFromKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

export function groupVenuePrices(rows: VenuePrice[]): Venue[] {
  const grouped = new Map<string, VenuePrice[]>();
  for (const row of rows) {
    const key = venueGroupingKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return Array.from(grouped.entries()).map(([key, prices]) => {
    const sortedPrices = [...prices].sort((a, b) => {
      const left = a.price_gbp ?? Number.POSITIVE_INFINITY;
      const right = b.price_gbp ?? Number.POSITIVE_INFINITY;
      return left - right;
    });
    const first = sortedPrices[0];
    const numericPrices = sortedPrices
      .map((price) => price.price_gbp)
      .filter((price): price is number => typeof price === "number");
    const sourceDatasets = new Set<string>();
    const dataQualityNotes = new Set<string>();
    for (const price of prices) {
      splitList(price.source_datasets).forEach((source) => sourceDatasets.add(source));
      splitList(price.data_quality_notes).forEach((note) => dataQualityNotes.add(note));
    }

    const curation = getVenueCuration(sortedPrices);
    // Attach documented accessibility facts for the curated seed only; every
    // other venue gets undefined (honestly unknown). Keyed by pub name +
    // borough so a common name doesn't cross-contaminate the wrong pub.
    const accessibility = getVenueAccessibility(first.pub_name, first.primary_borough);

    return {
      id: stableVenueIdFromKey(key),
      name: first.pub_name,
      address: first.address,
      latitude: first.latitude,
      longitude: first.longitude,
      primaryBorough: first.primary_borough,
      visibleBoroughs: splitList(first.boroughs_visible),
      prices: sortedPrices,
      cheapestPrice: numericPrices.length ? Math.min(...numericPrices) : null,
      cheapestPint: first.pint_name,
      averagePrice: numericPrices.length
        ? numericPrices.reduce((sum, price) => sum + price, 0) / numericPrices.length
        : null,
      hasStory: Boolean(curation.heritageNote),
      // No community layer until mergeVenueDrops folds one in.
      latestContributorPrice: null,
      latestContributorAt: null,
      amenities: {
        food: prices.some((price) => truthyFlag(price.food)),
        cocktails: prices.some((price) => truthyFlag(price.cocktails)),
        beerGarden: prices.some((price) => truthyFlag(price.beer_garden)),
        liveSports: prices.some((price) => truthyFlag(price.live_sports)),
        liveMusic: prices.some((price) => truthyFlag(price.live_music)),
        pubQuiz: prices.some((price) => truthyFlag(price.pub_quiz)),
        darts: prices.some((price) => truthyFlag(price.darts)),
        pool: prices.some((price) => truthyFlag(price.pool)),
        happyHour: prices.some((price) => truthyFlag(price.happy_hour)),
        karaoke: prices.some((price) => truthyFlag(price.karaoke)),
        nonAlcoholic: hasNonAlcoholic(prices.map((price) => price.pint_name)),
      },
      website: prices.find((price) => price.website)?.website ?? "",
      bookingLink: firstHttp(...prices.map((price) => price.booking_link)),
      imageUrl: prices.find((price) => price.image_url)?.image_url ?? "",
      description: prices.find((price) => price.description)?.description ?? "",
      dataQualityNotes: Array.from(dataQualityNotes),
      sourceDatasets: Array.from(sourceDatasets),
      curation,
      accessibility,
    };
  });
}

// The minimal drop shape mergeVenueDrops needs — the client DTO satisfies it.
export type SummaryDrop = {
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  provenance: Provenance;
  // ISO timestamp the drop was logged. Carried through so the UI can show how
  // fresh the live community price is ("logged 2h ago") — see formatFreshness.
  createdAt: string;
};

// Honesty note the venue detail can render alongside a community-updated price,
// so a Pint Drop override never reads as an authoritative live feed. Exported as
// a plain constant (no new UI) — the integrator drops it in next to the price.
export const COMMUNITY_PRICE_NOTE =
  "Prices are community-updated — logged by drinkers, not a live feed.";

// Shared relative-age core for freshness labels. Verb differs by layer:
// community drops say "logged", sourced observations say "observed".
// Returns "" for a missing/invalid ISO so the UI can skip the note. Future /
// clock-skew timestamps collapse to "just now" — never a negative age.
function formatAgeLabel(
  iso: string | null | undefined,
  verb: "logged" | "observed",
  now: Date,
): string {
  if (typeof iso !== "string" || iso.length === 0) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffMs = now.getTime() - then;
  if (diffMs < 0) return `${verb} just now`;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return `${verb} just now`;
  if (mins < 60) return `${verb} ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${verb} ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${verb} ${days} ${days === 1 ? "day" : "days"} ago`;
}

// Pure formatter for a community drop timestamp → "logged 2h ago".
// Unit-tested at the boundaries.
export function formatFreshness(iso: string | null | undefined, now: Date = new Date()): string {
  return formatAgeLabel(iso, "logged", now);
}

// Pure formatter for a sourced-price observedAt → "observed 2h ago".
// Same boundaries/guards as formatFreshness; only the verb differs so a
// first-party observation never reads as a community log.
export function formatObservedAt(iso: string | null | undefined, now: Date = new Date()): string {
  return formatAgeLabel(iso, "observed", now);
}

// Fold Pint Drops into the venue's DERIVED SUMMARY SIGNALS only — never into
// the editorial curation note. Rules:
// - an organic contributor price can update cheapestPrice/cheapestPint;
// - hasStory lights ONLY from a drop carrying a passed-down note — a bare
//   price log is not a story and must not boost heritage scoring;
// - "demo" seeds are display-only: they never move prices or story signals,
//   so seeded liveliness never masquerades as organic.
export function mergeVenueDrops<D extends SummaryDrop>(
  venues: Venue[],
  dropsByVenueId: Map<string, D[]>,
): Venue[] {
  if (dropsByVenueId.size === 0) return venues;
  return venues.map((venue) => {
    const organic = (dropsByVenueId.get(venue.id) ?? []).filter(
      (drop) => drop.provenance !== "demo",
    );
    if (organic.length === 0) return venue;

    const latestPriceDrop = organic.find((drop) => typeof drop.priceGbp === "number");
    const contributorPrice = latestPriceDrop?.priceGbp ?? null;
    const cheapestPrice =
      contributorPrice === null
        ? venue.cheapestPrice
        : Math.min(venue.cheapestPrice ?? Number.POSITIVE_INFINITY, contributorPrice);

    return {
      ...venue,
      cheapestPrice,
      cheapestPint: latestPriceDrop?.drink || venue.cheapestPint,
      // Carry the live community price + its logged-at timestamp so the UI can
      // both show the override AND how fresh it is (formatFreshness).
      latestContributorPrice: contributorPrice,
      latestContributorAt: latestPriceDrop?.createdAt ?? null,
      hasStory:
        venue.hasStory || organic.some((drop) => drop.passedDownNote.trim().length > 0),
    };
  });
}

// `hasPintDrops` is a signal derived client-side from live Pint Drops (see
// usePintDrops.venueSignals), so it isn't on the pure Venue. Callers that want
// the requirePintDrops filter pass a lookup; without one it's a no-op predicate.
function hasSlimFlag(venue: Venue, pick: (hints: VenueFilterHints) => boolean): boolean {
  return venue.prices.length === 0 && venue.filterHints ? pick(venue.filterHints) : false;
}

function matchesVenueQuery(venue: Venue, query: string): boolean {
  if (!query) return true;
  const searchableFields = [
    venue.name,
    venue.address,
    venue.cheapestPint,
    venue.primaryBorough,
    ...venue.visibleBoroughs,
    ...venue.prices.map((price) => price.pint_name),
  ];
  if (searchableFields.some((field) => field.toLowerCase().includes(query))) return true;
  return hasSlimFlag(venue, (hints) => hints.searchText.includes(query));
}

function matchesVenueAmenities(venue: Venue, filters: Filters): boolean {
  const checks = [
    [filters.requireBeerGarden, venue.amenities.beerGarden, (hints: VenueFilterHints) => hints.amenities.beerGarden],
    [filters.requireNonAlcoholic, venue.amenities.nonAlcoholic, (hints: VenueFilterHints) => hints.amenities.nonAlcoholic],
    [filters.requireLiveSports, venue.amenities.liveSports, (hints: VenueFilterHints) => hints.amenities.liveSports],
    [filters.requireFood, venue.amenities.food, (hints: VenueFilterHints) => hints.amenities.food],
    [filters.requireCocktails, venue.amenities.cocktails, (hints: VenueFilterHints) => hints.amenities.cocktails],
  ] as const;
  return checks.every(([required, detailedValue, pickHint]) => {
    return !required || detailedValue || hasSlimFlag(venue, pickHint);
  });
}

function matchesVenueCuration(venue: Venue, filters: Filters): boolean {
  const matchesWater =
    !filters.requireWater ||
    Boolean(venue.curation.nearWater) ||
    hasSlimFlag(venue, (hints) => hints.curation.nearWater);
  const matchesHeritage =
    !filters.requireHeritage ||
    venue.hasStory ||
    hasSlimFlag(venue, (hints) => hints.curation.hasStory);
  return matchesWater && matchesHeritage;
}

function matchesCanonicalFilter(venue: Venue, canonicalOnly: boolean): boolean {
  return (
    !canonicalOnly ||
    venue.prices.some((price) => price.is_clean_canonical_app_row) ||
    hasSlimFlag(venue, (hints) => hints.canonical)
  );
}

function venueDrinkHaystack(venue: Venue): string {
  // Intentionally omit venue.name AND filterHints.searchText — the slim index
  // still puts pub_name into searchText for general map query, which would
  // false-positive drink brand matching (e.g. "Gordon" in "The Gordon Arms").
  const parts = [
    venue.cheapestPint,
    venue.description,
    ...venue.prices.map((price) => price.pint_name),
    ...venue.prices.map((price) => price.comment),
    ...venue.prices.map((price) => price.description),
  ];
  return parts.join(" ");
}

function matchesDrinkCategory(venue: Venue, drinkCategory: string): boolean {
  const category = parseDrinkCategoryParam(drinkCategory);
  if (!category) return true;

  const hinted = venue.filterHints?.drinkCategories;
  if (Array.isArray(hinted) && hinted.some((c) => c === category)) return true;

  // Cocktail amenity is a strong positive signal for the cocktail lens.
  if (category === "cocktail") {
    if (venue.amenities.cocktails) return true;
    if (hasSlimFlag(venue, (hints) => hints.amenities.cocktails)) return true;
  }

  // Beer matches like every other category: hints above, else haystack tokens
  // (lager / ale / ipa / …) — never a universal pass on any priced row.
  return haystackMatchesCategory(venueDrinkHaystack(venue), category);
}

function matchesDrinkBrand(venue: Venue, drinkBrand: string): boolean {
  const needle = drinkBrand.trim();
  if (!needle) return true;
  const hit = findBrand(needle);
  // Unknown brand ids must not no-op — treat as no match.
  if (!hit) return false;

  const hinted = venue.filterHints?.drinkBrands;
  if (Array.isArray(hinted) && hinted.includes(hit.brand.id)) return true;

  return haystackMatchesBrand(venueDrinkHaystack(venue), hit.brand);
}

function matchesCuisineTag(venue: Venue, tag: string): boolean {
  const needle = tag.trim().toLowerCase();
  if (!needle) return true;

  // Fast path: slim index carries pre-resolved cuisineTags hints.
  const hinted = venue.filterHints?.cuisineTags;
  if (Array.isArray(hinted) && hinted.includes(needle)) return true;

  // Curated id map + name/searchText — covers full venues and slim pins
  // whose hints omitted a tag the curated map still carries.
  const tags = cuisineTagsForVenue({
    id: venue.id,
    name: venue.name,
    searchText: venue.filterHints?.searchText,
    hintTags: hinted,
  });
  return tags.includes(needle);
}

export function filterVenues(
  venues: Venue[],
  filters: Filters,
  hasPintDrops: (venueId: string) => boolean = () => false,
): Venue[] {
  const query = filters.query.trim().toLowerCase();
  const drinkCategory = filters.drinkCategory?.trim() ?? "";
  const drinkBrand = filters.drinkBrand?.trim() ?? "";
  const cuisineTag = filters.cuisineTag?.trim().toLowerCase() ?? "";
  return venues.filter((venue) => {
    const matchesPrice =
      venue.cheapestPrice === null || venue.cheapestPrice <= filters.maxPrice;

    const matchesPintDrops = !filters.requirePintDrops || hasPintDrops(venue.id);

    // Accessible-venue filters: an unknown fact fails a positive filter, so
    // filtering to step-free shows only pubs KNOWN step-free (never guessed).
    const matchesAccessibility = matchesAccessibilityFilters(venue, {
      stepFree: filters.requireStepFree,
      accessibleToilet: filters.requireAccessibleToilet,
      seatedService: filters.requireSeatedService,
    });

    return (
      matchesVenueQuery(venue, query) &&
      matchesPrice &&
      matchesVenueAmenities(venue, filters) &&
      matchesVenueCuration(venue, filters) &&
      matchesCanonicalFilter(venue, filters.canonicalOnly) &&
      matchesPintDrops &&
      matchesAccessibility &&
      matchesDrinkCategory(venue, drinkCategory) &&
      matchesDrinkBrand(venue, drinkBrand) &&
      matchesCuisineTag(venue, cuisineTag)
    );
  });
}

export function priceColor(price: number | null): string {
  // Warm muted ink for "no price yet" — sits with Candle Coral paper better
  // than cold slate, so gazetteer pins still read as pubs on the map.
  if (price === null) return "#8a7368";
  if (price <= 5.5) return "#138a63";
  if (price <= 7) return "#d28b16";
  return "#c24132";
}

export function distanceKm(a: Venue, b: Venue): number {
  const earthRadiusKm = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function scoreVenue(venue: Venue, style: CrawlStyle): number {
  const price = venue.cheapestPrice ?? 8;
  const cheapness = Math.max(0, 10 - price);
  const amenityScore =
    Number(venue.amenities.beerGarden) * 1.5 +
    Number(venue.amenities.liveSports) +
    Number(venue.amenities.food) +
    Number(venue.amenities.cocktails) +
    Number(venue.amenities.liveMusic) +
    Number(venue.amenities.pubQuiz);
  const hasVenueContext = venue.description.length > 80 ? 1 : 0;
  const hasHeritage = venue.hasStory ? 2.5 : 0;
  const nearWater = venue.curation.nearWater ? 1.5 : 0;
  const writerPick = venue.curation.writerPick ? 5 : 0;
  const sourceTrust = venue.prices.some((priceItem) => priceItem.is_clean_canonical_app_row)
    ? 1
    : 0;

  if (style === "cheapest") return cheapness * 3 + sourceTrust;
  if (style === "beerGarden") return Number(venue.amenities.beerGarden) * 7 + cheapness;
  if (style === "sports") return Number(venue.amenities.liveSports) * 7 + cheapness;
  if (style === "heritage") return hasHeritage * 4 + nearWater * 2 + amenityScore + sourceTrust;
  if (style === "writerTrail") {
    return writerPick * 5 + hasHeritage * 3 + nearWater * 2 + hasVenueContext + cheapness + sourceTrust;
  }
  if (style === "dateNight") {
    return (
      Number(venue.amenities.cocktails) * 2 +
      Number(venue.amenities.food) * 2 +
      Number(venue.amenities.beerGarden) * 2 +
      (hasVenueContext + hasHeritage) * 2 +
      cheapness
    );
  }
  return cheapness * 1.5 + amenityScore + hasVenueContext + hasHeritage + nearWater + sourceTrust;
}

export function buildCrawlRoute(venues: Venue[], filters: Filters): Venue[] {
  if (!venues.length) return [];
  const sorted = [...venues]
    .sort((a, b) => scoreVenue(b, filters.crawlStyle) - scoreVenue(a, filters.crawlStyle))
    .slice(0, 180);
  const maxLegKm = filters.routeWindow <= 15 ? 1.4 : filters.routeWindow <= 20 ? 1.9 : 2.8;

  const candidates = sorted.slice(0, 60).map((seed) => {
    const route: Venue[] = [seed];

    while (route.length < filters.stopCount) {
      const last = route[route.length - 1];
      const localCandidates = sorted
        .filter((venue) => !route.some((selected) => selected.id === venue.id))
        .map((venue) => {
          const distance = distanceKm(last, venue);
          return {
            venue,
            distance,
            score: scoreVenue(venue, filters.crawlStyle) - distance * 2.4,
          };
        })
        .filter((candidate) => candidate.distance <= maxLegKm)
        .sort((a, b) => b.score - a.score);

      const next = localCandidates[0]?.venue;
      if (!next) break;
      route.push(next);
    }

    const summary = crawlSummary(route);
    const routeScore =
      route.reduce((sum, venue) => sum + scoreVenue(venue, filters.crawlStyle), 0) -
      summary.distance * 3 +
      route.length * 4;

    return { route, routeScore };
  });

  return candidates.sort((a, b) => b.routeScore - a.routeScore)[0]?.route ?? [];
}

export function crawlSummary(route: Venue[]): { total: number; average: number; distance: number } {
  const prices = route
    .map((venue) => venue.cheapestPrice)
    .filter((price): price is number => typeof price === "number");
  const total = prices.reduce((sum, price) => sum + price, 0);
  const distance = route.reduce((sum, venue, index) => {
    const next = route[index + 1];
    return next ? sum + distanceKm(venue, next) : sum;
  }, 0);
  return {
    total,
    average: prices.length ? total / prices.length : 0,
    distance,
  };
}
