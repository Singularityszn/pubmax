// THE BUNDLE CARRIES EVERY PRICE WE HOLD, AND NOT EVERY ROW MAY BE PAINTED.
//
// A coverage answer that leaves the modelled figures out is not a coverage
// answer, so the bundle holds them. A pin that takes its colour from one would
// be a modelled price wearing the authority of an observed one, so the reader
// splits the two. These are the cases that hold that line.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  UK_PRICE_BUNDLE_LANES,
  authoritativeBundleRows,
  bundlePricesForCategory,
  bundleRowSupersedes,
  bundleRowsByVenue,
  ukPriceBundleCollectKey,
  isUkPriceBundleLane,
  isValidUkPriceBundleRow,
  parseUkPriceBundleRows,
  strongestBundleRow,
  type UkPriceBundleRow,
} from "@/lib/ukPriceBundle";
import { defined } from "@/__tests__/helpers/defined";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

const listed: UkPriceBundleRow = {
  venueId: "venue-uk-w1",
  name: "The Crown",
  category: "beer",
  priceGbp: 5.4,
  lane: "site-harvest",
  standing: "listed",
  sourceUrl: "https://thecrown.co.uk/drinks",
  publisher: "thecrown.co.uk",
  observedAt: "2026-09-01T00:00:00.000Z",
  basis: null,
  sampleSize: null,
};

const estimate: UkPriceBundleRow = {
  venueId: "venue-uk-w1",
  name: "The Crown",
  category: "beer",
  priceGbp: 6.1,
  lane: "estimate",
  standing: "estimate",
  sourceUrl: null,
  publisher: null,
  observedAt: "2026-09-03T00:00:00.000Z",
  basis: "regional_baseline:camden",
  sampleSize: 42,
};

describe("what a bundle row owes", () => {
  it("takes a published row carrying its page and its day", () => {
    expect(isValidUkPriceBundleRow(listed)).toBe(true);
  });

  it("accepts bounded explicit servings while preserving unknown volume", () => {
    expect(isValidUkPriceBundleRow({ ...listed, servingSize: "125ml" })).toBe(true);
    expect(isValidUkPriceBundleRow({ ...listed, servingSize: "Btl" })).toBe(true);
    expect(isValidUkPriceBundleRow({ ...listed, servingSize: "" })).toBe(false);
    expect(isValidUkPriceBundleRow({ ...listed, servingSize: "x".repeat(81) })).toBe(false);
    expect(isValidUkPriceBundleRow({ ...listed, servingSize: "\0" })).toBe(false);
    expect(isValidUkPriceBundleRow({ ...listed, servingSize: "125\0ml" })).toBe(false);
    expect(isValidUkPriceBundleRow({ ...listed, servingSize: "125ml\u007f" })).toBe(false);
    expect(parseUkPriceBundleRows([{ ...listed, servingSize: "125\0ml" }])).toEqual([]);
    expect(defined(parseUkPriceBundleRows([{ ...listed, servingSize: "Btl" }])[0]).servingSize).toBe("Btl");
    expect(defined(parseUkPriceBundleRows([listed])[0]).servingSize).toBeUndefined();
  });

  it("keeps same named wine servings in separate collect keys", () => {
    const row = { ...listed, category: "wine", drinkLabel: "House Chardonnay" };
    expect(ukPriceBundleCollectKey({ ...row, servingSize: "125ml" }))
      .not.toBe(ukPriceBundleCollectKey({ ...row, servingSize: "250ml" }));
    expect(ukPriceBundleCollectKey({ ...row, servingSize: "Btl" }))
      .not.toBe(ukPriceBundleCollectKey(row));
  });

  it("refuses a published row with no source, because nobody could check it", () => {
    expect(isValidUkPriceBundleRow({ ...listed, sourceUrl: null })).toBe(false);
    expect(isValidUkPriceBundleRow({ ...listed, sourceUrl: "not a url" })).toBe(false);
  });

  it("refuses any row with no day, because it is a claim about no particular night", () => {
    expect(isValidUkPriceBundleRow({ ...listed, observedAt: "" })).toBe(false);
    expect(isValidUkPriceBundleRow({ ...estimate, observedAt: "whenever" })).toBe(false);
  });

  it("refuses an estimate with no argument behind it", () => {
    expect(isValidUkPriceBundleRow({ ...estimate, basis: null })).toBe(false);
    expect(isValidUkPriceBundleRow({ ...estimate, sampleSize: 0 })).toBe(false);
  });

  it("asks an estimate for no URL, because nobody published it", () => {
    expect(isValidUkPriceBundleRow(estimate)).toBe(true);
  });

  it("drops a bad row rather than failing the whole read", () => {
    expect(parseUkPriceBundleRows([listed, { venueId: "" }, estimate])).toEqual([listed, estimate]);
    expect(parseUkPriceBundleRows("not an array")).toEqual([]);
  });

  it("names its lanes and nothing else", () => {
    expect(UK_PRICE_BUNDLE_LANES).toEqual(["site-harvest", "drink-price-update", "estimate"]);
    expect(isUkPriceBundleLane("guesswork")).toBe(false);
  });
});

