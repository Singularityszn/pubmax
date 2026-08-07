import { describe, expect, it } from "vitest";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { NightContext } from "@/lib/nightPlanning";
import { planQueryWantsCoffee, scoreVenueForPlan } from "@/lib/planGenerationRanking";

function venue(canonical: boolean, overrides: Partial<ConciergeVenue> = {}): ConciergeVenue {
  const { amenities: amenityOverrides, ...rest } = overrides;
  return {
    id: canonical ? "canonical" : "non-canonical",
    name: canonical ? "Canonical venue" : "Non-canonical venue",
    area: "Camden",
    lat: 51.54,
    lng: -0.14,
    cheapestPrice: null,
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
      ...amenityOverrides,
    },
    nearWater: false,
    hasStory: false,
    canonical,
    ...rest,
  };
}

const AFTER_WORK_GROUP: NightContext = {
  nightArea: "camden",
  daypart: "after_work",
  partyType: "friends",
  groupSize: 8,
  budget: "standard",
  budgetLimitPence: null,
  zeroProof: false,
  atmosphere: [],
  foodNeeds: [],
  accessibility: [],
  transportConstraints: [],
};

const QUIET_DAYTIME: NightContext = {
  ...AFTER_WORK_GROUP,
  daypart: "daytime",
  groupSize: 2,
  atmosphere: ["quiet"],
};

describe("Plan generation ranking evidence", () => {
  it("generates the named alcohol-free drink in the route reason", () => {
    const alcoholFreeVenue = venue(true);
    alcoholFreeVenue.amenities.nonAlcoholic = true;

    const result = scoreVenueForPlan(
      alcoholFreeVenue,
      { ...AFTER_WORK_GROUP, zeroProof: true },
      0.5,
      [],
      [],
      null,
    );

    expect(result.reasons).toContain("confirmed alcohol-free option in the Venue Dataset");
    expect(result.reasons.join(" ")).not.toContain("0.0");
  });

  // A corroborated alcohol-free price is the same trust seam as pint pricing
  // (trustedNoAlcoholLensPrices), so zeroProof ranks it above a venue that
  // only carries the name-match amenity guess.
  it("corroborated-NA venue outranks an amenity-only venue under zeroProof", () => {
    const corroborated = venue(true);
    const amenityOnly = venue(false);
    amenityOnly.amenities.nonAlcoholic = true;
    const naLensPrices: ReadonlyMap<string, MapLensPrice> = new Map([
      [
        corroborated.id,
        {
          venueId: corroborated.id,
          category: "alcohol-free",
          categoryLabel: "Alcohol-free",
          priceGbp: 3,
          source: "community",
        },
      ],
    ]);

    const corroboratedResult = scoreVenueForPlan(
      corroborated,
      { ...AFTER_WORK_GROUP, zeroProof: true },
      0.5,
      [],
      [],
      null,
      naLensPrices,
    );
    const amenityOnlyResult = scoreVenueForPlan(
      amenityOnly,
      { ...AFTER_WORK_GROUP, zeroProof: true },
      0.5,
      [],
      [],
      null,
      naLensPrices,
    );

    expect(corroboratedResult.score).toBeGreaterThan(amenityOnlyResult.score);
    expect(corroboratedResult.reasons.join(" ")).toContain("corroborated alcohol-free price");
  });

  it("does not penalise a venue with neither a corroborated NA price nor the amenity signal, versus an evidence-less peer", () => {
    const neither = venue(true);
    const alsoNeither = venue(false);

    const a = scoreVenueForPlan(neither, { ...AFTER_WORK_GROUP, zeroProof: true }, 0.5, [], [], null);
    const b = scoreVenueForPlan(alsoNeither, { ...AFTER_WORK_GROUP, zeroProof: true }, 0.5, [], [], null);

    expect(a.score).toBe(b.score);
  });

  it("does not let canonical status imply after-work reliability or group capacity", () => {
    const canonical = scoreVenueForPlan(venue(true), AFTER_WORK_GROUP, 0.5, [], [], null);
    const nonCanonical = scoreVenueForPlan(venue(false), AFTER_WORK_GROUP, 0.5, [], [], null);

    expect(canonical.score).toBe(nonCanonical.score);
    expect(canonical.reasons).toEqual(nonCanonical.reasons);
    expect(canonical.reasons.join(" ")).not.toMatch(/reliable after-work|safer pick|bigger group|capacity/i);
  });
});

