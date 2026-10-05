import { describe, it, expect } from "vitest";

import { WALK_ROUTE_MAX_STOPS } from "@/lib/walkRoute";

import {
  hasCrawlArrivalParams,
  crawlStopsFromPubIds,
  filtersForCuratedCrawl,
  buildMapSeed,
  builtStopsAskedAfter,
  builtStopsNeedingHydration,
  detailStatusFor,
  mapSelectionNotice,
  mapSelectionNoticeCopy,
  mapSelectionNoticeFromSearch,
  MAP_SELECTION_NOTICE_PARAM,
  MAP_SELECTION_LOOKUP_FAILED_NOTE,
  UNKNOWN_MAP_SELECTION_NOTE,
  venueUpdateKey,
  normaliseTonightVenueLookup,
  activeLensLabelFor,
  activeLensPricesFor,
  ambientBannerLaneOpen,
  builtStopCountFor,
  coordinatedMapOverlay,
  coffeePilotSelection,
  crawlJourneysWanted,
  londonRestaurantSelection,
  londonVenueSelection,
  drinkFiltersActiveFor,
  drinkIndexStatusFor,
  firstIdOf,
  mapArrivalFrame,
  mapDrinkLensSelection,
  mapPlaceContext,
  isRecordlessMapSelection,
  mapSelectionFrame,
  mapShellClassName,
  mapSurfaceIdFor,
  mapSurfaceTitleFor,
  nightAreaSlugOf,
  openingViewportFrom,
  phonePlannerOrder,
  priceLegendInput,
  reactiveLogIntentActive,
  restoredSessionFrame,
  searchParamValue,
  searchParamsQuery,
  settledBoundsFor,
  shouldResolveOpeningLocation,
  suggestedRouteWanted,
  tonightLaneKindFor,
  tonightLaneReadState,
  venueEntranceOvershootFor,
  type VenueDetailStatus,
} from "@/lib/pubMap";
import { curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import { getCity } from "@/lib/cities";
import { initialFilters } from "@/components/map/ControlRail";
import {
  SAVED_ONLY_ARIA_LABEL,
  SAVED_ONLY_EMPTY_NOTE,
} from "@/lib/savedOnlyFilter";
import type { Filters, Venue } from "@/lib/venues";

// Reference curated crawl from the default (london) city set — buildMapSeed
// resolves ?crawl= against curatedCrawlByIdForCity for DEFAULT_CITY_ID.
const soho = curatedCrawls.find((c) => c.id === "victorian-soho") as CuratedCrawl;

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "v1",
    name: "The Test Arms",
    prices: [],
    ...overrides,
  } as Venue;
}

it("describes Saved only as a venue-wide map filter", () => {
  expect(SAVED_ONLY_ARIA_LABEL).toBe("Show only venues you have saved");
  expect(SAVED_ONLY_EMPTY_NOTE).toMatch(/Tap a pub and Save it/);
});

describe("hasCrawlArrivalParams", () => {
  it("detects crawl-shaping deep-link params", () => {
    expect(hasCrawlArrivalParams("?crawl=victorian-soho")).toBe(true);
    expect(hasCrawlArrivalParams("?sel=v1")).toBe(true);
    expect(hasCrawlArrivalParams("?drink=stout")).toBe(true);
    expect(hasCrawlArrivalParams("?band=fleet")).toBe(true);
    expect(hasCrawlArrivalParams("?log=1")).toBe(true);
    expect(hasCrawlArrivalParams("?mapNotice=unknown")).toBe(true);
  });

  it("returns false for a clean arrival", () => {
    expect(hasCrawlArrivalParams("")).toBe(false);
    expect(hasCrawlArrivalParams("?utm_source=x")).toBe(false);
  });
});

describe("crawlStopsFromPubIds", () => {
  it("drops blanks and caps at three", () => {
    expect(crawlStopsFromPubIds(["a", "", "b", "c", "d"])).toEqual(["a", "b", "c"]);
    expect(crawlStopsFromPubIds([])).toEqual([]);
  });
});

describe("filtersForCuratedCrawl", () => {
  it("folds crawlStyle and leaves non-alcoholic untouched for a non-mocktail crawl", () => {
    const base: Filters = { ...initialFilters, requireNonAlcoholic: false };
    const crawl = { ...soho, crawlStyle: "heritage", altStyle: undefined } as CuratedCrawl;
    const next = filtersForCuratedCrawl(base, crawl);
    expect(next.crawlStyle).toBe("heritage");
    expect(next.requireNonAlcoholic).toBe(false);
  });

  it("forces non-alcoholic on for a mocktail crawl", () => {
    const base: Filters = { ...initialFilters, requireNonAlcoholic: false };
    const crawl = { ...soho, altStyle: "mocktail" } as CuratedCrawl;
    expect(filtersForCuratedCrawl(base, crawl).requireNonAlcoholic).toBe(true);
  });
});

describe("buildMapSeed", () => {
  it("eagerly applies the mocktail crawl's non-alcoholic filter", () => {
    const seed = buildMapSeed("?crawl=leicester-mocktail-crawl");
    expect(seed.filters.requireNonAlcoholic).toBe(true);
    expect(seed.altStyle).toBe("mocktail");
  });

  it("eagerly applies the mocktail filter to its exact stop-list link", () => {
    const seed = buildMapSeed(
      "?mode=build&pubs=venue-11u4gpi,venue-ymqu1w,venue-12bzb84,venue-165ayyi,venue-1jmwk6r",
    );
    expect(seed.filters.requireNonAlcoholic).toBe(true);
    expect(seed.altStyle).toBe("mocktail");
  });

  it("drink-shape arrival lands clean with no active crawl", () => {
    const seed = buildMapSeed("?drink=stout");
    expect(seed.activeCrawl).toBeNull();
    expect(seed.routeMapped).toBe(false);
  });

  it("restores explicit unrefined Beer shared stops without a selected Beer filter", () => {
    const seed = buildMapSeed("?drink=beer&mode=build&pubs=venue-a,venue-b");
    expect(seed.routeMapped).toBe(true);
    expect(seed.filters.drinkCategory).toBe("");
    expect(seed.filters.requireCocktails).toBe(false);
  });

  it("plain arrival has no active crawl and an unmapped route", () => {
    const seed = buildMapSeed("");
    expect(seed.activeCrawl).toBeNull();
    expect(seed.routeMapped).toBe(false);
  });
});