describe("which rows a surface may treat as a fact", () => {
  it("withholds retained elderflower and raspberry soda claims misfiled as wine", () => {
    const ledger = readFileSync("data/uk_prices/site_harvest.jsonl", "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const published: UkPriceBundleRow[] = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8"));
    const evidence = [
      ["https://www.spreadeaglewandsworth.co.uk/food-drinks/", 5.4, "Raspberry Elderflower, apple juice, Fever-Tree raspberry & orange blossom soda"],
      ["https://www.kingsarmsoxford.co.uk/food-drink/", 4.85, ".85 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal"],
      ["https://www.owlandpussycatshoreditch.com/food-drink/", 5.5, "Elderflower & Raspberry Cooler Orange Blossom, Raspberry, Elderflower, and Soda"],
      ["https://www.windmillclapham.co.uk/food-drink/", 5.4, ".40 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal"],
      ["https://www.tellersarmsfarnham.co.uk/food-drinks/", 5.15, ".15 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal"],
      ["https://www.groveexmouth.co.uk/food-drink/", 4.85, ".85 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal"],
      ["https://www.whitehart-ford.com/food-drink/", 4.6, "60 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88 kcal"],
      ["https://www.almawandsworth.com/food-drink/", 5.4, "Elderflower & Raspberry Orange blossom, elderflower, raspberry, soda / 88 Kcal"],
      ["https://www.thebullditchling.com/food-drink/", 5.15, ".15 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal"],
      ["https://www.thedukeofwellingtonpub.com/food-and-drinks?menu=spritz", 4, "om, Raspberry, Elderflower, Soda 88kcal Light & Sparkling (AF) Raspberry & Rose"],
      ["https://www.cockandbottlew11.com/food-drink?menu=spritz-menu", 4.45, "om, Raspberry, Elderflower, Soda 88kcal Light & Sparkling (AF) Raspberry & Rose"],
      ["https://www.orangetreerichmond.co.uk/food-drink/", 5.35, ".35 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal"],
      ["https://www.theprideofpaddington.co.uk/food-drink/", 3.95, "50 Elderflower & Raspberry Cooler Orange Blossom, Raspbberry, Elderflower, Soda"],
    ] as const;
    for (const [sourceUrl, priceGbp, drinkLabel] of evidence) {
      const source = ledger.find((row) => row.sourceUrl === sourceUrl && row.category === "wine" && row.priceGbp === priceGbp && row.drinkLabel === drinkLabel);
      expect(source).toBeDefined();
      const row: UkPriceBundleRow = { ...listed, sourceUrl, category: "wine", priceGbp, drinkLabel };
      expect(authoritativeBundleRows([row])).toEqual([]);
      expect(parseUkPriceBundleRows([row])).toEqual([]);
      expect(bundlePricesForCategory([row], "wine").listed).toBeNull();
      expect(published.some((item) => item.lane === "site-harvest" && item.sourceUrl === sourceUrl && item.category === "wine" && item.priceGbp === priceGbp && item.drinkLabel === drinkLabel)).toBe(false);
    }
    const genuine = { ...listed, sourceUrl: evidence[0][0], category: "wine", drinkLabel: "House Chardonnay", priceGbp: 5.4 };
    expect(authoritativeBundleRows([genuine])).toEqual([genuine]);
  });

  it("withholds the six source-ledger rows whose printed drinks contradict their category", () => {
    const ledger = readFileSync("data/uk_prices/site_harvest.jsonl", "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const published: UkPriceBundleRow[] = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8"));
    const evidence = [
      ["https://www.theploughstjohnshill.co.uk/the-bar/", "gin", 9, "0% Tropical Negroni Three Spirit Livener, Lyres Italian Spritz, Tanqueray 0.0%"],
      ["https://www.theploughstjohnshill.co.uk/the-bar/", "shot", 12, "1.50 Picante Spritz Altos Plata tequila, Beesou honey, green chilli, lime, soda"],
      ["https://www.theploughstjohnshill.co.uk/the-bar/", "whisky", 10, "ary Absolut Tabasco Vodka, Tomato Juice, Worcestershire Sauce, Spices, Rosemary"],
      ["https://www.theploughstjohnshill.co.uk/the-bar/", "wine", 5.35, "Pineapple & Yuzu Pineapple, coconut, apple, yuzu, soda 86kcal"],
      ["https://www.theguardhousewoolwich.co.uk/food-and-drink/", "cocktail", 8, "Berry Hugo 0.0% Three Spirit Livener 0.0%, Watermelon, Elderflower, Soda 93kcal"],
      ["https://georgeanddragonacton.co.uk/drinks-menu", "wine", 3, "Frobishers Juice (250ml)"],
    ] as const;
    for (const [sourceUrl, category, priceGbp, drinkLabel] of evidence) {
      const source = ledger.find((row) => row.sourceUrl === sourceUrl && row.category === category && row.priceGbp === priceGbp && row.drinkLabel === drinkLabel);
      expect(source).toBeDefined();
      const row: UkPriceBundleRow = {
        ...listed,
        sourceUrl,
        category,
        priceGbp,
        drinkLabel,
      };
      expect(authoritativeBundleRows([row])).toEqual([]);
      expect(parseUkPriceBundleRows([row])).toEqual([]);
      expect(bundlePricesForCategory([row], category).listed).toBeNull();
      expect(published.some((item) => item.lane === "site-harvest" && item.sourceUrl === sourceUrl && item.category === category && item.priceGbp === priceGbp && item.drinkLabel === drinkLabel)).toBe(false);
    }
    const valid = { ...listed, category: "wine", drinkLabel: "House red wine 175ml", priceGbp: 7.5 };
    expect(authoritativeBundleRows([valid])).toEqual([valid]);
  });

  it("hands an authority lane the published rows and never the modelled ones", () => {
    expect(authoritativeBundleRows([listed, estimate])).toEqual([listed]);
  });

  it("lets a harvested listing beat an estimate for the same pub and drink", () => {
    const decision = strongestBundleRow([estimate, listed], NOW);
    expect(decision.standing).toBe("listed");
    expect(decision.priceGbp).toBe(5.4);
    expect(decision.sourceUrl).toBe("https://thecrown.co.uk/drinks");
  });

  it("falls through to the estimate when the listing has aged out", () => {
    const stale = { ...listed, observedAt: "2024-01-01T00:00:00.000Z" };
    const decision = strongestBundleRow([stale, estimate], NOW);
    expect(decision.standing).toBe("estimate");
    expect(decision.reason).toBe("modelled");
  });

  it("groups rows by the pub they are about", () => {
    const other = { ...listed, venueId: "venue-uk-w2" };
    expect([...bundleRowsByVenue([listed, estimate, other]).keys()]).toEqual([
      "venue-uk-w1",
      "venue-uk-w2",
    ]);
  });
});

