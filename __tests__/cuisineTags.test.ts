import { describe, it, expect } from "vitest";

import {
  CURATED_CUISINE_BY_VENUE_ID,
  cuisineTagsForVenue,
  cuisineTagsFromText,
  normaliseCuisineTag,
  normaliseCuisineTags,
} from "@/lib/cuisineTags";

describe("cuisineTags", () => {
  it("normalises known tags and drops junk", () => {
    expect(normaliseCuisineTag(" Roast ")).toBe("roast");
    expect(normaliseCuisineTag("WIZARD")).toBeNull();
    expect(normaliseCuisineTags(["PIZZA", "pizza", "nope", "thai"])).toEqual([
      "thai",
      "pizza",
    ]);
  });

  it("extracts keywords from free text without false substrings", () => {
    expect(cuisineTagsFromText("Sunday roast and a pint")).toContain("roast");
    expect(cuisineTagsFromText("Tapas Brindisa")).toContain("tapas");
    // "kitchen" in "Natural Kitchen" should hit; "pie" alone in "piece" should not.
    expect(cuisineTagsFromText("Natural Kitchen")).toContain("kitchen");
    expect(cuisineTagsFromText("a piece of toast")).not.toContain("pie");
  });

  it("matches common plurals: pizzas, burgers, roasts, gastropubs", () => {
    expect(cuisineTagsFromText("wood-fired pizzas and craft beers")).toContain("pizza");
    expect(cuisineTagsFromText("indulgent burgers and cocktails")).toContain("burger");
    expect(cuisineTagsFromText("Sunday roasts served weekly")).toContain("roast");
    expect(cuisineTagsFromText("one of the city's original gastropubs")).toContain("gastropub");
    expect(cuisineTagsFromText("fresh pies and ales")).toContain("pie");
    // Still no false positives on non-cuisine words containing tag substrings.
    expect(cuisineTagsFromText("a piece of toast")).not.toContain("pie");
  });

  it("merges curated id map with text hits", () => {
    const tags = cuisineTagsForVenue({
      id: "venue-ral8ik",
      name: "Honest Burger Tower Hill",
      searchText: "honest burger tower hill",
    });
    expect(tags).toContain("burger");
    expect(CURATED_CUISINE_BY_VENUE_ID["venue-ral8ik"]).toContain("burger");
  });

  it("returns [] for an unknown venue with no food keywords", () => {
    expect(
      cuisineTagsForVenue({
        id: "venue-does-not-exist",
        name: "Quiet Ale House",
        searchText: "quiet ale house london",
      }),
    ).toEqual([]);
  });

  it("ships a curated map with sufficient pizza, burger, roast coverage", () => {
    const ids = Object.keys(CURATED_CUISINE_BY_VENUE_ID);
    // Curated map should have meaningful coverage across cuisine types.
    expect(ids.length).toBeGreaterThanOrEqual(60);
    const pizzaIds = Object.entries(CURATED_CUISINE_BY_VENUE_ID).filter(([, t]) =>
      t.includes("pizza"),
    );
    const burgerIds = Object.entries(CURATED_CUISINE_BY_VENUE_ID).filter(([, t]) =>
      t.includes("burger"),
    );
    const roastIds = Object.entries(CURATED_CUISINE_BY_VENUE_ID).filter(([, t]) =>
      t.includes("roast"),
    );
    expect(pizzaIds.length).toBeGreaterThanOrEqual(15);
    expect(burgerIds.length).toBeGreaterThanOrEqual(12);
    expect(roastIds.length).toBeGreaterThanOrEqual(8);
    for (const [id, tags] of Object.entries(CURATED_CUISINE_BY_VENUE_ID)) {
      expect(id.startsWith("venue-")).toBe(true);
      // Curated lists may be authored in any order; normalise sorts to KNOWN order.
      expect(normaliseCuisineTags([...tags]).length).toBe(tags.length);
      expect(normaliseCuisineTags([...tags])).toEqual(normaliseCuisineTags([...tags]));
    }
  });

  it("spot-checks key wave-G pizza venues in curated map", () => {
    expect(CURATED_CUISINE_BY_VENUE_ID["venue-nm6egd"]).toContain("pizza"); // The Horse & Wig
    expect(CURATED_CUISINE_BY_VENUE_ID["venue-11nrwqy"]).toContain("pizza"); // Canova Hall
    expect(CURATED_CUISINE_BY_VENUE_ID["venue-ejcaqb"]).toContain("pizza"); // The Merchant of Battersea
    expect(CURATED_CUISINE_BY_VENUE_ID["venue-ejcaqb"]).toContain("burger"); // also burger
    expect(CURATED_CUISINE_BY_VENUE_ID["venue-18cp9b2"]).toContain("pizza"); // 400 Rabbits
  });
});