describe("buildMapSeedWithCuratedCrawl", () => {
  it("curated arrival hydrates the named crawl and maps the route", async () => {
    const { buildMapSeedWithCuratedCrawl } = await import("@/lib/mapSeedCrawl");
    const seed = await buildMapSeedWithCuratedCrawl("?crawl=victorian-soho");
    expect(seed.activeCrawl?.id).toBe("victorian-soho");
    expect(seed.crawlId).toBe("victorian-soho");
    expect(seed.routeMapped).toBe(true);
  });
});

describe("builtStopsNeedingHydration", () => {
  const onTheMap = new Map<string, Venue>([["v1", makeVenue()]]);
  const none = new Set<string>();

  it("asks for nothing while the slim pack is still loading", () => {
    expect(
      builtStopsNeedingHydration({
        venueDataReady: false,
        builtIds: ["v1", "v2", "v3"],
        venueById: new Map<string, Venue>(),
        askedIds: none,
      }),
    ).toEqual([]);
  });

  it("asks only for the stops the settled pack does not carry", () => {
    expect(
      builtStopsNeedingHydration({
        venueDataReady: true,
        builtIds: ["v1", "v2"],
        venueById: onTheMap,
        askedIds: none,
      }),
    ).toEqual(["v2"]);
  });

  it("requests detail for a priced slim stop without its pint identity", () => {
    const pins = new Map([["v1", makeVenue({ cheapestPrice: 6.15, cheapestPint: "", prices: [] })]]);
    expect(builtStopsNeedingHydration({
      venueDataReady: true, builtIds: ["v1"], venueById: pins, askedIds: none,
    })).toEqual(["v1"]);
  });

  it("does not request a present unpriced stop or repeat a failed identity read", () => {
    const pins = new Map([
      ["v1", makeVenue({ cheapestPrice: 6.15, cheapestPint: "", prices: [] })],
      ["v2", makeVenue({ id: "v2", cheapestPrice: null, cheapestPint: "", prices: [] })],
    ]);
    expect(builtStopsNeedingHydration({
      venueDataReady: true, builtIds: ["v1", "v2"], venueById: pins, askedIds: new Set(["v1"]),
    })).toEqual([]);
  });

  it("never asks twice for the same stop", () => {
    expect(
      builtStopsNeedingHydration({
        venueDataReady: true,
        builtIds: ["v2", "v3"],
        venueById: onTheMap,
        askedIds: new Set(["v2"]),
      }),
    ).toEqual(["v3"]);
  });

  it("does not re-ask a stop whose request failed when the venue set is rebuilt", () => {
    const asked = builtStopsAskedAfter(new Set(["v1", "v2"]), [
      { id: "v1", status: "found" },
      { id: "v2", status: "failed" },
    ]);
    expect(asked.has("v2")).toBe(true);
    const rebuilt = new Map<string, Venue>([
      ["v1", makeVenue()],
      ["v9", makeVenue({ id: "v9" })],
    ]);
    expect(
      builtStopsNeedingHydration({
        venueDataReady: true,
        builtIds: ["v1", "v2"],
        venueById: rebuilt,
        askedIds: asked,
      }),
    ).toEqual([]);
  });

  it("keeps a stop asked whose request went missing", () => {
    expect(
      builtStopsAskedAfter(new Set<string>(), [{ id: "v3", status: "missing" }]),
    ).toEqual(new Set(["v3"]));
  });

  it("bounds one arrival at the plan's own stop ceiling", () => {
    const ids = Array.from({ length: 40 }, (_, index) => `v${index + 100}`);
    expect(
      builtStopsNeedingHydration({
        venueDataReady: true,
        builtIds: ids,
        venueById: new Map<string, Venue>(),
        askedIds: none,
      }),
    ).toEqual(ids.slice(0, WALK_ROUTE_MAX_STOPS));
  });
});

describe("detailStatusFor", () => {
  const empty = new Map<string, Venue>();
  const status = new Map<string, VenueDetailStatus>();

  it("is idle with no selection", () => {
    expect(detailStatusFor("", empty, status)).toBe("idle");
  });

  it("is ready when detail is present", () => {
    const detail = new Map<string, Venue>([["v1", makeVenue()]]);
    expect(detailStatusFor("v1", detail, status)).toBe("ready");
  });

  it("is retired when the detail held is a pub that left the map, however it arrived", () => {
    const detail = new Map<string, Venue>([["v1", { ...makeVenue(), retired: true }]]);
    expect(detailStatusFor("v1", detail, status)).toBe("retired");
  });

  it("falls back to the tracked status, defaulting to loading", () => {
    const tracked = new Map<string, VenueDetailStatus>([["v1", "unavailable"]]);
    expect(detailStatusFor("v1", empty, tracked)).toBe("unavailable");
    expect(detailStatusFor("v2", empty, status)).toBe("loading");
  });
});

describe("mapSelectionNotice", () => {
  const base = {
    loaded: true,
    selectedVenueId: "the-dove-hammersmith",
    resolvable: false,
    ukBase: false,
    detailStatus: "missing" as VenueDetailStatus,
  };

  it("reports unknown only after a confirmed missing lookup", () => {
    expect(mapSelectionNotice(base)).toBe("unknown");
    expect(mapSelectionNotice({ ...base, detailStatus: "unavailable" })).toBe(
      "lookup-failed",
    );
  });

  it("stays silent while loading or before the index settles", () => {
    expect(mapSelectionNotice({ ...base, loaded: false })).toBeNull();
    expect(mapSelectionNotice({ ...base, detailStatus: "loading" })).toBeNull();
    expect(mapSelectionNotice({ ...base, detailStatus: "idle" })).toBeNull();
  });

  it("stays silent for a resolvable curated pin or a UK base id", () => {
    expect(mapSelectionNotice({ ...base, resolvable: true, selectedVenueId: "venue-xjf3n0" })).toBe(
      null,
    );
    expect(mapSelectionNotice({ ...base, ukBase: true, selectedVenueId: "venue-uk-1" })).toBe(
      null,
    );
  });

  it("stays silent with no selection", () => {
    expect(mapSelectionNotice({ ...base, selectedVenueId: "" })).toBeNull();
  });

  it("names a retired pub's link as that pub, no longer on the map", () => {
    expect(mapSelectionNotice({ ...base, detailStatus: "retired" })).toBe("retired");
    expect(mapSelectionNoticeCopy("retired", "The Duck")).toBe(
      "The Duck is no longer on the map. It may have closed.",
    );
    expect(mapSelectionNoticeCopy("unknown", null)).toBe(UNKNOWN_MAP_SELECTION_NOTE);
  });

  it("ships quiet empty-state voice with no em dash", () => {
    expect(UNKNOWN_MAP_SELECTION_NOTE).toBe("That pub is not one we know.");
    expect(MAP_SELECTION_LOOKUP_FAILED_NOTE).toBe("We could not check that pub right now.");
    expect(UNKNOWN_MAP_SELECTION_NOTE).not.toMatch(/\u2014/);
    expect(MAP_SELECTION_LOOKUP_FAILED_NOTE).not.toMatch(/\u2014/);
  });
});

