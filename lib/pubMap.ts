// Pure helpers extracted from components/PubMap.tsx (F1 decomposition).
//
// Server-safe: NO "use client", no window/DOM reads, no React. These live off
// PubMap's complexity budget and are unit-tested in __tests__/pubMap.test.ts.
// seedCrawlState is imported from the pure @/lib/crawlUrl (NOT the client
// @/components/map/useCrawlUrl re-export) so this module never pulls a client
// boundary in.

import { venueGroupingKey, type CrawlMode, type Filters, type Venue } from "@/lib/venues";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import {
  pointInCityBounds,
  type CityConfig,
  type CityId,
  DEFAULT_CITY_ID,
} from "@/lib/cities";
import { CATEGORY_META, type DrinkCategory } from "@/lib/drinks";
import type { CategoryPriceIndexStatus, MapExperienceLens } from "@/lib/mapExperienceLens";
import type { MapOverlay, MapSheetKind, MapViewportSnapshot } from "@/lib/mobileShell";
import { seedCrawlState } from "@/lib/crawlUrl";
import { WALK_ROUTE_MAX_STOPS } from "@/lib/walkRoute";
import { isDrinkShapeArrival } from "@/lib/mapArrival";
import type { CoffeePilotStatus } from "@/lib/coffeePilot";
import type { LondonRestaurantStatus } from "@/lib/londonRestaurants";
import { isLondonVenueId } from "@/lib/londonVenueShards";
import { isUkBaseId } from "@/lib/ukBasePubs";
import type { VenueAliasMaps } from "@/lib/venueAliasMap";
import {
  priceStandingFigure,
  priceStandingFor,
  priceStandingLabel,
} from "@/lib/priceTier";
import {
  pintPriceSplitLine,
  pintPriceSplitRange,
} from "@/lib/pintDropAgreement";
import { PINT_TRUST_LINE, trustChipStateFor, type PintTrustState } from "@/lib/pintTrust";
import {
  AGED_PRICE_LINE,
  PROVISIONAL_PRICE_LINE,
  baselineTrustCaption,
  venuePriceLaneObservedGbp,
  type VenueBundlePrices,
  type VenuePriceLane,
} from "@/lib/venuePriceLane";
import { formatPrice } from "@/lib/venues";
import {
  eagerCuratedCrawlAltStyle,
  eagerCuratedCrawlAltStyleForBuiltIds,
} from "@/lib/curatedCrawlHints";

// §4.5: did the page arrive with any crawl-shaping URL param (a shared/deep
// link)? If any are present the arrival is intentional and we never onboard.
// Module-level (pure) so the branch lives off PubMap's complexity budget.
// `drink=` counts (landing drink-shape taps) but is NOT a planner-open signal.
export function hasCrawlArrivalParams(search: string): boolean {
  // Intentional deep links (landmark/band/food/log/etc.) must also suppress
  // curated onboarding — not only crawl planner params (#79 follow-up).
  return /[?&](pubs|sel|style|mode|q|drink|cocktails|landmark|band|food|max|alt|log|crawl|experience|mapNotice)=/.test(
    search,
  );
}

// Issue #15: normalise a landmark's nearest-pub ids into crawl stops — drop
// blanks, cap at three. Module-level (pure) so the branch lives outside the
// PubMap component body and off its complexity budget.
export function crawlStopsFromPubIds(ids: string[]): string[] {
  return ids.filter(Boolean).slice(0, 3);
}

// Issue #31: fold a curated crawl's style choices onto the current filters. A
// mocktail crawl composes with the non-alcoholic filter — the honest, minimal
// way an alt style touches the actual route. Module-level (pure) so the branch
// lives off PubMap's complexity budget.
export function filtersForCuratedCrawl(current: Filters, crawl: CuratedCrawl): Filters {
  return {
    ...filtersForCuratedCrawlHint(current, crawl.altStyle),
    crawlStyle: crawl.crawlStyle,
  };
}

function filtersForCuratedCrawlHint(
  current: Filters,
  altStyle: CuratedCrawl["altStyle"],
): Filters {
  return {
    ...current,
    requireNonAlcoholic: altStyle === "mocktail" ? true : current.requireNonAlcoholic,
  };
}

export type MapSeed = ReturnType<typeof seedCrawlState> & {
  activeCrawl: CuratedCrawl | null;
  routeMapped: boolean;
};

/**
 * One-shot eager map-shell seed from the shareable URL only. No curated crawl
 * catalog is loaded here; crawl-shaped arrivals hydrate via
 * @/lib/mapSeedCrawl after the catalog chunk loads. Do NOT resurrect a previous
 * hand-built crawl from localStorage on a clean /map tab click - that bloated
 * the address bar with stale ?pubs=… (PR #79).
 */
export function buildMapSeed(search: string, _cityId: CityId = DEFAULT_CITY_ID): MapSeed {
  void _cityId;
  const seeded = seedCrawlState(search);
  if (isDrinkShapeArrival(search)) {
    return { ...seeded, activeCrawl: null, routeMapped: false };
  }
  const hintedAltStyle =
    eagerCuratedCrawlAltStyle(seeded.crawlId) ??
    eagerCuratedCrawlAltStyleForBuiltIds(seeded.builtIds);
  return {
    ...seeded,
    filters: filtersForCuratedCrawlHint(seeded.filters, hintedAltStyle),
    altStyle: hintedAltStyle ?? seeded.altStyle,
    activeCrawl: null,
    routeMapped: seeded.builtIds.length >= 2,
  };
}

