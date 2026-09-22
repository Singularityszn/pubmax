import { describe, expect, it } from "vitest";

import { filterMapVenues, withForcedVenue } from "@/lib/filterMapVenues";
import { initialFilters } from "@/components/map/ControlRail";
import type { Venue } from "@/lib/venues";
import { buildDrinkHints } from "@/scripts/build_slim_index.mjs";

function slimPin(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-scraped",
    name: "The Mayflower",
    address: "Rotherhithe",
    latitude: 51.5,
    longitude: -0.05,
    primaryBorough: "Southwark",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: true,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: ["london_chain_gazetteer_seed"],
    curation: {},
    filterHints: {
      searchText: "the mayflower",
      amenities: {
        food: true,
        cocktails: false,
        beerGarden: false,
        liveSports: false,
        nonAlcoholic: false,
      },
      curation: { nearWater: true, hasStory: true },
      canonical: false,
      scraped: true,
      drinkCategories: ["gin"],
    },
    ...overrides,
  };
}

describe("filterMapVenues", () => {
  it("keeps slim scraped pubs visible even when canonicalOnly is on", () => {
    const filters = { ...initialFilters, canonicalOnly: true };
    const result = filterMapVenues([slimPin()], filters, () => false);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("venue-scraped");
  });

  it.each([
    ["requireStepFree", "stepFree"],
    ["requireAccessibleToilet", "accessibleToilet"],
    ["requireSeatedService", "seatedService"],
  ] as const)("%s includes only confirmed slim pins", (filter, facet) => {
    const confirmed = slimPin({ id: "confirmed", accessibility: { [facet]: true } });
    const negative = slimPin({ id: "negative", accessibility: { [facet]: false } });
    const unknown = slimPin({ id: "unknown" });
    expect(
      filterMapVenues(
        [confirmed, negative, unknown],
        { ...initialFilters, [filter]: true },
        () => false,
      ),
    ).toEqual([confirmed]);
  });

  it("still respects price query on slim pins", () => {
    const filters = { ...initialFilters, query: "zzzz-no-match" };
    const result = filterMapVenues([slimPin()], filters, () => false);
    expect(result).toHaveLength(0);
  });

  it("keeps non-pub anchors out of the maximum pint price filter", () => {
    const filters = { ...initialFilters, maxPrice: 8 };
    const bar = slimPin({
      id: "bar-house-cocktail",
      kind: "bar",
      cheapestPrice: 14,
    });
    const pub = slimPin({
      id: "pub-pricey-pint",
      kind: "pub",
      cheapestPrice: 14,
    });

    expect(filterMapVenues([bar, pub], filters, () => false)).toEqual([bar]);
  });

  it("applies food and cocktail filters from slim venue hints", () => {
    const bar = slimPin({
      id: "bar-cocktails",
      kind: "bar",
      filterHints: {
        ...slimPin().filterHints!,
        amenities: {
          ...slimPin().filterHints!.amenities,
          food: false,
          cocktails: true,
        },
      },
    });
    const food = slimPin({
      id: "food-late",
      kind: "food",
      filterHints: {
        ...slimPin().filterHints!,
        amenities: {
          ...slimPin().filterHints!.amenities,
          food: true,
          cocktails: false,
        },
      },
    });

    expect(
      filterMapVenues(
        [bar, food],
        { ...initialFilters, requireCocktails: true },
        () => false,
      ),
    ).toEqual([bar]);
    expect(
      filterMapVenues(
        [bar, food],
        { ...initialFilters, requireFood: true },
        () => false,
      ),
    ).toEqual([food]);
  });

  it("keeps Pint Drops filtering pub-only even with a stale non-pub signal", () => {
    const legacyPub = slimPin({ id: "legacy-pub" });
    const explicitPub = slimPin({ id: "explicit-pub", kind: "pub" });
    const bar = slimPin({ id: "bar-with-stale-drop", kind: "bar" });
    const food = slimPin({ id: "food-with-stale-drop", kind: "food" });

    expect(
      filterMapVenues(
        [legacyPub, explicitPub, bar, food],
        { ...initialFilters, requirePintDrops: true },
        () => true,
      ),
    ).toEqual([legacyPub, explicitPub]);
  });

  it("keeps soft-drink menu-item boundaries through slim map filtering", () => {
    const slimSoftDrinkVenue = (id: string, pintNames: string[]) =>
      slimPin({
        id,
        filterHints: {
          ...slimPin().filterHints!,
          ...buildDrinkHints(
            pintNames.map((pint_name) => ({
              pint_name,
              comment: "",
              description: "",
              cocktails: "",
            })),
          ),
        },
      });
    const composite = slimSoftDrinkVenue("composite-cola", [
      "Soft drink Soda, Sprite, Pepsi & Diet Coke",
    ]);
    const separateRows = slimSoftDrinkVenue("separate-colas", [
      "Soft drink Pepsi",
      "Diet Coke",
    ]);
    const genuine = slimSoftDrinkVenue("genuine-diet-pepsi", [
      "Soft drink Pepsi Diet",
    ]);
    const matchesSubtype = (drinkSubtype: string) =>
      filterMapVenues(
        [composite, separateRows, genuine],
        {
          ...initialFilters,
          drinkCategory: "soft-drink",
          drinkSubtype,
        },
        () => false,
      );

    expect(matchesSubtype("soft-drink-diet-pepsi")).toEqual([genuine]);
    expect(matchesSubtype("soft-drink-diet-coke")).toEqual([
      composite,
      separateRows,
    ]);
    // Composite rows remain truthful family hits through Diet Coke; preserving
    // boundaries prevents only the invented Diet Pepsi attribution.
    expect(matchesSubtype("soft-drink-zero-sugar-cola")).toEqual([
      composite,
      separateRows,
      genuine,
    ]);
  });
});

describe("withForcedVenue", () => {
  it("appends a deep-linked venue missing from the filtered set", () => {
    const forced = slimPin({ id: "venue-force", name: "Forced" });
    const byId = new Map([[forced.id, forced]]);
    const out = withForcedVenue([], byId, "venue-force");
    expect(out.map((v) => v.id)).toEqual(["venue-force"]);
  });

  it("does not duplicate an already-visible venue", () => {
    const venue = slimPin();
    const byId = new Map([[venue.id, venue]]);
    const out = withForcedVenue([venue], byId, venue.id);
    expect(out).toHaveLength(1);
  });
});