describe("mapSelectionNoticeFromSearch", () => {
  it("reads one-shot map-owned notice without creating a selection", () => {
    expect(mapSelectionNoticeFromSearch(`?${MAP_SELECTION_NOTICE_PARAM}=unknown`)).toBe("unknown");
    expect(new URLSearchParams(`?${MAP_SELECTION_NOTICE_PARAM}=unknown`).has("sel")).toBe(false);
  });

  it("ignores unsupported notice values", () => {
    expect(mapSelectionNoticeFromSearch(`?${MAP_SELECTION_NOTICE_PARAM}=other`)).toBeNull();
  });
});

describe("venueUpdateKey", () => {
  it("uses the first price grouping key when priced", () => {
    const venue = makeVenue({
      id: "v9",
      prices: [
        { pub_name: "The Test Arms", address: "1 Dean St", latitude: 51.5, longitude: -0.13 },
      ] as unknown as Venue["prices"],
    });
    // grouping key is derived from the first price, not the raw id.
    expect(venueUpdateKey(venue)).not.toBe("v9");
    expect(typeof venueUpdateKey(venue)).toBe("string");
  });

  it("falls back to the venue id when unpriced", () => {
    expect(venueUpdateKey(makeVenue({ id: "v9", prices: [] }))).toBe("v9");
  });
});

describe("normaliseTonightVenueLookup", () => {
  it("lowercases, strips apostrophes, expands &, and collapses punctuation", () => {
    expect(normaliseTonightVenueLookup("O’Neill’s & Co.")).toBe("oneills and co");
    expect(normaliseTonightVenueLookup("  The  Crown  ")).toBe("the crown");
  });
});

// ── PubMap body derivations (issue #1185) ────────────────────────────────────
// These moved out of the component verbatim. The cases below are the ones the
// component's own comments call out, so a later edit that "tidies" one of them
// has to argue with a named rule rather than with a ternary in a 300-branch
// render function.

describe("mapArrivalFrame", () => {
  const base = {
    search: "",
    placeArrival: null,
    nationalBrowse: false,
    cityId: "london" as const,
    cityDisplayName: "London",
  };

  it("may resolve an opening location only on a clean London arrival", () => {
    expect(mapArrivalFrame(base).needsOpeningResolution).toBe(true);
    expect(mapArrivalFrame({ ...base, search: "?sel=v1" }).needsOpeningResolution).toBe(false);
    expect(
      mapArrivalFrame({ ...base, placeArrival: { name: "Llandudno" } }).needsOpeningResolution,
    ).toBe(false);
    expect(mapArrivalFrame({ ...base, nationalBrowse: true }).needsOpeningResolution).toBe(false);
  });

  it("is London only when London owns the whole surface", () => {
    expect(mapArrivalFrame(base).isLondon).toBe(true);
    expect(mapArrivalFrame({ ...base, cityId: "manchester" }).isLondon).toBe(false);
    // An uncovered place or a national browse is not the London map, whatever
    // city id the route carries.
    expect(mapArrivalFrame({ ...base, placeArrival: { name: "Llandudno" } }).isLondon).toBe(false);
    expect(mapArrivalFrame({ ...base, nationalBrowse: true }).isLondon).toBe(false);
  });

  it("invites the search the surface can actually answer", () => {
    expect(mapArrivalFrame(base).searchPlaceholder).toBe("Search London venues or areas");
    expect(mapArrivalFrame({ ...base, nationalBrowse: true }).searchPlaceholder).toBe(
      "Search pubs or UK places",
    );
    expect(
      mapArrivalFrame({ ...base, placeArrival: { name: "Llandudno" } }).searchPlaceholder,
    ).toBe("Search priced pub names");
  });

  it("carries the place name and stands the curated corpus down with it", () => {
    expect(mapArrivalFrame(base).placeName).toBeUndefined();
    expect(mapArrivalFrame(base).limitedCoverage).toBe(false);
    const place = mapArrivalFrame({ ...base, placeArrival: { name: "Llandudno" } });
    expect(place.placeName).toBe("Llandudno");
    expect(place.limitedCoverage).toBe(true);
    expect(mapArrivalFrame({ ...base, nationalBrowse: true }).limitedCoverage).toBe(true);
  });
});

describe("shouldResolveOpeningLocation", () => {
  it("never asks over an answer the arrival already holds", () => {
    const clean = {
      needsOpeningResolution: true,
      mapResumeSeed: null,
      restoredMobileSession: null,
    };
    expect(shouldResolveOpeningLocation(clean)).toBe(true);
    expect(shouldResolveOpeningLocation({ ...clean, mapResumeSeed: { rows: [] } })).toBe(false);
    expect(
      shouldResolveOpeningLocation({
        ...clean,
        restoredMobileSession: {
          viewport: { center: [0, 0], zoom: 12, pitch: 0, bearing: 0 },
        },
      }),
    ).toBe(false);
    // A restored session with no viewport says nothing about where to open.
    expect(
      shouldResolveOpeningLocation({ ...clean, restoredMobileSession: { openSheet: "planner" } }),
    ).toBe(true);
    expect(shouldResolveOpeningLocation({ ...clean, needsOpeningResolution: false })).toBe(false);
  });
});

describe("ambientBannerLaneOpen", () => {
  it("is a desktop opening offer that steps off once the reader drives", () => {
    expect(ambientBannerLaneOpen(false, false)).toBe(true);
    expect(ambientBannerLaneOpen(false, true)).toBe(false);
    expect(ambientBannerLaneOpen(true, false)).toBe(false);
  });
});