/**
 * The built stops a shared plan still owes a detail request.
 *
 * Nothing is owed until the slim pack has settled: before that every id misses
 * `venueById`, so an unready map would request the whole plan over the same
 * origin that is fetching the pack and the first tiles, and the pack would then
 * answer for the same pubs a second later. An id already asked for is never
 * asked again, and the plan's own ceiling bounds one arrival's requests.
 */
export function builtStopsNeedingHydration({
  venueDataReady,
  builtIds,
  venueById,
  askedIds,
}: {
  venueDataReady: boolean;
  builtIds: readonly string[];
  venueById: ReadonlyMap<string, Venue>;
  askedIds: ReadonlySet<string>;
}): string[] {
  if (!venueDataReady) return [];
  return builtIds
    .slice(0, WALK_ROUTE_MAX_STOPS)
    .filter((id) => Boolean(id) && !venueById.has(id) && !askedIds.has(id));
}

export type BuiltStopHydrationResult = {
  id: string;
  status: "found" | "missing" | "failed";
};

/**
 * The stops a mounted map counts as asked once an answer lands.
 *
 * Every requested id stays asked, whatever the answer. A stop the request could
 * not answer for waits for the reader to open it (the selected-venue path) or
 * for the next cold arrival: releasing it here would re-ask the whole plan on
 * the next shard commit, because the venue set is rebuilt on every one.
 */
export function builtStopsAskedAfter(
  askedIds: ReadonlySet<string>,
  results: readonly BuiltStopHydrationResult[],
): Set<string> {
  const next = new Set(askedIds);
  for (const { id } of results) next.add(id);
  return next;
}

export type VenueDetailStatus = "idle" | "loading" | "ready" | "missing" | "unavailable" | "retired";

export function detailStatusFor(
  selectedVenueId: string,
  detailById: Map<string, Venue>,
  detailStatusById: Map<string, VenueDetailStatus>,
): VenueDetailStatus {
  if (!selectedVenueId) return "idle";
  const detail = detailById.get(selectedVenueId);
  if (detail) return detail.retired ? "retired" : "ready";
  return detailStatusById.get(selectedVenueId) ?? "loading";
}

/** The name a selected retired pub's notice prints, or null when the selection is not one. */
export function retiredSelectionNameFor(
  selectedVenueId: string,
  detailById: Map<string, Venue>,
): string | null {
  const detail = detailById.get(selectedVenueId);
  return detail?.retired ? detail.name : null;
}

export type MapSelectionNotice = "unknown" | "lookup-failed" | "retired";

export const MAP_SELECTION_NOTICE_PARAM = "mapNotice";

export function mapSelectionNoticeFromSearch(search: string): MapSelectionNotice | null {
  const value = new URLSearchParams(search).get(MAP_SELECTION_NOTICE_PARAM);
  return value === "unknown" || value === "lookup-failed" ? value : null;
}

export function mapSelectionNotice(input: {
  loaded: boolean;
  selectedVenueId: string;
  resolvable: boolean;
  ukBase: boolean;
  detailStatus: VenueDetailStatus;
}): MapSelectionNotice | null {
  if (!input.loaded || !input.selectedVenueId || input.ukBase || input.resolvable) return null;
  if (input.detailStatus === "missing") return "unknown";
  if (input.detailStatus === "unavailable") return "lookup-failed";
  if (input.detailStatus === "retired") return "retired";
  return null;
}

/** Visible copy for an unknown `?sel=` - empty-state voice, no plumbing. */
export const UNKNOWN_MAP_SELECTION_NOTE = "That pub is not one we know.";
export const MAP_SELECTION_LOOKUP_FAILED_NOTE = "We could not check that pub right now.";

/**
 * Visible copy for a `?sel=` naming a pub that left OpenStreetMap. A saved pub,
 * a drop or a crawl stop links here, so the link lands on what we know.
 */
function retiredMapSelectionNote(name: string): string {
  return `${name} is no longer on the map. It may have closed.`;
}

/** The copy a selection notice prints. */
export function mapSelectionNoticeCopy(notice: MapSelectionNotice, retiredName: string | null): string {
  if (notice === "unknown") return UNKNOWN_MAP_SELECTION_NOTE;
  if (notice === "retired" && retiredName) return retiredMapSelectionNote(retiredName);
  return MAP_SELECTION_LOOKUP_FAILED_NOTE;
}

export function venueUpdateKey(venue: Venue): string {
  const firstPrice = venue.prices[0];
  return firstPrice ? venueGroupingKey(firstPrice) : venue.id;
}

