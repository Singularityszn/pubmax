import { describe, expect, it } from "vitest";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { NightContext } from "@/lib/nightPlanning";
import {
  planGenerationEvidenceGaps,
  scoreVenueForPlan,
  WETHERSPOONS_DIRECTORY_PREFER_BOOST,
} from "@/lib/planGenerationRanking";

function venue(canonical: boolean, id?: string): ConciergeVenue {
  return {
    id: id ?? (canonical ? "canonical" : "non-canonical"),
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
    },
    nearWater: false,
    hasStory: false,
    canonical,
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
  wetherspoonsPreferred: false,
  atmosphere: [],
  foodNeeds: [],
  accessibility: [],
  transportConstraints: [],
};

describe("Plan generation ranking evidence", () => {
  // £9 at 0.10 km versus £7 at 0.22 km. Daytime distance weight leaves the
  // cheaper glass ahead. After 23:00 the weight is three, so the nearer glass
  // leads. A price weight of 24 would keep the cheaper glass ahead at night.
  function wineWalk(daypart: NightContext["daypart"]) {
    const nearer = venue(true, "nearer-dearer");
    nearer.cheapestPrice = 4;
    const farther = venue(false, "farther-cheaper");
    farther.cheapestPrice = 6;
    const winePrices: ReadonlyMap<string, MapLensPrice> = new Map([
      [nearer.id, { venueId: nearer.id, category: "wine", categoryLabel: "Wine", priceGbp: 9, source: "community" }],
      [farther.id, { venueId: farther.id, category: "wine", categoryLabel: "Wine", priceGbp: 7, source: "community" }],
    ]);
    const context = { ...AFTER_WORK_GROUP, daypart, budget: "value" as const, drinkCategory: "wine" as const };
    return {
      nearer: scoreVenueForPlan(nearer, context, 0.1, [], [], null, undefined, undefined, winePrices),
      farther: scoreVenueForPlan(farther, context, 0.22, [], [], null, undefined, undefined, winePrices),
    };
  }

  it("lets a couple of pounds of wine outrank a short walk in the daytime", () => {
    const scored = wineWalk("daytime");

    expect(scored.farther.score).toBeGreaterThan(scored.nearer.score);
    expect(scored.farther.reasons).toContain("corroborated community wine price £7.00");
    expect(scored.farther.reasons.join(" ")).not.toMatch(/pints from/i);
  });

  it("lets a short walk outrank a couple of pounds of wine once the late distance weight applies", () => {
    const scored = wineWalk("get_home");

    expect(scored.nearer.score).toBeGreaterThan(scored.farther.score);
    expect(scored.nearer.reasons).toContain("corroborated community wine price £9.00");
    expect(scored.nearer.reasons.join(" ")).not.toMatch(/pints from/i);
  });

  it("ranks cheap wine by trusted wine prices rather than pint prices", () => {
    const cheapPint = venue(true, "cheap-pint");
    cheapPint.cheapestPrice = 4;
    const cheapWine = venue(false, "cheap-wine");
    cheapWine.cheapestPrice = 6;
    const winePrices: ReadonlyMap<string, MapLensPrice> = new Map([
      [cheapPint.id, { venueId: cheapPint.id, category: "wine", categoryLabel: "Wine", priceGbp: 9, source: "community" }],
      [cheapWine.id, { venueId: cheapWine.id, category: "wine", categoryLabel: "Wine", priceGbp: 7, source: "community" }],
    ]);
    const context = { ...AFTER_WORK_GROUP, budget: "value" as const, drinkCategory: "wine" as const };

    const pintResult = scoreVenueForPlan(cheapPint, context, 0.5, [], [], null, undefined, undefined, winePrices);
    const wineResult = scoreVenueForPlan(cheapWine, context, 0.5, [], [], null, undefined, undefined, winePrices);

    expect(wineResult.score).toBeGreaterThan(pintResult.score);
    expect(wineResult.reasons).toContain("corroborated community wine price £7.00");
    expect(wineResult.reasons.join(" ")).not.toMatch(/pints from/i);
  });

  it("prefers matching Soft drinks evidence over only Alcohol-free evidence for a value Soft drinks request", () => {
    const alcoholFreeOnly = venue(true, "alcohol-free-only");
    const softDrink = venue(false, "soft-drink");
    const naPrices: ReadonlyMap<string, MapLensPrice> = new Map([
      [alcoholFreeOnly.id, { venueId: alcoholFreeOnly.id, category: "alcohol-free", categoryLabel: "Alcohol-free", priceGbp: 1, source: "community" }],
      [softDrink.id, { venueId: softDrink.id, category: "soft-drink", categoryLabel: "Soft drinks", priceGbp: 3, source: "community" }],
    ]);
    const softPrices: ReadonlyMap<string, MapLensPrice> = new Map([
      [softDrink.id, naPrices.get(softDrink.id)!],
    ]);
    const context = { ...AFTER_WORK_GROUP, budget: "value" as const, zeroProof: true, drinkCategory: "soft-drink" as const };

    const wrong = scoreVenueForPlan(alcoholFreeOnly, context, 0.1, [], [], null, naPrices, undefined, softPrices);
    const matching = scoreVenueForPlan(softDrink, context, 0.22, [], [], null, naPrices, undefined, softPrices);

    expect(matching.score).toBeGreaterThan(wrong.score);
    expect(matching.reasons).toContain("corroborated community soft drinks price £3.00");
    expect(wrong.reasons.join(" ")).not.toMatch(/corroborated|pints from/i);
    expect(matching.reasons.join(" ")).not.toMatch(/alcohol-free price|pints from/i);
  });

  it.each(["beer", "wine", "gin", "whisky", "vodka", "rum", "cocktail"] as const)(
    "keeps %s price authority suppressed under zero-proof",
    (category) => {
      const pub = venue(true);
      const naPrices: ReadonlyMap<string, MapLensPrice> = new Map([
        [pub.id, { venueId: pub.id, category: "alcohol-free", categoryLabel: "Alcohol-free", priceGbp: 8, source: "community" }],
      ]);
      const alcoholicPrices: ReadonlyMap<string, MapLensPrice> = new Map([
        [pub.id, { venueId: pub.id, category, categoryLabel: category, priceGbp: 0.1, source: "community" }],
      ]);
      const context = { ...AFTER_WORK_GROUP, budget: "value" as const, zeroProof: true, drinkCategory: category };

      expect(scoreVenueForPlan(pub, context, 0, [], [], null, naPrices, undefined, alcoholicPrices)).toEqual({
        score: 4,
        reasons: ["corroborated alcohol-free price from £8.00"],
      });
    },
  );

  it("keeps an explicit Soft drinks request neutral without matching price evidence", () => {
    const pub = venue(true);
    pub.amenities.nonAlcoholic = true;
    const wrongCategoryPrices: ReadonlyMap<string, MapLensPrice> = new Map([
      [pub.id, { venueId: pub.id, category: "wine", categoryLabel: "Wine", priceGbp: 1, source: "community" }],
    ]);
    const context = { ...AFTER_WORK_GROUP, budget: "value" as const, zeroProof: true, drinkCategory: "soft-drink" as const };

    expect(scoreVenueForPlan(pub, context, 0, [], [], null, wrongCategoryPrices, undefined, wrongCategoryPrices)).toEqual({
      score: 0,
      reasons: [],
    });
  });

  it.each(["cocktail", "whisky", "gin", "vodka", "rum"] as const)(
    "uses trusted %s prices without falling back to a cheap pint",
    (category) => {
      const priced = venue(true, "priced");
      priced.cheapestPrice = 6;
      const missing = venue(false, "missing");
      missing.cheapestPrice = 3;
      const prices: ReadonlyMap<string, MapLensPrice> = new Map([
        [priced.id, { venueId: priced.id, category, categoryLabel: category, priceGbp: 12, source: "community" }],
      ]);
      const context = { ...AFTER_WORK_GROUP, budget: "value" as const, drinkCategory: category };

      const pricedResult = scoreVenueForPlan(priced, context, 0.5, [], [], null, undefined, undefined, prices);
      const missingResult = scoreVenueForPlan(missing, context, 0.5, [], [], null, undefined, undefined, prices);

      expect(pricedResult.score).toBeGreaterThan(missingResult.score);
      expect(pricedResult.reasons.join(" ")).toContain(`corroborated community ${category === "cocktail" ? "cocktails" : category} price £12.00`);
      expect(missingResult.reasons.join(" ")).not.toMatch(/pints|£/i);
    },
  );

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

  it("soft-boosts a directory-matched Spoons when preferred, without inventing a price", () => {
    const matched = venue(true, "ice-wharf");
    const unmatched = venue(false, "local-indie");
    const matchedIds = new Set(["ice-wharf"]);
    const preferred = { ...AFTER_WORK_GROUP, wetherspoonsPreferred: true };

    const boosted = scoreVenueForPlan(matched, preferred, 0.5, [], [], null, undefined, matchedIds);
    const plain = scoreVenueForPlan(unmatched, preferred, 0.5, [], [], null, undefined, matchedIds);

    expect(boosted.score - plain.score).toBe(WETHERSPOONS_DIRECTORY_PREFER_BOOST);
    expect(boosted.reasons).toContain("matched the first-party J D Wetherspoon directory");
    expect(boosted.reasons.join(" ")).not.toMatch(/£|pence|price/i);
    expect(plain.reasons.join(" ")).not.toMatch(/Wetherspoon/i);
  });

  it("does not boost an unmatched venue, or any venue when prefer is off", () => {
    const matched = venue(true, "ice-wharf");
    const matchedIds = new Set(["ice-wharf"]);

    const preferOff = scoreVenueForPlan(
      matched,
      AFTER_WORK_GROUP,
      0.5,
      [],
      [],
      null,
      undefined,
      matchedIds,
    );
    const preferOnUnmatched = scoreVenueForPlan(
      matched,
      { ...AFTER_WORK_GROUP, wetherspoonsPreferred: true },
      0.5,
      [],
      [],
      null,
      undefined,
      new Set(),
    );

    expect(preferOff.score).toBe(preferOnUnmatched.score);
    expect(preferOff.reasons.join(" ")).not.toMatch(/Wetherspoon/i);
    expect(preferOnUnmatched.reasons.join(" ")).not.toMatch(/Wetherspoon/i);
  });
});