describe("mapPlaceContext", () => {
  // The real config, so the bounds this asserts on are the ones the map uses.
  const city = getCity("london");
  const inside = [-0.13, 51.51] as const;
  const outside = [-3.83, 53.32] as const;

  it("names the city while the view is over it", () => {
    const answer = mapPlaceContext({
      placeArrivalName: undefined,
      nationalBrowse: false,
      center: inside,
      city,
    });
    expect(answer.mapContextName).toBe("London");
    expect(answer.outsideCuratedBounds).toBe(false);
    expect(answer.baseLedChrome).toBe(false);
  });

  it("hands the chrome to the base layer once the view leaves the city", () => {
    const answer = mapPlaceContext({
      placeArrivalName: undefined,
      nationalBrowse: false,
      center: outside,
      city,
    });
    expect(answer.mapContextName).toBe("UK");
    expect(answer.outsideCuratedBounds).toBe(true);
    expect(answer.baseLedChrome).toBe(true);
  });

  it("is outside nothing before the camera has settled", () => {
    const answer = mapPlaceContext({
      placeArrivalName: undefined,
      nationalBrowse: false,
      center: null,
      city,
    });
    expect(answer.outsideCuratedBounds).toBe(false);
    expect(answer.mapContextName).toBe("London");
  });

  // The opening centre exists from the first render, so "no centre" was never
  // the state a cold open was in: MapLibre reported its own maxBounds until the
  // camera settled and a plain London open painted "Outside the priced city
  // map" for 334 ms. An unsettled viewport is read as an absent centre.
  it("claims no place while the camera is unsettled, whatever the centre says", () => {
    const answer = mapPlaceContext({
      placeArrivalName: undefined,
      nationalBrowse: false,
      center: outside,
      city,
      viewportSettled: false,
    });
    expect(answer.outsideCuratedBounds).toBe(false);
    expect(answer.baseLedChrome).toBe(false);
    expect(answer.mapContextName).toBe("London");
  });

  it("answers the settled camera once it has settled", () => {
    const answer = mapPlaceContext({
      placeArrivalName: undefined,
      nationalBrowse: false,
      center: outside,
      city,
      viewportSettled: true,
    });
    expect(answer.outsideCuratedBounds).toBe(true);
    expect(answer.mapContextName).toBe("UK");
  });

  it("lets an uncovered place keep its own name wherever the camera is", () => {
    const answer = mapPlaceContext({
      placeArrivalName: "Llandudno",
      nationalBrowse: false,
      center: outside,
      city,
    });
    expect(answer.mapContextName).toBe("Llandudno");
    // The arrival is already base-led, so it is not ALSO "outside" the city.
    expect(answer.outsideCuratedBounds).toBe(false);
    expect(answer.baseLedChrome).toBe(true);
  });
});

describe("mapDrinkLensSelection", () => {
  const deps = {
    isMapLensDrinkCategory: (value: string) => ["beer", "cocktail", "wine"].includes(value),
    activeDrinkLane: (value: string) => (value === "" ? "beer" : value) as never,
    defaultDrinkLane: "beer" as never,
  };

  it("never lenses the map on beer, which is the lane it rests in", () => {
    const answer = mapDrinkLensSelection({
      drinkCategory: "beer",
      experienceLens: "all",
      ...deps,
    });
    expect(answer.selectedDrinkCategory).toBe("beer");
    expect(answer.mapDrinkLensCategory).toBeNull();
    expect(answer.activeMapDrinkLane).toBe("beer");
  });

  it("lenses on a non-beer drink the map has an honest label for", () => {
    const answer = mapDrinkLensSelection({
      drinkCategory: "cocktail",
      experienceLens: "all",
      ...deps,
    });
    expect(answer.mapDrinkLensCategory).toBe("cocktail");
    expect(answer.activeMapDrinkLane).toBe("cocktail");
  });

  it("refuses a category the map cannot label", () => {
    // `other` is submittable but never lensable: a pin reading "£6 Other"
    // labels a figure with a name that identifies no drink.
    const answer = mapDrinkLensSelection({
      drinkCategory: "other",
      experienceLens: "all",
      ...deps,
    });
    expect(answer.selectedDrinkCategory).toBeNull();
    expect(answer.mapDrinkLensCategory).toBeNull();
  });

  it("stands the drink lane down while an experience view owns the map", () => {
    const answer = mapDrinkLensSelection({
      drinkCategory: "cocktail",
      experienceLens: "food",
      ...deps,
    });
    expect(answer.mapDrinkLensCategory).toBeNull();
    expect(answer.activeMapDrinkLane).toBe("beer");
  });
});

describe("drinkIndexStatusFor", () => {
  it("reports the answering index's own completeness", () => {
    const statuses = new Map([["cocktail", "partial" as const]]);
    expect(
      drinkIndexStatusFor("cocktail" as never, "all", statuses as never, "ready" as never),
    ).toBe("partial");
  });

  it("names an index nobody has asked for rather than calling it ready", () => {
    expect(
      drinkIndexStatusFor("wine" as never, "all", new Map() as never, "ready" as never),
    ).toBe("idle");
  });

  it("hands the no-alcohol view its own index, and the pint map a ready one", () => {
    expect(
      drinkIndexStatusFor(null, "no-alcohol", new Map() as never, "degraded" as never),
    ).toBe("degraded");
    expect(drinkIndexStatusFor(null, "all", new Map() as never, "degraded" as never)).toBe(
      "ready",
    );
  });
});

describe("activeLensLabelFor and activeLensPricesFor", () => {
  it("titles the lens the reader put the map under", () => {
    expect(activeLensLabelFor(null, "no-alcohol")).toBe("No-alcohol");
    expect(activeLensLabelFor(null, "food")).toBe("Food");
    expect(activeLensLabelFor(null, "all")).toBeNull();
  });

  it("takes drink prices at rest and the experience view's own otherwise", () => {
    const drink = new Map();
    const experience = new Map();
    expect(activeLensPricesFor("all", drink, experience)).toBe(drink);
    expect(activeLensPricesFor("food", drink, experience)).toBe(experience);
  });
});

describe("priceLegendInput", () => {
  const renderedMapState = { pins: 1 };

  it("gives food its own kind, because food never colours the map", () => {
    expect(
      priceLegendInput({
        experienceLens: "food",
        activeLensLabel: "Food",
        activeLensNoun: "Food",
        drinkIndexStatus: "ready" as never,
        renderedMapState,
      }),
    ).toEqual({ kind: "food", renderedState: renderedMapState });
  });

  it("only earns the drink key once it has BOTH a heading and a sentence noun", () => {
    expect(
      priceLegendInput({
        experienceLens: "all",
        activeLensLabel: "Cocktails",
        activeLensNoun: null,
        drinkIndexStatus: "ready" as never,
        renderedMapState,
      }).kind,
    ).toBe("default");
    expect(
      priceLegendInput({
        experienceLens: "all",
        activeLensLabel: "Cocktails",
        activeLensNoun: "cocktail",
        drinkIndexStatus: "partial" as never,
        renderedMapState,
      }),
    ).toEqual({
      kind: "drink",
      label: "Cocktails",
      noun: "cocktail",
      status: "partial",
      renderedState: renderedMapState,
    });
  });
});