export function normaliseTonightVenueLookup(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ── PubMap body derivations (issue #1185) ────────────────────────────────────
// The same expressions the component used to evaluate inline, moved verbatim
// behind a name. Nothing here decides anything new. They live in this module
// for the reason the helpers above do: a 300-branch render function cannot be
// reviewed, and a named derivation can.
//
// A few of PubMap's derivations deliberately did NOT move. Source-lock tests
// read components/PubMap.tsx and assert on its text (see
// __tests__/ukPlaceMapArrival.test.ts and __tests__/mapExperienceLensUi.test.ts),
// so those stay module-scope helpers in the component file and the pins keep
// reading the surface they were written about.

/** `MapSurfaceId` restated structurally so this module imports no component. */
export type PubMapSurfaceId = MapOverlay | "venue-list";

/**
 * What the arrival froze, answered once.
 *
 * The frozen search, the place arrival and the national-browse flag are all read
 * at mount and never change, so every answer derived from them is frozen too.
 */
export type MapArrivalFrame = {
  /** No frozen search, no place arrival, no national browse: we may ask for a fix. */
  needsOpeningResolution: boolean;
  /** London's own surfaces (Tonight lane, city status) only light up here. */
  isLondon: boolean;
  /** What the search field invites. */
  searchPlaceholder: string;
  /** The uncovered place's own name, printed as our copy. Undefined off that lane. */
  placeName: string | undefined;
  /** An uncovered place or a national browse: curated venues and localities stand down. */
  limitedCoverage: boolean;
};

export function mapArrivalFrame(input: {
  search: string;
  placeArrival: { name: string } | null | undefined;
  nationalBrowse: boolean;
  cityId: CityId;
  cityDisplayName: string;
}): MapArrivalFrame {
  const { search, placeArrival, nationalBrowse, cityId, cityDisplayName } = input;
  const hasPlaceArrival = Boolean(placeArrival);
  return {
    needsOpeningResolution: !search && !hasPlaceArrival && !nationalBrowse,
    isLondon: cityId === "london" && !hasPlaceArrival && !nationalBrowse,
    searchPlaceholder: hasPlaceArrival
      ? "Search priced pub names"
      : nationalBrowse
        ? "Search pubs or UK places"
        : `Search ${cityDisplayName} venues or areas`,
    placeName: placeArrival ? placeArrival.name : undefined,
    limitedCoverage: hasPlaceArrival || nationalBrowse,
  };
}

/**
 * May the map ask the browser where the reader is?
 *
 * Only on a clean arrival with nothing already saying where to open. A resume
 * snapshot or a restored viewport is an answer we already hold, and asking over
 * one spends a permission prompt on a camera move nobody needs.
 */
export function shouldResolveOpeningLocation(input: {
  needsOpeningResolution: boolean;
  mapResumeSeed: unknown;
  restoredMobileSession: RestoredSessionLike<string>;
}): boolean {
  return (
    input.needsOpeningResolution &&
    !input.mapResumeSeed &&
    !input.restoredMobileSession?.viewport
  );
}

/** The ambient banners are an opening offer, so they step off once the reader drives. */
export function ambientBannerLaneOpen(
  mobileViewport: boolean,
  mapCameraTouched: boolean,
): boolean {
  return !mobileViewport && !mapCameraTouched;
}

/**
 * The place the map is OVER, and whether that place is off the curated city.
 *
 * `outsideCuratedBounds` is a claim about the SETTLED camera, so a viewport
 * that has not settled is outside nothing. The centre alone cannot answer that:
 * the map is seeded with an opening centre before it has drawn anything, and
 * MapLibre then reports its own maxBounds until the camera settles, so a plain
 * London open painted "Outside the priced city map" for 334 ms about two
 * seconds in. That is the law `mapBounds` already carries in
 * components/PubMap.tsx - a map that has not settled claims no place - and it
 * is why an unsettled viewport is read here exactly as an absent centre.
 * `baseLedChrome` is the one answer the chrome branches on: an uncovered place,
 * an explicit national browse, or a pan past the city's own bounds all mean the
 * base layer is leading.
 */
export type MapPlaceContext = {
  mapContextName: string;
  outsideCuratedBounds: boolean;
  baseLedChrome: boolean;
};

export function mapPlaceContext(input: {
  placeArrivalName: string | undefined;
  nationalBrowse: boolean;
  center: readonly [number, number] | null | undefined;
  city: CityConfig;
  /** Whether the camera has settled at least once. Defaults to true so a caller
   *  that knows nothing about settling keeps the answer it had. */
  viewportSettled?: boolean;
}): MapPlaceContext {
  const { placeArrivalName, nationalBrowse, center, city, viewportSettled = true } = input;
  const settledCentre = viewportSettled ? center : null;
  const insideCity = Boolean(
    settledCentre && pointInCityBounds(settledCentre[1], settledCentre[0], city),
  );
  const mapContextName =
    placeArrivalName ??
    (nationalBrowse ? "UK" : !settledCentre || insideCity ? city.displayName : "UK");
  const outsideCuratedBounds =
    !placeArrivalName && !nationalBrowse && Boolean(settledCentre && !insideCity);
  return {
    mapContextName,
    outsideCuratedBounds,
    baseLedChrome: Boolean(placeArrivalName || nationalBrowse || outsideCuratedBounds),
  };
}

/**
 * Which drink the map is under.
 *
 * `other` is submittable but never lensable, so it selects no map lens: its pins
 * would print a figure labelled with a name that identifies no drink. Beer is
 * the lane the map RESTS in, so it is never a selected lens either. An
 * experience view owns the map instead and stands the drink refinements down,
 * so the lane reads as the resting pint lane rather than naming a drink the
 * pins are not showing.
 */
export type MapDrinkLensSelection = {
  selectedDrinkCategory: DrinkCategory | null;
  mapDrinkLensCategory: DrinkCategory | null;
  activeMapDrinkLane: DrinkCategory;
};

export function mapDrinkLensSelection(input: {
  drinkCategory: Filters["drinkCategory"];
  experienceLens: MapExperienceLens;
  isMapLensDrinkCategory: (value: Filters["drinkCategory"]) => boolean;
  activeDrinkLane: (value: Filters["drinkCategory"]) => DrinkCategory;
  defaultDrinkLane: DrinkCategory;
}): MapDrinkLensSelection {
  const {
    drinkCategory,
    experienceLens,
    isMapLensDrinkCategory,
    activeDrinkLane,
    defaultDrinkLane,
  } = input;
  const selectedDrinkCategory: DrinkCategory | null = isMapLensDrinkCategory(drinkCategory)
    ? (drinkCategory as DrinkCategory)
    : null;
  return {
    selectedDrinkCategory,
    mapDrinkLensCategory:
      experienceLens === "all" &&
      selectedDrinkCategory !== null &&
      selectedDrinkCategory !== "beer"
        ? selectedDrinkCategory
        : null,
    activeMapDrinkLane:
      experienceLens === "all" ? activeDrinkLane(drinkCategory) : defaultDrinkLane,
  };
}

/**
 * Whichever cross-venue index is answering the map right now reports its own
 * completeness, so the price key never claims a read it did not finish.
 */
export function drinkIndexStatusFor(
  mapDrinkLensCategory: DrinkCategory | null,
  experienceLens: MapExperienceLens,
  drinkCategoryIndexStatus: ReadonlyMap<DrinkCategory, CategoryPriceIndexStatus>,
  noAlcoholIndexStatus: CategoryPriceIndexStatus,
): CategoryPriceIndexStatus {
  if (mapDrinkLensCategory) {
    return drinkCategoryIndexStatus.get(mapDrinkLensCategory) ?? "idle";
  }
  return experienceLens === "no-alcohol" ? noAlcoholIndexStatus : "ready";
}

/** The name a lens HEADING wears. Its sentence noun is a separate answer. */
export function activeLensLabelFor(
  mapDrinkLensCategory: DrinkCategory | null,
  experienceLens: MapExperienceLens,
): string | null {
  return mapDrinkLensCategory
    ? CATEGORY_META[mapDrinkLensCategory].label
    : experienceLens === "no-alcohol"
      ? "No-alcohol"
      : experienceLens === "food"
        ? "Food"
        : null;
}

/** Has the reader narrowed the map to a drink, in any of the six ways? */
export function drinkFiltersActiveFor(input: {
  favoritePint: string | null;
  drinkCategory: string;
  drinkBrand: string;
  drinkSubtype: string;
  topShelfOnly: boolean;
  requireCocktails: boolean;
}): boolean {
  return Boolean(
    input.favoritePint ||
      input.drinkCategory ||
      input.drinkBrand ||
      input.drinkSubtype ||
      input.topShelfOnly ||
      input.requireCocktails,
  );
}

/**
 * The one overlay the phone shell is showing.
 *
 * The Drop picker, the venue sheet and the planner each own the surface
 * outright while they are up, so they answer ahead of whatever chip the reader
 * last opened.
 */
export function coordinatedMapOverlay(input: {
  logIntentFallbackVisible: boolean;
  detailOpen: boolean;
  planningOpen: boolean;
  /**
   * The landmark story is a surface the reader is ON, so it answers here like
   * the venue and the planner do: it hides the phone's "Describe the outing"
   * pill (which used to paint under the opaque story sheet) and it enters the
   * Back trail, so a pub opened from the story has the story as its parent.
   * A venue pick still retires the story on screen; the trail keeps it.
   */
  storyOpen?: boolean;
  mapOverlay: MapOverlay;
}): MapOverlay {
  return input.logIntentFallbackVisible
    ? "moment"
    : input.detailOpen
      ? "venue"
      : input.planningOpen
        ? "planner"
        : input.storyOpen
          ? "landmark"
          : input.mapOverlay;
}

/** Where the reader IS, for the Back/Home trail. List view is a surface too. */
export function mapSurfaceIdFor(
  coordinatedMobileOverlay: MapOverlay,
  mapListOpen: boolean,
): PubMapSurfaceId {
  return coordinatedMobileOverlay !== "none"
    ? coordinatedMobileOverlay
    : mapListOpen
      ? "venue-list"
      : "none";
}

/**
 * What that surface is CALLED.
 *
 * Search is an inline row, not a sheet, so it has no entry in the sheet-title
 * table. It is still a place a reader can be, and a Back that offered to return
 * them to "Map controls" would name a surface they never opened.
 */
export function mapSurfaceTitleFor(input: {
  mapSurfaceId: PubMapSurfaceId;
  basePubOpen: boolean;
  basePub: { name: string } | null | undefined;
  selectedVenue: { name: string } | null | undefined;
  detailLabel: string;
  /** The open landmark's name: the story's one heading, and the Back label. */
  landmarkName?: string | null;
  sheetTitles: Partial<Record<MapSheetKind, string>>;
}): string {
  const { mapSurfaceId, basePubOpen, basePub, selectedVenue, detailLabel } = input;
  if (mapSurfaceId === "venue") {
    return basePubOpen ? basePub?.name ?? "Pub detail" : selectedVenue?.name ?? detailLabel;
  }
  if (mapSurfaceId === "planner") return "Plan an outing";
  if (mapSurfaceId === "landmark") return input.landmarkName ?? "Landmark";
  if (mapSurfaceId === "venue-list") return "List view";
  if (mapSurfaceId === "search") return "Search";
  return input.sheetTitles[mapSurfaceId as MapSheetKind] ?? "Map controls";
}

/**
 * The venue sheet's entrance overshoot.
 *
 * Only the full cinematic form overshoots, only while it is still running, and
 * only for the venue it was minted for: a reveal left over from the previous
 * pick must not bounce the sheet the reader just opened.
 */
export function venueEntranceOvershootFor(input: {
  entranceActive: boolean;
  reveal: { form: string; interrupted: boolean; venueId: string } | null;
  selectedVenueId: string;
}): boolean {
  const { reveal } = input;
  return (
    input.entranceActive &&
    reveal?.form === "full" &&
    !reveal.interrupted &&
    reveal.venueId === input.selectedVenueId
  );
}

/**
 * The class list the map shell wears. Each marker is read by one CSS lane.
 *
 * `sheet-full` hides the floating map chrome when either mobile sheet is at its
 * most-expanded snap. Peek and half keep the map usable, so the chrome stays
 * visible above the sheet.
 */
export function mapShellClassName(input: {
  planningOpen: boolean;
  detailOpen: boolean;
  /**
   * The landmark story is in the LEFT drawer, the planner's frame, so the
   * toolbar and banners read this the way they read `planning-open`
   * (mapToolbar.css, mapBannerStaging.css). Never true while the planner or a
   * venue is open: those own their frames and the story waits.
   */
  storyOpen?: boolean;
  sheetSnap: string;
  plannerSheetSnap: string;
  routeMappedActive: boolean;
  mobileViewport: boolean;
  showOnboarding: boolean;
}): string {
  const {
    planningOpen,
    detailOpen,
    storyOpen = false,
    sheetSnap,
    plannerSheetSnap,
    routeMappedActive,
    mobileViewport,
    showOnboarding,
  } = input;
  const sheetFull =
    (detailOpen && sheetSnap === "full") || (planningOpen && plannerSheetSnap === "full");
  return (
    "appShell dark" +
    (planningOpen ? " planning-open" : "") +
    (detailOpen ? " detail-open" : "") +
    (storyOpen ? " story-open" : "") +
    (sheetFull ? " sheet-full" : "") +
    (routeMappedActive ? " route-mapped" : "") +
    (!mobileViewport && showOnboarding ? " onboarding-open" : "")
  );
}

/** The first id in a list, or "" when the list is empty. */
export function firstIdOf(rows: readonly { id: string }[]): string {
  return rows[0]?.id ?? "";
}

/** A search param's value, or "" when there is no param and no reader. */
export function searchParamValue(
  params: { get: (key: string) => string | null } | null | undefined,
  key: string,
): string {
  return params?.get(key) ?? "";
}

/**
 * Which price map a lens paints from.
 *
 * The resting pint map takes the drink-lane prices; an experience view brings
 * its own, because it answers a different question about the same pubs.
 */
export function activeLensPricesFor<Prices>(
  experienceLens: MapExperienceLens,
  drinkLensPrices: Prices | null,
  experienceLensPrices: Prices | null,
): Prices | null {
  return experienceLens === "all" ? drinkLensPrices : experienceLensPrices;
}

/**
 * Which question the price key is answering.
 *
 * THE KEY FOLLOWS WHAT THE PINS ARE PAINTED BY, in the order the pins are
 * painted in. `pinBucketAndTag` (components/map/canvas/geojson.ts) asks the
 * Spoons value lane FIRST and returns, so the key asks it first too: with a
 * drink lane also chosen, the pins are units and a wine price key beside them
 * would be a second answer to one question.
 *
 * Food never colours the map, so it is its own kind. A drink lens only earns
 * the drink key once it has BOTH a heading and a sentence noun, because the key
 * prints both and a half-named lens would print a gap.
 */
export function priceLegendInput<RenderedState>(input: {
  experienceLens: MapExperienceLens;
  activeLensLabel: string | null;
  activeLensNoun: string | null;
  drinkIndexStatus: CategoryPriceIndexStatus;
  renderedMapState: RenderedState;
  /** The Spoons value lane, or null when that lens does not own the map. */
  spoonsValueLane?: { modalMilliunits: number | null } | null;
}):
  | { kind: "food"; renderedState: RenderedState }
  | {
      kind: "drink";
      label: string;
      noun: string;
      status: CategoryPriceIndexStatus;
      renderedState: RenderedState;
    }
  | {
      kind: "spoons";
      modalMilliunits: number;
      renderedState: RenderedState;
    }
  | { kind: "default"; renderedState: RenderedState } {
  const { experienceLens, activeLensLabel, activeLensNoun, renderedMapState } = input;
  const spoonsModal = input.spoonsValueLane?.modalMilliunits ?? null;
  // A lane with no threshold cut no bands, so it painted nothing and has no key
  // to print: that is the loading, empty and unavailable states, which the
  // lens's own control words for itself.
  if (typeof spoonsModal === "number" && spoonsModal > 0) {
    return {
      kind: "spoons",
      modalMilliunits: spoonsModal,
      renderedState: renderedMapState,
    };
  }
  if (experienceLens === "food") return { kind: "food", renderedState: renderedMapState };
  if (activeLensLabel && activeLensNoun) {
    return {
      kind: "drink",
      label: activeLensLabel,
      noun: activeLensNoun,
      status: input.drinkIndexStatus,
      renderedState: renderedMapState,
    };
  }
  return { kind: "default", renderedState: renderedMapState };
}

/** A `log=` arrival still armed: the URL asks for it and the reader has not left it. */
export function reactiveLogIntentActive(
  hasLogIntentParam: boolean,
  logIntentCleared: boolean,
): boolean {
  return hasLogIntentParam && !logIntentCleared;
}

/**
 * Is a suggested crawl worth building?
 *
 * A Drop arrival is asking to log a price, not to be handed a route, so the
 * suggestion waits until the reader opens the planner or maps one themselves.
 */
export function suggestedRouteWanted(input: {
  hasReactiveLogIntent: boolean;
  planningOpen: boolean;
  routeMapped: boolean;
}): boolean {
  return !input.hasReactiveLogIntent || input.planningOpen || input.routeMapped;
}

/**
 * What a restored phone session and a resume snapshot seed the map with.
 *
 * Every field here is a lazy `useState` initialiser: read once at mount and
 * ignored on every later render. They were seven separate optional-read chains
 * spread down the component; together they are one idea - what this arrival
 * already knows - so they answer in one place.
 */
export type RestoredSessionLike<NightAreaSlug extends string = string> = {
  selectedVenueId?: string | null;
  filters?: Filters;
  nightArea?: NightAreaSlug | null;
  openSheet?: string | null;
  viewport?: MapViewportSnapshot | null;
} | null | undefined;

export type RestoredSessionFrame<NightAreaSlug extends string = string> = {
  loadedCityId: CityId | null;
  resumeViewport: MapViewportSnapshot | null;
  selectedVenueId: string;
  filters: Filters;
  landmarkId: string;
  nightArea: NightAreaSlug | null;
  /** The phone left the planner open, or the URL asks for it. Never over a picked pub. */
  plannerOpen: boolean;
};

export function restoredSessionFrame<NightAreaSlug extends string = string>(input: {
  seed: MapSeed;
  restoredSession: RestoredSessionLike<NightAreaSlug>;
  resumeSeed: { viewport?: MapViewportSnapshot | null } | null | undefined;
  cityId: CityId;
  search: string;
  shouldOpenPlanningInitially: (
    builtIds: string[],
    mode: MapSeed["mode"],
    search: string,
  ) => boolean;
}): RestoredSessionFrame<NightAreaSlug> {
  const { seed, restoredSession, resumeSeed, cityId, search } = input;
  return {
    loadedCityId: resumeSeed ? cityId : null,
    resumeViewport: resumeSeed?.viewport ?? null,
    selectedVenueId: seed.selectedVenueId || restoredSession?.selectedVenueId || "",
    filters: restoredSession?.filters ?? seed.filters,
    landmarkId: seed.landmarkId ?? "",
    nightArea: restoredSession?.nightArea ?? null,
    plannerOpen:
      !seed.selectedVenueId &&
      restoredSession?.openSheet !== "venue" &&
      (restoredSession?.openSheet === "planner" ||
        input.shouldOpenPlanningInitially(seed.builtIds, seed.mode, search)),
  };
}

/** The viewport the map opens on: a resume snapshot, else a restored session, else none. */
export function openingViewportFrom(
  resumeViewport: MapViewportSnapshot | null,
  restoredSession: RestoredSessionLike<string>,
): MapViewportSnapshot | null {
  return resumeViewport ?? restoredSession?.viewport ?? null;
}

/**
 * A map selection with no `/api/venue/[id]` record: a UK base pub or a London
 * venue-layer place such as a Shoreditch pilot cafe or a London restaurant. The map hands its sheet
 * the record it already holds, so fetching, prefetching or reporting the id as
 * unknown would be a certain 404 worded as a missing pub.
 */
export function isRecordlessMapSelection(id: string): boolean {
  return isUkBaseId(id) || isLondonVenueId(id);
}

export type UkBaseSelectionSuccessor =
  | { kind: "curated"; venueId: string }
  | { kind: "retired"; name: string };

/**
 * What a dropped UK base id opens instead of a base pin, or null when the base
 * layer answers it (a live id, or one re-mapped to another base id). A row a
 * still-listed curated venue owned opens that venue; a pub that left the map
 * opens the notice that it may have closed.
 */
export function ukBaseSelectionSuccessor(
  maps: VenueAliasMaps,
  id: string,
): UkBaseSelectionSuccessor | null {
  if (!isUkBaseId(id)) return null;
  const current = maps.aliases.get(id) ?? id;
  if (!isUkBaseId(current)) return { kind: "curated", venueId: current };
  const name = maps.retiredNames.get(current);
  return name ? { kind: "retired", name } : null;
}

/** How far a London venue-layer source has got with its read. */
type LondonLayerReadStatus = "idle" | "loading" | "ready" | "failed";

/**
 * The place one London venue-layer source opens for a selection, and whether
 * that source would let the selection go. A source opens a place only while it
 * is shown. A `venue-osm-` id it cannot place once its read has settled has no
 * sheet to open from it.
 */
function londonLayerPick<Item>(input: {
  shown: boolean;
  selectedVenueId: string;
  status: LondonLayerReadStatus;
  byId: ReadonlyMap<string, Item>;
}): { item: Item | null; release: boolean } {
  if (!isLondonVenueId(input.selectedVenueId)) return { item: null, release: false };
  const item = input.shown ? input.byId.get(input.selectedVenueId) ?? null : null;
  const settled = input.status === "ready" || input.status === "failed";
  return { item, release: !item && (!input.shown || settled) };
}

/**
 * The Shoreditch pilot cafe a selection opens, and whether the selection should
 * be let go. A cafe opens only while the coffee lens is on, so leaving the lens
 * closes its sheet and the pint map stays the pint map. A `venue-osm-` id the
 * pilot cannot place once its read has settled has no sheet to open either.
 *
 * `release` speaks for the pilot alone. A `venue-osm-` id may also be a London
 * restaurant, so the map reads both through `londonVenueSelection`.
 */
export function coffeePilotSelection<Cafe>(input: {
  lensOn: boolean;
  selectedVenueId: string;
  status: CoffeePilotStatus;
  byId: ReadonlyMap<string, Cafe>;
}): { cafe: Cafe | null; release: boolean } {
  const pick = londonLayerPick({ ...input, shown: input.lensOn });
  return { cafe: pick.item, release: pick.release };
}

/**
 * The London restaurant a selection opens (lib/londonRestaurants.ts), and
 * whether the restaurant layer would let the selection go. A restaurant opens
 * only while its layer is shown, so hiding restaurants in the kind filter, or
 * a view that takes the layer off the map, closes its sheet.
 */
export function londonRestaurantSelection<Restaurant>(input: {
  shown: boolean;
  selectedVenueId: string;
  status: LondonRestaurantStatus;
  byId: ReadonlyMap<string, Restaurant>;
}): { restaurant: Restaurant | null; release: boolean } {
  const pick = londonLayerPick(input);
  return { restaurant: pick.item, release: pick.release };
}

/**
 * The London venue-layer place a `venue-osm-` selection opens: a pilot cafe or
 * a restaurant. The selection is let go only when EVERY London source would
 * let it go, because an id one source cannot place may be the other's. An id
 * the pilot already places is a cafe, so the restaurant read never holds it.
 */
export function londonVenueSelection<Cafe, Restaurant>(input: {
  selectedVenueId: string;
  coffee: { lensOn: boolean; status: CoffeePilotStatus; byId: ReadonlyMap<string, Cafe> };
  restaurants: {
    shown: boolean;
    status: LondonRestaurantStatus;
    byId: ReadonlyMap<string, Restaurant>;
  };
}): { cafe: Cafe | null; restaurant: Restaurant | null; release: boolean } {
  const coffee = coffeePilotSelection({ ...input.coffee, selectedVenueId: input.selectedVenueId });
  const restaurants = londonRestaurantSelection({
    ...input.restaurants,
    selectedVenueId: input.selectedVenueId,
  });
  const knownCafe = input.coffee.byId.has(input.selectedVenueId);
  return {
    cafe: coffee.cafe,
    restaurant: restaurants.restaurant,
    release: coffee.release && (knownCafe || restaurants.release),
  };
}

/**
 * What is selected, and what that means for the sheet.
 *
 * A curated pin, a tapped UK base pub, a coffee pilot cafe and a London
 * restaurant fill the SAME drawer, so every open/close/snap path stays one path and these answers stay
 * one read.
 * A deep-linked `sel=` before the slim index resolves still counts as detail
 * open (`pendingDeepLinkSelection`) so the venue skeleton can mount while the
 * shard loads.
 */
export type MapSelectionFrame = {
  selectedId: string | undefined;
  resolvable: boolean;
  isPub: boolean;
  basePubOpen: boolean;
  coffeeCafeOpen: boolean;
  londonRestaurantOpen: boolean;
  detailOpen: boolean;
};

export function mapSelectionFrame(input: {
  selectedVenueId: string;
  selectedVenue: Venue | undefined;
  selectedBasePub: { id: string } | null;
  /** The pilot cafe the selected id resolved to, once the cafes have loaded. */
  selectedCoffeeCafe?: { id: string } | null;
  /** The London restaurant the selected id resolved to, once the pack has loaded. */
  selectedLondonRestaurant?: { id: string } | null;
  venueById: ReadonlyMap<string, Venue>;
  isPubVenue: (venue: Venue) => boolean;
}): MapSelectionFrame {
  const { selectedVenueId, selectedVenue, selectedBasePub, venueById } = input;
  const basePubOpen = Boolean(selectedBasePub && selectedBasePub.id === selectedVenueId);
  const coffeeCafeOpen = Boolean(
    input.selectedCoffeeCafe && input.selectedCoffeeCafe.id === selectedVenueId,
  );
  const londonRestaurantOpen = Boolean(
    input.selectedLondonRestaurant && input.selectedLondonRestaurant.id === selectedVenueId,
  );
  const pendingDeepLinkSelection =
    Boolean(selectedVenueId) &&
    !selectedVenue &&
    !basePubOpen &&
    !coffeeCafeOpen &&
    !londonRestaurantOpen &&
    !venueById.has(selectedVenueId);
  return {
    selectedId: selectedVenue?.id,
    resolvable: selectedVenueId ? venueById.has(selectedVenueId) : false,
    isPub: selectedVenue ? input.isPubVenue(selectedVenue) : false,
    basePubOpen,
    coffeeCafeOpen,
    londonRestaurantOpen,
    detailOpen:
      Boolean(selectedVenueId && selectedVenue) ||
      basePubOpen ||
      coffeeCafeOpen ||
      londonRestaurantOpen ||
      pendingDeepLinkSelection,
  };
}

/** The settled bounds, but only once they belong to the city on screen. */
export function settledBoundsFor<Bounds>(
  mapBounds: Bounds | null,
  settledCityId: CityId | null,
  cityId: CityId,
): Bounds | null {
  return mapBounds !== null && settledCityId === cityId ? mapBounds : null;
}

/**
 * A deep-linked Tonight kind, until the reader collapses the lane it opened.
 *
 * Once they close it, the same `?src=` must not force it back open.
 */
export function tonightLaneKindFor<Kind>(
  deepLinkKind: Kind | null,
  srcParam: string,
  dismissedSrc: string | null,
): Kind | null {
  return deepLinkKind && srcParam !== dismissedSrc ? deepLinkKind : null;
}

/** TfL legs are only worth fetching once the planner is open or the route is drawn. */
export function crawlJourneysWanted(
  isLondon: boolean,
  planningOpen: boolean,
  routeMappedActive: boolean,
): boolean {
  return isLondon && (planningOpen || routeMappedActive);
}

/** Whether the Tonight lane has rows worth holding first paint for. */
export function tonightLaneReadState(
  isLondon: boolean,
  status: string,
  rowCount: number,
): { hasRows: boolean; pending: boolean } {
  return {
    hasRows: isLondon && status === "ready" && rowCount > 0,
    pending: isLondon && status === "idle",
  };
}

/** The Night Area a surface is about, as its slug, or null when there is none. */
export function nightAreaSlugOf<Slug extends string>(
  area: { slug: Slug } | null | undefined,
): Slug | null {
  return area?.slug ?? null;
}

/** The router's query string, or "" before a reader exists. */
export function searchParamsQuery(
  params: { toString: () => string } | null | undefined,
): string {
  return params?.toString() ?? "";
}

/**
 * The one price the phone peek prints, or null when the pub genuinely has no
 * price on record and the chip may invite the first drop.
 *
 * The lane is decided by `venuePriceLane` alone; this only says how the winning
 * lane reads inside a chip that holds ONE figure and ONE short caption. An
 * estimate answers `observed: false`, because nobody watched a modelled figure
 * being paid, and its string comes from `priceStandingFigure`, which is what
 * keeps the "est." on it.
 */
export function peekPriceChip(
  lane: VenuePriceLane | null,
  bundle: VenueBundlePrices,
  /** The drop lane's trust state (lib/pintTrust.ts), so the chip can carry it. */
  pintTrust: PintTrustState | null = null,
): {
  figure: string;
  /** The figure as a number, so the chip can wear its price band (lib/priceBand.ts). */
  priceGbp: number | null;
  caption: string;
  observed: boolean;
  trust: PintTrustState | null;
} | null {
  if (!lane) return null;
  if (lane.lane === "estimate") {
    const figure = priceStandingFigure(
      priceStandingFor({ estimate: bundle.estimate ?? null }),
    );
    return figure
      ? {
          figure,
          priceGbp: bundle.estimate?.priceGbp ?? null,
          caption: priceStandingLabel("estimate"),
          observed: false,
          trust: null,
        }
      : null;
  }
  if (lane.lane === "baseline") {
    // The price we HOLD, in the reader's word rather than ours. Decided by the
    // lane, so this caption and the Overview's heading are one string.
    return {
      figure: formatPrice(lane.cheapestPrice),
      priceGbp: lane.cheapestPrice,
      caption: baselineTrustCaption(lane),
      observed: true,
      trust: null,
    };
  }
  // A SPLIT PRINTS THE RANGE AND THE SPLIT'S OWN LINE. It has no single figure,
  // so `venuePriceLaneObservedGbp` answers null for it and the chip would
  // otherwise fall through to nothing over a pub two drinkers have reported.
  // `priceGbp` stays null with it: two prices have no one band.
  if (lane.lane === "disputed") {
    return {
      figure: pintPriceSplitRange(lane.split),
      priceGbp: null,
      caption: pintPriceSplitLine(lane.split),
      observed: true,
      trust: "disputed",
    };
  }
  const observedGbp = venuePriceLaneObservedGbp(lane);
  if (observedGbp === null) return null;
  // The chip carries the same state the Overview chip carries, read from the
  // signal rather than re-derived: the peek holds no confirmation of its own.
  const trust = trustChipStateFor(lane, pintTrust === "confirmed" ? "confirmed" : "none");
  return {
    figure: formatPrice(observedGbp),
    priceGbp: observedGbp,
    // A report says what it still lacks, in the one wording its state owns;
    // every other lane names itself, so a dataset baseline is never called a
    // current recorded price beside an Overview that calls it a baseline.
    caption: (trust && PINT_TRUST_LINE[trust]) || PEEK_LANE_CAPTION[lane.lane],
    observed: true,
    trust,
  };
}

/**
 * What the peek chip calls a figure that is NOT a drinker's report in a
 * named trust state. The Overview prints the same lane under the same word
 * (Baseline on record, Sourced, Listed), so the two surfaces cannot read one
 * pub two ways (battle test M05).
 */
const PEEK_LANE_CAPTION: Record<
  Exclude<VenuePriceLane["lane"], "baseline">,
  string
> = {
  anchor: "listed anchor price",
  contributor: "current recorded price",
  sourced: "sourced price on record",
  listed: "listed by the pub",
  provisional: PROVISIONAL_PRICE_LINE,
  // Never reached: the split branch above answers before the table is asked,
  // because its caption names the pub's own figures. The key is here so the
  // closed lane set stays closed.
  disputed: PROVISIONAL_PRICE_LINE,
  aged: AGED_PRICE_LINE,
  estimate: "estimate",
};

/**
 * Stops the reader has picked by hand on this map while nothing is mapped.
 *
 * The built list is only ever read in build mode, so a suggest-mode leftover
 * counts for nothing; and once a route of two or more stops is mapped the pill
 * speaks about that route instead (lib/planActivationPill.ts).
 */
export function builtStopCountFor(input: {
  mode: CrawlMode;
  routeMappedActive: boolean;
  builtCount: number;
}): number {
  return input.mode === "build" && !input.routeMappedActive ? input.builtCount : 0;
}

/**
 * Which block leads the phone planner sheet. A crawl being built leads, so a
 * pub the reader just picked is named on the sheet's first screen rather than
 * a whole "Describe the outing" form below it (verify-preview-4, J04).
 */
export function phonePlannerOrder(input: {
  mobileViewport: boolean;
  mode: CrawlMode;
  builtCount: number;
}): "build-first" | "describe-first" {
  return input.mobileViewport && input.mode === "build" && input.builtCount > 0
    ? "build-first"
    : "describe-first";
}
