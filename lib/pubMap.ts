// Pure helpers extracted from components/PubMap.tsx (F1 decomposition).
//
// Server-safe: NO "use client", no window/DOM reads, no React. These live off
// PubMap's complexity budget and are unit-tested in __tests__/pubMap.test.ts.
// seedCrawlState is imported from the pure @/lib/crawlUrl (NOT the client
// @/components/map/useCrawlUrl re-export) so this module never pulls a client
// boundary in.

import { venueGroupingKey, type Filters, type Venue } from "@/lib/venues";
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
import { isDrinkShapeArrival } from "@/lib/mapArrival";
import {
  priceStandingFigure,
  priceStandingFor,
  priceStandingLabel,
} from "@/lib/priceTier";
import {
  PROVISIONAL_PRICE_LINE,
  venuePriceLaneObservedGbp,
  type VenueBundlePrices,
  type VenuePriceLane,
} from "@/lib/venuePriceLane";
import { formatPrice } from "@/lib/venues";
import {
  eagerCuratedCrawlAltStyle,
  eagerCuratedCrawlAltStyleForBuiltIds,
} from "@/lib/curatedCrawlHints";
export { mapSeedNeedsCuratedCrawlLookup } from "@/lib/mapSeedCrawlPolicy";

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

export function filtersForCuratedCrawlHint(
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

export type VenueDetailStatus = "idle" | "loading" | "ready" | "missing" | "unavailable";

export function detailStatusFor(
  selectedVenueId: string,
  detailById: Map<string, Venue>,
  detailStatusById: Map<string, VenueDetailStatus>,
): VenueDetailStatus {
  if (!selectedVenueId) return "idle";
  if (detailById.has(selectedVenueId)) return "ready";
  return detailStatusById.get(selectedVenueId) ?? "loading";
}

export type MapSelectionNotice = "unknown" | "lookup-failed";

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
  return null;
}

/** Visible copy for an unknown `?sel=` - empty-state voice, no plumbing. */
export const UNKNOWN_MAP_SELECTION_NOTE = "That pub is not one we know.";
export const MAP_SELECTION_LOOKUP_FAILED_NOTE = "We could not check that pub right now.";

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
 * `outsideCuratedBounds` is a claim about the settled camera, so a viewport with
 * no centre yet is outside nothing. `baseLedChrome` is the one answer the chrome
 * branches on: an uncovered place, an explicit national browse, or a pan past
 * the city's own bounds all mean the base layer is leading.
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
}): MapPlaceContext {
  const { placeArrivalName, nationalBrowse, center, city } = input;
  const insideCity = Boolean(center && pointInCityBounds(center[1], center[0], city));
  const mapContextName =
    placeArrivalName ??
    (nationalBrowse ? "UK" : !center || insideCity ? city.displayName : "UK");
  const outsideCuratedBounds =
    !placeArrivalName && !nationalBrowse && Boolean(center && !insideCity);
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
  mapOverlay: MapOverlay;
}): MapOverlay {
  return input.logIntentFallbackVisible
    ? "moment"
    : input.detailOpen
      ? "venue"
      : input.planningOpen
        ? "planner"
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
  sheetTitles: Partial<Record<MapSheetKind, string>>;
}): string {
  const { mapSurfaceId, basePubOpen, basePub, selectedVenue, detailLabel } = input;
  if (mapSurfaceId === "venue") {
    return basePubOpen ? basePub?.name ?? "Pub detail" : selectedVenue?.name ?? detailLabel;
  }
  if (mapSurfaceId === "planner") return "Plan an outing";
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
  sheetSnap: string;
  plannerSheetSnap: string;
  routeMappedActive: boolean;
  mobileViewport: boolean;
  showOnboarding: boolean;
}): string {
  const {
    planningOpen,
    detailOpen,
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
}):
  | { kind: "food"; renderedState: RenderedState }
  | {
      kind: "drink";
      label: string;
      noun: string;
      status: CategoryPriceIndexStatus;
      renderedState: RenderedState;
    }
  | { kind: "default"; renderedState: RenderedState } {
  const { experienceLens, activeLensLabel, activeLensNoun, renderedMapState } = input;
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
 * What is selected, and what that means for the sheet.
 *
 * A curated pin and a tapped UK base pub fill the SAME drawer, so every
 * open/close/snap path stays one path and these five answers stay one read.
 */
export type MapSelectionFrame = {
  selectedId: string | undefined;
  resolvable: boolean;
  isPub: boolean;
  basePubOpen: boolean;
  detailOpen: boolean;
};

export function mapSelectionFrame(input: {
  selectedVenueId: string;
  selectedVenue: Venue | undefined;
  selectedBasePub: { id: string } | null;
  venueById: ReadonlyMap<string, Venue>;
  isPubVenue: (venue: Venue) => boolean;
}): MapSelectionFrame {
  const { selectedVenueId, selectedVenue, selectedBasePub, venueById } = input;
  const basePubOpen = Boolean(selectedBasePub && selectedBasePub.id === selectedVenueId);
  return {
    selectedId: selectedVenue?.id,
    resolvable: selectedVenueId ? venueById.has(selectedVenueId) : false,
    isPub: selectedVenue ? input.isPubVenue(selectedVenue) : false,
    basePubOpen,
    detailOpen: Boolean(selectedVenueId && selectedVenue) || basePubOpen,
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
): { figure: string; caption: string; observed: boolean } | null {
  if (!lane) return null;
  if (lane.lane === "estimate") {
    const figure = priceStandingFigure(
      priceStandingFor({ estimate: bundle.estimate ?? null }),
    );
    return figure
      ? { figure, caption: priceStandingLabel("estimate"), observed: false }
      : null;
  }
  const observedGbp = venuePriceLaneObservedGbp(lane);
  if (observedGbp === null) return null;
  return {
    figure: formatPrice(observedGbp),
    // A lone report says what it still lacks, in the one wording the lane owns.
    caption:
      lane.lane === "provisional"
        ? PROVISIONAL_PRICE_LINE
        : "current recorded price",
    observed: true,
  };
}