describe("drinkFiltersActiveFor", () => {
  const none = {
    favoritePint: null,
    drinkCategory: "",
    drinkBrand: "",
    drinkSubtype: "",
    topShelfOnly: false,
    requireCocktails: false,
  };

  it("is false only when the reader has narrowed the map in none of the six ways", () => {
    expect(drinkFiltersActiveFor(none)).toBe(false);
    expect(drinkFiltersActiveFor({ ...none, favoritePint: "guinness" })).toBe(true);
    expect(drinkFiltersActiveFor({ ...none, drinkCategory: "cocktail" })).toBe(true);
    expect(drinkFiltersActiveFor({ ...none, drinkBrand: "guinness" })).toBe(true);
    expect(drinkFiltersActiveFor({ ...none, drinkSubtype: "stout" })).toBe(true);
    expect(drinkFiltersActiveFor({ ...none, topShelfOnly: true })).toBe(true);
    expect(drinkFiltersActiveFor({ ...none, requireCocktails: true })).toBe(true);
  });
});

describe("coordinatedMapOverlay and mapSurfaceIdFor", () => {
  const base = {
    logIntentFallbackVisible: false,
    detailOpen: false,
    planningOpen: false,
    mapOverlay: "layers" as const,
  };

  it("lets a surface that owns the screen answer ahead of the last-opened chip", () => {
    expect(coordinatedMapOverlay(base)).toBe("layers");
    expect(coordinatedMapOverlay({ ...base, planningOpen: true })).toBe("planner");
    expect(coordinatedMapOverlay({ ...base, planningOpen: true, detailOpen: true })).toBe("venue");
    expect(
      coordinatedMapOverlay({ ...base, detailOpen: true, logIntentFallbackVisible: true }),
    ).toBe("moment");
  });

  it("lets the landmark story own the screen under the venue and the planner", () => {
    // verify-preview-4, J02 and section 6 (5 Sep 2026): the story was not a
    // surface, so the "Describe the outing" pill painted under its sheet and
    // Back from a pub opened out of it landed on a bare map.
    expect(coordinatedMapOverlay({ ...base, storyOpen: true })).toBe("landmark");
    expect(coordinatedMapOverlay({ ...base, storyOpen: true, detailOpen: true })).toBe("venue");
    expect(coordinatedMapOverlay({ ...base, storyOpen: true, planningOpen: true })).toBe("planner");
    expect(mapSurfaceIdFor("landmark", false)).toBe("landmark");
  });

  it("counts List view as a surface a reader can be on", () => {
    expect(mapSurfaceIdFor("none", true)).toBe("venue-list");
    expect(mapSurfaceIdFor("none", false)).toBe("none");
    // An open sheet still owns the trail over the list behind it.
    expect(mapSurfaceIdFor("layers", true)).toBe("layers");
  });
});

describe("mapSurfaceTitleFor", () => {
  const sheetTitles = { layers: "Map controls" } as never;
  const base = {
    basePubOpen: false,
    basePub: null,
    selectedVenue: { name: "The Crown" },
    detailLabel: "Pub detail",
    sheetTitles,
  };

  it("names the pub the sheet is about, curated or base", () => {
    expect(mapSurfaceTitleFor({ ...base, mapSurfaceId: "venue" })).toBe("The Crown");
    expect(
      mapSurfaceTitleFor({
        ...base,
        mapSurfaceId: "venue",
        basePubOpen: true,
        basePub: { name: "The Ship" },
      }),
    ).toBe("The Ship");
  });

  it("falls back to the sheet's own label rather than naming nothing", () => {
    expect(
      mapSurfaceTitleFor({ ...base, mapSurfaceId: "venue", selectedVenue: null }),
    ).toBe("Pub detail");
    expect(
      mapSurfaceTitleFor({ ...base, mapSurfaceId: "venue", basePubOpen: true, basePub: null }),
    ).toBe("Pub detail");
  });

  it("names the story by its landmark, which is the Back label from a pub opened out of it", () => {
    expect(
      mapSurfaceTitleFor({ ...base, mapSurfaceId: "landmark", landmarkName: "Covent Garden" }),
    ).toBe("Covent Garden");
    expect(mapSurfaceTitleFor({ ...base, mapSurfaceId: "landmark" })).toBe("Landmark");
  });

  it("gives search a name of its own, because it is in no sheet-title table", () => {
    // A Back offering to return the reader to "Map controls" would name a
    // surface they never opened.
    expect(mapSurfaceTitleFor({ ...base, mapSurfaceId: "search" })).toBe("Search");
    expect(mapSurfaceTitleFor({ ...base, mapSurfaceId: "layers" })).toBe("Map controls");
    expect(mapSurfaceTitleFor({ ...base, mapSurfaceId: "planner" })).toBe("Plan an outing");
    expect(mapSurfaceTitleFor({ ...base, mapSurfaceId: "venue-list" })).toBe("List view");
    expect(mapSurfaceTitleFor({ ...base, mapSurfaceId: "tonight" })).toBe("Map controls");
  });
});

describe("venueEntranceOvershootFor", () => {
  const reveal = { form: "full", interrupted: false, venueId: "v1" };

  it("overshoots only for the live full reveal of the venue that is open", () => {
    expect(
      venueEntranceOvershootFor({ entranceActive: true, reveal, selectedVenueId: "v1" }),
    ).toBe(true);
    // A reveal left over from the previous pick must not bounce this sheet.
    expect(
      venueEntranceOvershootFor({ entranceActive: true, reveal, selectedVenueId: "v2" }),
    ).toBe(false);
    expect(
      venueEntranceOvershootFor({
        entranceActive: true,
        reveal: { ...reveal, interrupted: true },
        selectedVenueId: "v1",
      }),
    ).toBe(false);
    expect(
      venueEntranceOvershootFor({
        entranceActive: true,
        reveal: { ...reveal, form: "brief" },
        selectedVenueId: "v1",
      }),
    ).toBe(false);
    expect(
      venueEntranceOvershootFor({ entranceActive: true, reveal: null, selectedVenueId: "v1" }),
    ).toBe(false);
    expect(
      venueEntranceOvershootFor({ entranceActive: false, reveal, selectedVenueId: "v1" }),
    ).toBe(false);
  });
});

