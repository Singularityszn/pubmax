import { describe, expect, it } from "vitest";

import {
  buildMapSearchIndex,
  searchMapSearchIndex,
  type MapSearchPack,
} from "@/lib/mapSearchIndex";
import { defined } from "@/__tests__/helpers/defined";

const cities = [
  { id: "bath" as const, displayName: "Bath" },
  { id: "london" as const, displayName: "London" },
];

const packs: MapSearchPack[] = [
  {
    cityId: "bath",
    venues: [
      { id: "venue-bath-crown", name: "Crown and Anchor", area: "Bath" },
      { id: "venue-bath-royal", name: "Royal Crescent Tavern", area: "Bath" },
      { id: "venue-bath-the-royal", name: "The Royal Crown", area: "Bath" },
    ],
  },
  { cityId: "london", venues: [] },
];

describe("map search index", () => {
  it.each([
    { preferPints: true, expected: ["priced", "unpriced", "area-only"] },
    { preferPints: false, expected: ["unpriced", "priced", "area-only"] },
  ])("keeps name substrings ahead of area discovery before limiting: $preferPints", ({ preferPints, expected }) => {
    const index = buildMapSearchIndex(cities, [{ cityId: "london", venues: [
      { id: "unpriced", name: "East Riverside Inn", area: "Side", venueKind: "pub" },
      { id: "priced", name: "The Riverside Arms", area: "Westminster", venueKind: "pub", pintPrice: 5.2 },
      { id: "area-only", name: "A Tavern", area: "Side", venueKind: "pub", pintPrice: 4 },
    ] }]);
    for (const limit of [1, 2, 3]) {
      expect(searchMapSearchIndex(index, "side", limit, { preferPints }).map((row) => row.id))
        .toEqual(expected.slice(0, limit));
    }
  });

  it("uses all name aliases before area discovery and preserves every name tier", () => {
    const index = buildMapSearchIndex(cities, [{ cityId: "london", venues: [
      { id: "area-only", name: "A Tavern", area: "Side" },
      { id: "substring", name: "Riverside", area: "Side" },
      { id: "alias-substring", name: "Z Tavern", sourceName: "Riverside", area: "Side" },
      { id: "word-prefix", name: "The Side Arms", area: "Elsewhere" },
      { id: "label-prefix", name: "Side House", area: "Elsewhere" },
      { id: "exact", name: "Side", area: "Elsewhere" },
    ] }]);
    const expected = ["exact", "label-prefix", "word-prefix", "substring", "alias-substring", "area-only"];
    for (const limit of [1, 2, 3, 4, 5, 6]) {
      expect(searchMapSearchIndex(index, "side", limit).map((row) => row.id)).toEqual(expected.slice(0, limit));
    }
  });

  it.each([
    { preferPints: true, expected: ["george-iv", "george-dragon"] },
    { preferPints: false, expected: ["george-dragon", "george-iv"] },
  ])("ranks label and word prefixes in the same tier before limiting: $preferPints", ({ preferPints, expected }) => {
    const index = buildMapSearchIndex(cities, [{ cityId: "london", venues: [
      { id: "george-dragon", name: "George and Dragon, Fitzrovia", area: "Westminster", venueKind: "pub" },
      { id: "george-iv", name: "The George IV", area: "Westminster", venueKind: "pub", pintPrice: 6.5 },
    ] }]);
    expect(searchMapSearchIndex(index, "geor", 2, { preferPints }).map((row) => row.id)).toEqual(expected);
    expect(searchMapSearchIndex(index, "geor", 1, { preferPints }).map((row) => row.id)).toEqual(expected.slice(0, 1));

    index.venues = [...index.venues, { id: "exact", name: "Geor", area: "Westminster", cityId: "london", venueKind: "bar" }];
    expect(searchMapSearchIndex(index, "geor", 1, { preferPints }).map((row) => row.id)).toEqual(["exact"]);
  });

  it("ranks supported pint pubs before the result limit without changing other modes", () => {
    const index = buildMapSearchIndex(cities, [{ cityId: "london", venues: [
      { id: "restaurant", name: "Soho A Kitchen", area: "Soho", venueKind: "restaurant", pintPrice: 12 },
      { id: "unpriced", name: "Soho B Arms", area: "Soho", venueKind: "pub" },
      { id: "priced", name: "Soho C Arms", area: "Soho", venueKind: "pub", pintPrice: 4.7 },
    ] }]);
    expect(searchMapSearchIndex(index, "Soho", 1, { preferPints: true })[0]?.id).toBe("priced");
    expect(searchMapSearchIndex(index, "Soho", 1, { preferPints: false })[0]?.id).toBe("restaurant");
    expect(searchMapSearchIndex(index, "Soho A Kitchen", 1, { preferPints: true })[0]?.id).toBe("restaurant");
  });

  it("shows literal Hatton matches without unrelated fuzzy venue results", () => {
    const index = buildMapSearchIndex(cities, [{
      cityId: "london",
      venues: [
        { id: "hatton", name: "The Sir Christopher Hatton", area: "Hatton Garden" },
        { id: "chatterton", name: "Chatterton Arms", area: "Bromley" },
        { id: "palm", name: "Palm Riverside | Shisha & Hookah Lounge | Lebanese Restaurant | Cocktail Bar | Wandsworth London", area: "Wandsworth" },
      ],
    }]);

    expect(searchMapSearchIndex(index, "Hatton").map((result) => result.id))
      .toEqual(["hatton"]);
  });

  it("keeps only compact city and venue search fields", () => {
    const index = buildMapSearchIndex(cities, packs);

    expect(index.cities).toEqual([
      { id: "bath", name: "Bath" },
      { id: "london", name: "London" },
    ]);
    expect(index.venues[0]).toEqual({
      id: "venue-bath-crown",
      name: "Crown and Anchor",
      area: "Bath",
      cityId: "bath",
    });
    expect(Object.keys(defined(index.venues[0]))).toEqual(["id", "name", "area", "cityId"]);
  });

  it("ranks an exact name prefix ahead of a fuzzy venue match", () => {
    const index = buildMapSearchIndex(cities, packs);

    expect(searchMapSearchIndex(index, "royal")[0]).toMatchObject({
      id: "venue-bath-royal",
      kind: "venue",
    });
    expect(searchMapSearchIndex(index, "royal")[1]).toMatchObject({
      id: "venue-bath-the-royal",
      kind: "venue",
    });
    expect(defined(searchMapSearchIndex(index, "crwn")[0]).id).toBe("venue-bath-crown");
  });

  it("does not turn Hatton into unrelated venues across city maps", () => {
    const index = buildMapSearchIndex(
      [
        { id: "london", displayName: "London" },
        { id: "manchester", displayName: "Manchester" },
      ],
      [
        {
          cityId: "london",
          venues: [
            { id: "hatton", name: "The Sir Christopher Hatton", area: "Camden" },
            { id: "chatterton", name: "Chatterton Arms", area: "Bromley" },
            { id: "club", name: "Feltham Constitutional Club", area: "Hounslow" },
            { id: "fire-station", name: "Hammersmith Fire Station", area: "Hammersmith and Fulham" },
            { id: "moon", name: "Howl at The Moon", area: "Hackney" },
            {
              id: "lounge",
              name: "Palm Riverside | Shisha & Hookah Lounge | Lebanese Restaurant | Cocktail Bar | Wandsworth London",
              area: "Wandsworth",
            },
          ],
        },
        {
          cityId: "manchester",
          venues: [{ id: "hatters", name: "Hatters Food & Drinks Hall", area: "Manchester" }],
        },
      ],
    );

    expect(searchMapSearchIndex(index, "Hatton").map((result) => result.id)).toEqual(["hatton"]);
  });

  it("keeps spacing aliases and one missing letter without matching distant subsequences", () => {
    const index = buildMapSearchIndex(cities, [{
      cityId: "london",
      venues: [
        { id: "black-friar", name: "The Black Friar", area: "City of London" },
        { id: "crown", name: "The Crown", area: "Camden" },
      ],
    }]);

    expect(searchMapSearchIndex(index, "The Blackfriar").map((result) => result.id)).toEqual(["black-friar"]);
    expect(searchMapSearchIndex(index, "crwn").map((result) => result.id)).toEqual(["crown"]);
  });

  it("ranks an area or city match above venues named for that area", () => {
    const index = buildMapSearchIndex(cities, packs);

    expect(searchMapSearchIndex(index, "bath").slice(0, 2)).toEqual([
      { kind: "city", id: "bath", name: "Bath" },
      {
        kind: "venue",
        id: "venue-bath-crown",
        name: "Crown and Anchor",
        area: "Bath",
        cityId: "bath",
      },
    ]);
  });
});