describe("Quiet occasion soft ranking", () => {
  it("soft-boosts published quiet hours over a garden without loud amenities", () => {
    const withQuietHours = venue(true, { quietHours: "Quieter before 5pm weekdays" });
    const gardenOnly = venue(false, { amenities: { beerGarden: true, cocktails: false, food: false, liveSports: false, liveMusic: false } });

    const quietHoursResult = scoreVenueForPlan(withQuietHours, QUIET_DAYTIME, 0.5, [], [], null);
    const gardenResult = scoreVenueForPlan(gardenOnly, QUIET_DAYTIME, 0.5, [], [], null);

    expect(quietHoursResult.score).toBeGreaterThan(gardenResult.score);
    expect(quietHoursResult.reasons).toContain("published quiet hours on record");
    expect(gardenResult.reasons).toContain("garden without live music or sports");
  });

  it("soft-boosts a garden without live music or sports over bare absence of loud amenities", () => {
    const garden = venue(true, {
      amenities: { beerGarden: true, cocktails: false, food: false, liveSports: false, liveMusic: false },
    });
    const plain = venue(false);

    const gardenResult = scoreVenueForPlan(garden, QUIET_DAYTIME, 0.5, [], [], null);
    const plainResult = scoreVenueForPlan(plain, QUIET_DAYTIME, 0.5, [], [], null);

    expect(gardenResult.score).toBeGreaterThan(plainResult.score);
    expect(plainResult.reasons).toContain("no live music or sports on record");
  });

  it("keeps the live music or sports penalty under a quiet brief", () => {
    const loud = venue(true, {
      amenities: { beerGarden: false, cocktails: false, food: false, liveSports: true, liveMusic: false },
    });
    const calm = venue(false);

    const loudResult = scoreVenueForPlan(loud, QUIET_DAYTIME, 0.5, [], [], null);
    const calmResult = scoreVenueForPlan(calm, QUIET_DAYTIME, 0.5, [], [], null);

    expect(loudResult.score).toBeLessThan(calmResult.score);
    expect(loudResult.reasons).toContain("live music or sports works against a quiet brief");
  });

  it("does not invent quiet reasons when the brief is not quiet", () => {
    const garden = venue(true, {
      amenities: { beerGarden: true, cocktails: false, food: false, liveSports: false, liveMusic: false },
    });
    const result = scoreVenueForPlan(garden, AFTER_WORK_GROUP, 0.5, [], [], null);
    expect(result.reasons.join(" ")).not.toMatch(/quiet hours|garden without live|no live music or sports on record/);
  });
});

describe("Coffee occasion soft ranking", () => {
  it("detects coffee in free-text without inventing a NightContext field", () => {
    expect(planQueryWantsCoffee("coffee and a catch-up in Clapham for 2")).toBe(true);
    expect(planQueryWantsCoffee("quiet afternoon in Clapham for 2, soft drinks")).toBe(false);
    expect(planQueryWantsCoffee("a catch-up in Clapham for 2")).toBe(false);
  });

  it("soft-boosts a venue with a corroborated coffee MapLensPrice when the coffee map is wired", () => {
    const withCoffee = venue(true);
    const without = venue(false);
    const coffeeLensPrices: ReadonlyMap<string, MapLensPrice> = new Map([
      [
        withCoffee.id,
        {
          venueId: withCoffee.id,
          category: "coffee",
          categoryLabel: "Coffee",
          priceGbp: 2.45,
          source: "community",
        },
      ],
    ]);

    const daytime: NightContext = { ...AFTER_WORK_GROUP, daypart: "daytime", groupSize: 2 };
    const boosted = scoreVenueForPlan(withCoffee, daytime, 0.5, [], [], null, undefined, coffeeLensPrices);
    const peer = scoreVenueForPlan(without, daytime, 0.5, [], [], null, undefined, coffeeLensPrices);

    expect(boosted.score).toBeGreaterThan(peer.score);
    expect(boosted.reasons).toContain("corroborated coffee price from £2.45");
    expect(peer.reasons.join(" ")).not.toMatch(/coffee/);
  });

  it("stays neutral on coffee when the coffee map is omitted", () => {
    const withCoffeeId = venue(true);
    const peer = venue(false);
    const a = scoreVenueForPlan(withCoffeeId, { ...AFTER_WORK_GROUP, daypart: "daytime" }, 0.5, [], [], null);
    const b = scoreVenueForPlan(peer, { ...AFTER_WORK_GROUP, daypart: "daytime" }, 0.5, [], [], null);
    expect(a.score).toBe(b.score);
    expect(a.reasons.join(" ")).not.toMatch(/coffee/);
  });

  it("does not invent a coffee price figure in reasons without a MapLensPrice", () => {
    const emptyCoffeeMap: ReadonlyMap<string, MapLensPrice> = new Map();
    const result = scoreVenueForPlan(
      venue(true),
      { ...AFTER_WORK_GROUP, daypart: "daytime" },
      0.5,
      [],
      [],
      null,
      undefined,
      emptyCoffeeMap,
    );
    expect(result.reasons.join(" ")).not.toMatch(/£|coffee price/);
  });
});

describe("Food need honesty", () => {
  it("boosts amenities.food for a food need without inventing cuisine", () => {
    const withFood = venue(true, {
      amenities: { beerGarden: false, cocktails: false, food: true, liveSports: false, liveMusic: false },
    });
    const without = venue(false);
    const context: NightContext = { ...AFTER_WORK_GROUP, foodNeeds: ["food"] };

    const fed = scoreVenueForPlan(withFood, context, 0.5, [], [], null);
    const hungry = scoreVenueForPlan(without, context, 0.5, [], [], null);

    expect(fed.score).toBeGreaterThan(hungry.score);
    expect(fed.reasons).toContain("matched the food need at venue level");
    expect(fed.reasons.join(" ")).not.toMatch(/cuisine|kebab|pizza|halal|vegan/i);
  });
});