describe("mapShellClassName", () => {
  const base = {
    planningOpen: false,
    detailOpen: false,
    sheetSnap: "half",
    plannerSheetSnap: "half",
    routeMappedActive: false,
    mobileViewport: false,
    showOnboarding: false,
  };

  it("is the bare shell when nothing is open", () => {
    expect(mapShellClassName(base)).toBe("appShell dark");
  });

  it("marks sheet-full only at the most-expanded snap of an OPEN sheet", () => {
    // Peek and half keep the map usable, so the chrome stays visible.
    expect(mapShellClassName({ ...base, detailOpen: true, sheetSnap: "half" })).toBe(
      "appShell dark detail-open",
    );
    expect(mapShellClassName({ ...base, detailOpen: true, sheetSnap: "full" })).toBe(
      "appShell dark detail-open sheet-full",
    );
    // A full planner snap with the planner closed marks nothing.
    expect(mapShellClassName({ ...base, plannerSheetSnap: "full" })).toBe("appShell dark");
    expect(mapShellClassName({ ...base, planningOpen: true, plannerSheetSnap: "full" })).toBe(
      "appShell dark planning-open sheet-full",
    );
  });

  it("keeps the onboarding marker off the phone, which has its own chrome", () => {
    expect(mapShellClassName({ ...base, showOnboarding: true })).toBe(
      "appShell dark onboarding-open",
    );
    expect(
      mapShellClassName({ ...base, showOnboarding: true, mobileViewport: true }),
    ).toBe("appShell dark");
  });

  it("marks a mapped route", () => {
    expect(mapShellClassName({ ...base, routeMappedActive: true })).toBe(
      "appShell dark route-mapped",
    );
  });
});

describe("restoredSessionFrame", () => {
  const seed = {
    selectedVenueId: "",
    filters: { query: "seeded" },
    landmarkId: "",
    builtIds: ["a", "b"],
    mode: "build",
  } as never;
  const shouldOpenPlanningInitially = () => false;

  it("prefers the URL's own pub over a restored one", () => {
    expect(
      restoredSessionFrame({
        seed: { ...(seed as object), selectedVenueId: "url-pub" } as never,
        restoredSession: { selectedVenueId: "saved-pub" },
        resumeSeed: null,
        cityId: "london",
        search: "",
        shouldOpenPlanningInitially,
      }).selectedVenueId,
    ).toBe("url-pub");
    expect(
      restoredSessionFrame({
        seed,
        restoredSession: { selectedVenueId: "saved-pub" },
        resumeSeed: null,
        cityId: "london",
        search: "",
        shouldOpenPlanningInitially,
      }).selectedVenueId,
    ).toBe("saved-pub");
  });

  it("settles the city only when a resume snapshot supplies its rows", () => {
    expect(
      restoredSessionFrame({
        seed,
        restoredSession: null,
        resumeSeed: null,
        cityId: "london",
        search: "",
        shouldOpenPlanningInitially,
      }).loadedCityId,
    ).toBeNull();
    expect(
      restoredSessionFrame({
        seed,
        restoredSession: null,
        resumeSeed: { viewport: null },
        cityId: "london",
        search: "",
        shouldOpenPlanningInitially,
      }).loadedCityId,
    ).toBe("london");
  });

  it("never opens the planner over a pub the arrival picked", () => {
    const withPlanner = {
      seed,
      restoredSession: { openSheet: "planner" },
      resumeSeed: null,
      cityId: "london" as const,
      search: "",
      shouldOpenPlanningInitially,
    };
    expect(restoredSessionFrame(withPlanner).plannerOpen).toBe(true);
    expect(
      restoredSessionFrame({
        ...withPlanner,
        seed: { ...(seed as object), selectedVenueId: "url-pub" } as never,
      }).plannerOpen,
    ).toBe(false);
    // A restored venue sheet owns the surface instead.
    expect(
      restoredSessionFrame({ ...withPlanner, restoredSession: { openSheet: "venue" } })
        .plannerOpen,
    ).toBe(false);
  });

  it("lets the URL ask for the planner when no session says otherwise", () => {
    expect(
      restoredSessionFrame({
        seed,
        restoredSession: null,
        resumeSeed: null,
        cityId: "london",
        search: "?mode=build",
        shouldOpenPlanningInitially: () => true,
      }).plannerOpen,
    ).toBe(true);
  });
});

describe("openingViewportFrom", () => {
  const resume = { center: [0, 0], zoom: 12 } as never;
  const restored = { center: [1, 1], zoom: 14 } as never;

  it("prefers the resume snapshot, then the restored session, then nothing", () => {
    expect(openingViewportFrom(resume, { viewport: restored })).toBe(resume);
    expect(openingViewportFrom(null, { viewport: restored })).toBe(restored);
    expect(openingViewportFrom(null, null)).toBeNull();
    expect(openingViewportFrom(null, { openSheet: "planner" })).toBeNull();
  });
});