describe("Plan generation evidence gaps", () => {
  const settled = {
    hasDatedWindow: true,
    allOpeningListed: true,
    hasCompletePriceEvidence: false,
    hasTonightEvidence: true,
    hasWeatherEvidence: true,
  };
  const asking: NightContext = {
    ...AFTER_WORK_GROUP,
    budget: "value",
    zeroProof: true,
    accessibility: ["step-free"],
    transportConstraints: ["night-bus"],
    foodNeeds: ["vegan"],
  };

  it.each([
    [false, false, ["venue_accessibility", "per_venue_transport", "zero_proof_options", "food_terminal_specificity", "price_evidence"]],
    [true, false, ["per_venue_transport", "zero_proof_options", "food_terminal_specificity", "price_evidence"]],
    [false, true, ["venue_accessibility", "per_venue_transport", "food_terminal_specificity", "price_evidence"]],
    [true, true, ["per_venue_transport", "food_terminal_specificity", "price_evidence"]],
  ])("drops only the gaps the route already answered (accessibility %s, zero-proof %s)", (accessibilityEnforced, allZeroProofConfirmed, expected) => {
    const { contextEvidenceGaps } = planGenerationEvidenceGaps({
      ...settled,
      context: asking,
      accessibilityEnforced,
      allZeroProofConfirmed,
    });
    expect(contextEvidenceGaps).toEqual(expected);
  });

  it("never reports an answered gap the night did not ask about", () => {
    const { contextEvidenceGaps } = planGenerationEvidenceGaps({
      ...settled,
      hasCompletePriceEvidence: true,
      context: AFTER_WORK_GROUP,
      accessibilityEnforced: true,
      allZeroProofConfirmed: true,
    });
    expect(contextEvidenceGaps).toEqual([]);
  });
});