// A CRAWL RUNS AGAIN, and the second answer is about tonight while the first is
// about the night it was taken. Cheapest-wins across two readings publishes the
// stale figure and dates it to the day it was cheap.
describe("which of two readings of the same pub and drink the bundle keeps", () => {
  const reading = (observedAt: string, priceGbp: number): UkPriceBundleRow => ({
    ...listed,
    observedAt,
    priceGbp,
  });

  it("takes the first row it is offered", () => {
    expect(bundleRowSupersedes(reading("2026-09-01T00:00:00.000Z", 5.4), undefined)).toBe(true);
  });

  it("lets a later reading raise the price", () => {
    const held = reading("2026-09-01T00:00:00.000Z", 5.4);
    expect(bundleRowSupersedes(reading("2026-09-04T00:00:00.000Z", 6.2), held)).toBe(true);
  });

  it("keeps the later reading when an earlier one is offered again", () => {
    const held = reading("2026-09-04T00:00:00.000Z", 6.2);
    expect(bundleRowSupersedes(reading("2026-09-01T00:00:00.000Z", 5.4), held)).toBe(false);
  });

  it("takes the cheapest line of ONE reading, because a page states many", () => {
    const held = reading("2026-09-04T00:00:00.000Z", 6.2);
    expect(bundleRowSupersedes(reading("2026-09-04T00:00:00.000Z", 5.4), held)).toBe(true);
    expect(bundleRowSupersedes(reading("2026-09-04T00:00:00.000Z", 7.1), held)).toBe(false);
  });
});
// THE READ SIDE PICKS WHAT THE BUILD SIDE KEEPS. While the bundle holds one row
// per pub, drink and lane, cheapest-wins on the way out reaches the same figure
// the builder stored. The day a SECOND listed lane lands for one pub, it stops
// doing that: a stale harvest that happens to be cheaper is quoted over the
// reviewed publish that superseded it, and dated to the night it was cheap.
describe("which price a reader is handed for one pub and one drink", () => {
  const listedRow = (observedAt: string, priceGbp: number): UkPriceBundleRow => ({
    ...listed,
    observedAt,
    priceGbp,
  });

  it("hands the reader the freshest listing, not the cheapest of two dates", () => {
    const stale = listedRow("2026-06-01T00:00:00.000Z", 4.8);
    const fresh = { ...listedRow("2026-09-01T00:00:00.000Z", 6.2), lane: "drink-price-update" as const };
    const picked = bundlePricesForCategory([stale, fresh], "beer");
    expect(picked.listed?.priceGbp).toBe(6.2);
    expect(picked.listed?.observedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("still takes the cheapest line WITHIN one reading, because a page states many", () => {
    const dear = listedRow("2026-09-01T00:00:00.000Z", 6.2);
    const cheap = listedRow("2026-09-01T00:00:00.000Z", 5.4);
    expect(bundlePricesForCategory([dear, cheap], "beer").listed?.priceGbp).toBe(5.4);
    expect(bundlePricesForCategory([cheap, dear], "beer").listed?.priceGbp).toBe(5.4);
  });

  it("agrees with the build side row for row", () => {
    const rows = [
      listedRow("2026-06-01T00:00:00.000Z", 4.8),
      listedRow("2026-09-01T00:00:00.000Z", 6.2),
      listedRow("2026-09-01T00:00:00.000Z", 5.9),
    ];
    const kept = rows.reduce<UkPriceBundleRow | undefined>(
      (held, row) => (bundleRowSupersedes(row, held) ? row : held),
      undefined,
    );
    expect(bundlePricesForCategory(rows, "beer").listed?.priceGbp).toBe(kept?.priceGbp);
  });

  it("gathers a listing and an estimate apart, and re-decides neither", () => {
    const picked = bundlePricesForCategory([estimate, listed], "beer");
    expect(picked.listed?.priceGbp).toBe(5.4);
    expect(picked.estimate?.priceGbp).toBe(6.1);
    expect(picked.estimate?.basis).toBe("regional_baseline:camden");
    expect(strongestBundleRow([estimate, listed], NOW).standing).toBe("listed");
  });

  it("keeps the freshest estimate beside a listing, never the cheaper stale one", () => {
    const stale = { ...estimate, observedAt: "2026-01-01T00:00:00.000Z", priceGbp: 4.2 };
    const picked = bundlePricesForCategory([stale, estimate, listed], "beer");
    expect(picked.estimate?.priceGbp).toBe(6.1);
    expect(picked.estimate?.computedAt).toBe("2026-09-03T00:00:00.000Z");
    expect(picked.listed?.priceGbp).toBe(5.4);
  });

  it("reads only the drink it was asked about", () => {
    const wine = { ...listedRow("2026-09-02T00:00:00.000Z", 9.5), category: "wine" };
    const picked = bundlePricesForCategory([wine, listed], "beer");
    expect(picked.listed?.priceGbp).toBe(5.4);
    expect(bundlePricesForCategory([wine], "beer").listed).toBeNull();
  });
});