describe("mapSelectionFrame", () => {
  const crown = { id: "v1", name: "The Crown" } as never;
  const venueById = new Map([["v1", crown]]) as never;
  const isPubVenue = () => true;

  it("opens the detail sheet for a curated pin", () => {
    const answer = mapSelectionFrame({
      selectedVenueId: "v1",
      selectedVenue: crown,
      selectedBasePub: null,
      venueById,
      isPubVenue,
    });
    expect(answer.selectedId).toBe("v1");
    expect(answer.resolvable).toBe(true);
    expect(answer.isPub).toBe(true);
    expect(answer.basePubOpen).toBe(false);
    expect(answer.detailOpen).toBe(true);
  });

  it("opens the SAME sheet for a tapped base pub the index cannot resolve", () => {
    const answer = mapSelectionFrame({
      selectedVenueId: "venue-uk-9",
      selectedVenue: undefined,
      selectedBasePub: { id: "venue-uk-9" },
      venueById,
      isPubVenue,
    });
    expect(answer.resolvable).toBe(false);
    expect(answer.basePubOpen).toBe(true);
    expect(answer.detailOpen).toBe(true);
  });

  it("retires a held base pub the moment it stops being the selection", () => {
    const answer = mapSelectionFrame({
      selectedVenueId: "v1",
      selectedVenue: crown,
      selectedBasePub: { id: "venue-uk-9" },
      venueById,
      isPubVenue,
    });
    expect(answer.basePubOpen).toBe(false);
  });

  it("holds the sheet shut while nothing is selected", () => {
    const answer = mapSelectionFrame({
      selectedVenueId: "",
      selectedVenue: undefined,
      selectedBasePub: null,
      venueById,
      isPubVenue,
    });
    expect(answer.detailOpen).toBe(false);
    expect(answer.resolvable).toBe(false);
    expect(answer.isPub).toBe(false);
  });

  it("opens the SAME sheet for a Shoreditch pilot cafe once the cafes resolve it", () => {
    const answer = mapSelectionFrame({
      selectedVenueId: "venue-osm-w271641406",
      selectedVenue: undefined,
      selectedBasePub: null,
      selectedCoffeeCafe: { id: "venue-osm-w271641406" },
      venueById,
      isPubVenue,
    });
    expect(answer.coffeeCafeOpen).toBe(true);
    expect(answer.basePubOpen).toBe(false);
    expect(answer.resolvable).toBe(false);
    expect(answer.detailOpen).toBe(true);
  });

  it("retires a held cafe the moment it stops being the selection", () => {
    const answer = mapSelectionFrame({
      selectedVenueId: "v1",
      selectedVenue: crown,
      selectedBasePub: null,
      selectedCoffeeCafe: { id: "venue-osm-w271641406" },
      venueById,
      isPubVenue,
    });
    expect(answer.coffeeCafeOpen).toBe(false);
  });

  it("opens the SAME sheet for a London restaurant once the pack resolves it", () => {
    const answer = mapSelectionFrame({
      selectedVenueId: "venue-osm-n25496840",
      selectedVenue: undefined,
      selectedBasePub: null,
      selectedLondonRestaurant: { id: "venue-osm-n25496840" },
      venueById,
      isPubVenue,
    });
    expect(answer.londonRestaurantOpen).toBe(true);
    expect(answer.coffeeCafeOpen).toBe(false);
    expect(answer.resolvable).toBe(false);
    expect(answer.detailOpen).toBe(true);
  });

  it("retires a held restaurant the moment it stops being the selection", () => {
    const answer = mapSelectionFrame({
      selectedVenueId: "v1",
      selectedVenue: crown,
      selectedBasePub: null,
      selectedLondonRestaurant: { id: "venue-osm-n25496840" },
      venueById,
      isPubVenue,
    });
    expect(answer.londonRestaurantOpen).toBe(false);
  });

  it("opens the detail sheet while a deep-linked sel waits on the slim index", () => {
    const answer = mapSelectionFrame({
      selectedVenueId: "v1",
      selectedVenue: undefined,
      selectedBasePub: null,
      venueById: new Map() as never,
      isPubVenue,
    });
    expect(answer.detailOpen).toBe(true);
    expect(answer.resolvable).toBe(false);
  });
});

describe("coffeePilotSelection", () => {
  const crosstown = { id: "venue-osm-w271641406" };
  const byId = new Map([[crosstown.id, crosstown]]);

  it("opens a pilot cafe while the coffee lens is on", () => {
    expect(
      coffeePilotSelection({ lensOn: true, selectedVenueId: crosstown.id, status: "ready", byId }),
    ).toEqual({ cafe: crosstown, release: false });
  });

  it("closes the cafe sheet and lets the selection go when the reader leaves the coffee lens", () => {
    expect(
      coffeePilotSelection({ lensOn: false, selectedVenueId: crosstown.id, status: "ready", byId }),
    ).toEqual({ cafe: null, release: true });
  });

  it("holds a cafe selection while the pilot is still being read", () => {
    expect(
      coffeePilotSelection({ lensOn: true, selectedVenueId: crosstown.id, status: "loading", byId: new Map() }),
    ).toEqual({ cafe: null, release: false });
  });

  it("lets go of a cafe the settled read could not place", () => {
    for (const status of ["ready", "failed"] as const) {
      expect(
        coffeePilotSelection({ lensOn: true, selectedVenueId: "venue-osm-n9", status, byId }),
      ).toEqual({ cafe: null, release: true });
    }
  });

  it("leaves every other selection alone", () => {
    for (const selectedVenueId of ["", "v1", "venue-uk-9"]) {
      expect(
        coffeePilotSelection({ lensOn: false, selectedVenueId, status: "ready", byId }),
      ).toEqual({ cafe: null, release: false });
    }
  });
});

describe("londonRestaurantSelection", () => {
  const furnival = { id: "venue-osm-n25496840" };
  const byId = new Map([[furnival.id, furnival]]);

  it("opens a restaurant while its layer is shown", () => {
    expect(
      londonRestaurantSelection({ shown: true, selectedVenueId: furnival.id, status: "ready", byId }),
    ).toEqual({ restaurant: furnival, release: false });
  });

  it("lets the selection go when the layer leaves the map", () => {
    expect(
      londonRestaurantSelection({ shown: false, selectedVenueId: furnival.id, status: "ready", byId }),
    ).toEqual({ restaurant: null, release: true });
  });

  it("holds a restaurant selection while the pack is not read yet", () => {
    for (const status of ["idle", "loading"] as const) {
      expect(
        londonRestaurantSelection({ shown: true, selectedVenueId: furnival.id, status, byId: new Map() }),
      ).toEqual({ restaurant: null, release: false });
    }
  });

  it("lets go of an id the settled read could not place", () => {
    for (const status of ["ready", "failed"] as const) {
      expect(
        londonRestaurantSelection({ shown: true, selectedVenueId: "venue-osm-n9", status, byId }),
      ).toEqual({ restaurant: null, release: true });
    }
  });

  it("keeps a restaurant open off the coffee lens, because the map lets go only when both sources would", () => {
    const pick = londonVenueSelection({
      selectedVenueId: furnival.id,
      coffee: { lensOn: false, status: "idle", byId: new Map() },
      restaurants: { shown: true, status: "ready", byId },
    });
    expect(pick).toEqual({ cafe: null, restaurant: furnival, release: false });
  });

  it("opens a pilot cafe under the coffee lens while the restaurant layer is off the map", () => {
    const crosstown = { id: "venue-osm-w271641406" };
    const pick = londonVenueSelection({
      selectedVenueId: crosstown.id,
      coffee: { lensOn: true, status: "ready", byId: new Map([[crosstown.id, crosstown]]) },
      restaurants: { shown: false, status: "idle", byId: new Map<string, { id: string }>() },
    });
    expect(pick).toEqual({ cafe: crosstown, restaurant: null, release: false });
  });

  it("lets a pilot cafe go off the coffee lens without waiting for the restaurant read", () => {
    const crosstown = { id: "venue-osm-w271641406" };
    for (const status of ["idle", "loading"] as const) {
      const pick = londonVenueSelection({
        selectedVenueId: crosstown.id,
        coffee: { lensOn: false, status: "ready", byId: new Map([[crosstown.id, crosstown]]) },
        restaurants: { shown: true, status, byId: new Map<string, { id: string }>() },
      });
      expect(pick).toEqual({ cafe: null, restaurant: null, release: true });
    }
  });

  it("lets go of an id neither source can open", () => {
    const pick = londonVenueSelection({
      selectedVenueId: "venue-osm-n9",
      coffee: { lensOn: false, status: "idle", byId: new Map() },
      restaurants: { shown: true, status: "ready", byId },
    });
    expect(pick.release).toBe(true);
  });

  it("leaves every other selection alone", () => {
    for (const selectedVenueId of ["", "v1", "venue-uk-9"]) {
      expect(
        londonRestaurantSelection({ shown: false, selectedVenueId, status: "ready", byId }),
      ).toEqual({ restaurant: null, release: false });
    }
  });
});

describe("isRecordlessMapSelection", () => {
  it("names the ids that have no /api/venue record", () => {
    expect(isRecordlessMapSelection("venue-uk-9")).toBe(true);
    expect(isRecordlessMapSelection("venue-osm-w271641406")).toBe(true);
    expect(isRecordlessMapSelection("venue-1s7ucod")).toBe(false);
    expect(isRecordlessMapSelection("bar-seed-library")).toBe(false);
  });
});

describe("settledBoundsFor", () => {
  const bounds = { north: 1, south: 0, east: 1, west: 0 };

  it("reads bounds only once they belong to the city on screen", () => {
    expect(settledBoundsFor(bounds, "london", "london")).toBe(bounds);
    expect(settledBoundsFor(bounds, "manchester", "london")).toBeNull();
    expect(settledBoundsFor(null, "london", "london")).toBeNull();
  });
});

describe("tonightLaneKindFor and tonightLaneReadState", () => {
  it("stops forcing a deep-linked lane open once the reader collapses it", () => {
    expect(tonightLaneKindFor("quiz", "whats-on-quiz", null)).toBe("quiz");
    expect(tonightLaneKindFor("quiz", "whats-on-quiz", "whats-on-quiz")).toBeNull();
    expect(tonightLaneKindFor(null, "whats-on-quiz", null)).toBeNull();
  });

  it("separates a lane with rows from one nobody has read yet", () => {
    expect(tonightLaneReadState(true, "ready", 3)).toEqual({ hasRows: true, pending: false });
    expect(tonightLaneReadState(true, "ready", 0)).toEqual({ hasRows: false, pending: false });
    expect(tonightLaneReadState(true, "idle", 0)).toEqual({ hasRows: false, pending: true });
    // The lane is a London surface, so nowhere else holds first paint for it.
    expect(tonightLaneReadState(false, "idle", 0)).toEqual({ hasRows: false, pending: false });
  });
});

describe("suggestedRouteWanted and reactiveLogIntentActive", () => {
  it("holds a Drop arrival's suggestion back until the reader asks for a route", () => {
    expect(
      suggestedRouteWanted({ hasReactiveLogIntent: true, planningOpen: false, routeMapped: false }),
    ).toBe(false);
    expect(
      suggestedRouteWanted({ hasReactiveLogIntent: true, planningOpen: true, routeMapped: false }),
    ).toBe(true);
    expect(
      suggestedRouteWanted({ hasReactiveLogIntent: true, planningOpen: false, routeMapped: true }),
    ).toBe(true);
    expect(
      suggestedRouteWanted({ hasReactiveLogIntent: false, planningOpen: false, routeMapped: false }),
    ).toBe(true);
  });

  it("disarms a log intent the reader has left", () => {
    expect(reactiveLogIntentActive(true, false)).toBe(true);
    expect(reactiveLogIntentActive(true, true)).toBe(false);
    expect(reactiveLogIntentActive(false, false)).toBe(false);
  });
});

describe("crawlJourneysWanted", () => {
  it("only spends TfL reads once the route is on screen, and only in London", () => {
    expect(crawlJourneysWanted(true, true, false)).toBe(true);
    expect(crawlJourneysWanted(true, false, true)).toBe(true);
    expect(crawlJourneysWanted(true, false, false)).toBe(false);
    expect(crawlJourneysWanted(false, true, true)).toBe(false);
  });
});

describe("small PubMap reads", () => {
  it("firstIdOf answers the empty string rather than undefined", () => {
    expect(firstIdOf([{ id: "a" }, { id: "b" }])).toBe("a");
    expect(firstIdOf([])).toBe("");
  });

  it("searchParamValue and searchParamsQuery survive no reader", () => {
    const params = new URLSearchParams("sel=v1&src=whats-on-quiz");
    expect(searchParamValue(params, "sel")).toBe("v1");
    expect(searchParamValue(params, "missing")).toBe("");
    expect(searchParamValue(null, "sel")).toBe("");
    expect(searchParamsQuery(params)).toBe("sel=v1&src=whats-on-quiz");
    expect(searchParamsQuery(null)).toBe("");
  });

  it("nightAreaSlugOf answers null for no area", () => {
    expect(nightAreaSlugOf({ slug: "camden" })).toBe("camden");
    expect(nightAreaSlugOf(null)).toBeNull();
    expect(nightAreaSlugOf(undefined)).toBeNull();
  });
});

describe("the phone planner and the pill read the crawl being built", () => {
  // verify-preview-4, J04: one "Plan stop" read "6-stop plan" and the planner
  // sheet opened on the describe form with the picked pub a form below.
  it("counts built stops only in build mode and only while nothing is mapped", () => {
    expect(builtStopCountFor({ mode: "build", routeMappedActive: false, builtCount: 1 })).toBe(1);
    expect(builtStopCountFor({ mode: "suggest", routeMappedActive: false, builtCount: 1 })).toBe(0);
    expect(builtStopCountFor({ mode: "build", routeMappedActive: true, builtCount: 3 })).toBe(0);
  });

  it("leads the phone planner with the built crawl, and the desktop never", () => {
    expect(phonePlannerOrder({ mobileViewport: true, mode: "build", builtCount: 1 })).toBe("build-first");
    expect(phonePlannerOrder({ mobileViewport: true, mode: "build", builtCount: 0 })).toBe("describe-first");
    expect(phonePlannerOrder({ mobileViewport: true, mode: "suggest", builtCount: 2 })).toBe("describe-first");
    expect(phonePlannerOrder({ mobileViewport: false, mode: "build", builtCount: 2 })).toBe("describe-first");
  });
});
