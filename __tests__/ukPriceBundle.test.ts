// THE BUNDLE CARRIES EVERY PRICE WE HOLD, AND NOT EVERY ROW MAY BE PAINTED.
//
// A coverage answer that leaves the modelled figures out is not a coverage
// answer, so the bundle holds them. A pin that takes its colour from one would
// be a modelled price wearing the authority of an observed one, so the reader
// splits the two. These are the cases that hold that line.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { listedCategoryPrices } from "@/lib/listedCategoryPrices";
import { bundleDrinkFieldsFromPrintedName } from "@/lib/bundleDrinkFields";
import { normalizeSiteHarvestLedgerRow } from "@/lib/siteHarvestLedgerCore";

import {
  UK_PRICE_BUNDLE_LANES,
  authoritativeBundleRows,
  bundlePricesForCategory,
  bundleRowSupersedes,
  bundleRowsByVenue,
  ukPriceBundleCollectKey,
  isCategoryQuarantined,
  isUkPriceBundleLane,
  isValidUkPriceBundleRow,
  parseUkPriceBundleRows,
  strongestBundleRow,
  type UkPriceBundleRow,
} from "@/lib/ukPriceBundle";

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
    expect(parseUkPriceBundleRows([{ ...listed, servingSize: "Btl" }])[0].servingSize).toBe("Btl");
    expect(parseUkPriceBundleRows([listed])[0].servingSize).toBeUndefined();
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
  it.each([
    { sourceUrl: "https://thebellonthegreen.com/drinks/", priceGbp: 4, rawLabel: "London Pride 500ml", drinkLabel: "London Pride", servingSize: "500ml" },
    { sourceUrl: "https://thegallimaufry.co.uk/food-drink/", priceGbp: 3, rawLabel: "Ting Grapefruit Soda 330ml", drinkLabel: "Ting Grapefruit Soda", servingSize: "330ml" },
  ])("withholds the normalized wrong-wine claim from $sourceUrl", ({ sourceUrl, priceGbp, rawLabel, drinkLabel, servingSize }) => {
    const raw: UkPriceBundleRow = { ...listed, sourceUrl, category: "wine", priceGbp, drinkLabel: rawLabel };
    const normalized: UkPriceBundleRow = { ...raw, drinkLabel, servingSize };
    for (const claim of [raw, normalized]) {
      expect(isValidUkPriceBundleRow(claim)).toBe(true);
      expect(parseUkPriceBundleRows([claim])).toEqual([]);
      expect(authoritativeBundleRows([claim])).toEqual([]);
      expect(bundlePricesForCategory([claim], "wine").listed).toBeNull();
      expect(listedCategoryPrices([claim], NOW)).toEqual([]);
    }
    const controls: UkPriceBundleRow[] = [
      { ...normalized, sourceUrl: "https://another-pub.example/menu" },
      { ...normalized, priceGbp: priceGbp + 1 },
      { ...normalized, drinkLabel: "House Chardonnay" },
      { ...normalized, servingSize: "175ml" },
      { ...normalized, category: "beer" },
      { ...normalized, lane: "drink-price-update" },
    ];
    expect(parseUkPriceBundleRows(controls)).toEqual(controls);
    expect(authoritativeBundleRows(controls)).toEqual(controls);
  });

  it("withholds seven exact Prospect claims while retaining their audit rows and neighboring drinks", () => {
    const sourceUrl = "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu";
    const now = Date.parse("2026-09-30T12:00:00.000Z");
    const evidence = [
      ["wine", 7.8, "/"],
      ["wine", 11, "### Limoncello Spritz Bright and zesty Isolabella Limoncello, prosecco and soda"],
      ["wine", 11, "#### Aperol Spritz A classic serve of Aperol, prosecco, and soda"],
      ["wine", 11, "Hugo Spritz Fresh and floral St-Germain Elderflower Liqueur, prosecco and soda"],
      ["rum", 9, "savoury and refreshing mix of Clean Co Clean V and Big Tom Spiced Tomato Juice"],
      ["cocktail", 9, "## 0% Espresso Martini The classic coffee cocktail shaken with Clean Co Clean V"],
      ["cocktail", 9, "Zesty and refreshing Clean Co Clean R with Mexican lime, Moroccan mint and soda"],
    ] as const;
    const ledger = readFileSync("data/uk_prices/site_harvest.jsonl", "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    for (const [category, priceGbp, drinkLabel] of evidence) {
      const source = ledger.find((row) => row.sourceUrl === sourceUrl && row.category === category &&
        row.priceGbp === priceGbp && row.drinkLabel === drinkLabel);
      expect(source).toBeDefined();
      const claim: UkPriceBundleRow = { ...listed, sourceUrl, category, priceGbp, drinkLabel,
        observedAt: source.observedAt };
      expect(isValidUkPriceBundleRow(claim)).toBe(true);
      expect(parseUkPriceBundleRows([claim])).toEqual([]);
      expect(authoritativeBundleRows([claim])).toEqual([]);
      expect(bundlePricesForCategory([claim], category).listed).toBeNull();
      expect(listedCategoryPrices([claim], now)).toEqual([]);

      const variants: UkPriceBundleRow[] = [
        { ...claim, sourceUrl: "https://another-pub.example/menu" },
        { ...claim, priceGbp: priceGbp + 1 },
        { ...claim, drinkLabel: "Another printed drink" },
        { ...claim, category: category === "wine" ? "gin" : "wine" },
      ];
      expect(parseUkPriceBundleRows(variants)).toEqual(variants);
      expect(authoritativeBundleRows(variants)).toEqual(variants);
      for (const variant of variants) {
        expect(bundlePricesForCategory([variant], variant.category).listed?.priceGbp)
          .toBe(variant.priceGbp);
        expect(listedCategoryPrices([variant], now)).toEqual([
          expect.objectContaining({ category: variant.category, priceGbp: variant.priceGbp,
            drinkLabel: variant.drinkLabel, sourceUrl: variant.sourceUrl }),
        ]);
      }
    }

    const retainedControls: UkPriceBundleRow[] = [
      { ...listed, sourceUrl, category: "wine", priceGbp: 7.6,
        drinkLabel: "Baron de Ley Reserva Rioja, Spain", lane: "drink-price-update" },
      { ...listed, sourceUrl, category: "cocktail", priceGbp: 10.5,
        drinkLabel: "## Margarita A bold blend of Altos Plata Tequila, Mexican lime and blood orange" },
      { ...listed, sourceUrl, category: "rum", priceGbp: 9 },
    ];
    expect(parseUkPriceBundleRows(retainedControls)).toEqual(retainedControls);
    expect(authoritativeBundleRows(retainedControls)).toEqual(retainedControls);
    for (const neighbor of retainedControls) {
      expect(bundlePricesForCategory([neighbor], neighbor.category).listed?.priceGbp)
        .toBe(neighbor.priceGbp);
      expect(listedCategoryPrices([neighbor], now)).toEqual([
        expect.objectContaining({ category: neighbor.category, priceGbp: neighbor.priceGbp,
          drinkLabel: neighbor.drinkLabel ?? null, sourceUrl }),
      ]);
    }
  });

  it("withholds seven retained category contradictions without removing neighboring claims", () => {
    const evidence = [
      ["https://thebellonthegreen.com/drinks/", "wine", 4, "London Pride 500ml"],
      ["https://thegallimaufry.co.uk/food-drink/", "wine", 3, "Ting Grapefruit Soda 330ml"],
      ["https://thebrownswood.co.uk/drinks-menu/", "beer", 2.6, "~ 1/2 pint Tonic, Slim Tonic, Ginger Ale / Beer-"],
      ["https://thebrownswood.co.uk/drinks-menu/", "rum", 8, "Paloma –"],
      ["https://thebrownswood.co.uk/drinks-menu/", "vodka", 4, "Virgin Bloody Mary AF –"],
      ["https://thebrownswood.co.uk/drinks-menu/", "coffee", 4.3, "Liquors Amaretto Lazzaroni –"],
      ["https://thegallimaufry.co.uk/food-drink/", "cocktail", 6, ".5 Wiper & True · Too Much Fun Guava Peach Pineapple Sour · 5.2% · 440ml"],
    ] as const;
    const ledger = readFileSync("data/uk_prices/site_harvest.jsonl", "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    for (const [sourceUrl, category, priceGbp, drinkLabel] of evidence) {
      expect(ledger.some((item) => item.sourceUrl === sourceUrl && item.category === category &&
        item.priceGbp === priceGbp && item.drinkLabel === drinkLabel)).toBe(true);
      const claim = { ...listed, sourceUrl, category, priceGbp, drinkLabel };
      expect(parseUkPriceBundleRows([claim])).toEqual([]);
      expect(authoritativeBundleRows([claim])).toEqual([]);
      expect(bundlePricesForCategory([claim], category).listed).toBeNull();
      const neighbors = [
        { ...claim, drinkLabel: "Another printed drink" },
        { ...claim, sourceUrl: "https://another-pub.example/menu" },
        { ...claim, priceGbp: priceGbp + 1 },
        { ...claim, category: "other" },
      ];
      expect(parseUkPriceBundleRows(neighbors)).toEqual(neighbors);
    }
    const luckySod = { ...listed, sourceUrl: "https://thebrownswood.co.uk/drinks-menu/",
      category: "whisky", priceGbp: 4.3, drinkLabel: "Lucky Sod –" };
    expect(authoritativeBundleRows([luckySod])).toEqual([luckySod]);
  });

  it("withholds retained Courvoisier cognac misfiled as wine before and after measure normalization", () => {
    const sourceUrl = "https://www.thewhitehartmoreton.co.uk/wine-list";
    const rawDrinkLabel = "\u200b Courvoisier VSOP Cognac 25ml";
    const normalizedDrinkLabel = "\u200b Courvoisier VSOP Cognac";
    const ledger = readFileSync("data/uk_prices/site_harvest.jsonl", "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    const rawSource = ledger.find((row) => row.sourceUrl === sourceUrl && row.category === "wine"
      && row.priceGbp === 3.95 && row.drinkLabel === rawDrinkLabel);
    expect(rawSource).toMatchObject({
      venueId: "venue-uk-w229049090", observedAt: "2026-09-04T13:50:18.415Z",
    });
    if (!rawSource) return;

    const rawClaim: UkPriceBundleRow = {
      ...listed, venueId: rawSource.venueId, name: rawSource.name, category: "wine", priceGbp: 3.95,
      sourceUrl, publisher: "thewhitehartmoreton.co.uk", observedAt: rawSource.observedAt,
      drinkLabel: rawDrinkLabel, ...bundleDrinkFieldsFromPrintedName(rawDrinkLabel, "wine"),
    };
    expect(rawClaim.drinkLabel).toBe(rawDrinkLabel);
    expect(isCategoryQuarantined(rawClaim)).toBe(true);

    const normalizedSource = normalizeSiteHarvestLedgerRow(rawSource);
    expect(normalizedSource).toMatchObject({ drinkLabel: normalizedDrinkLabel, servingSize: "25ml" });
    const normalizedClaim: UkPriceBundleRow = {
      ...rawClaim, ...normalizedSource, lane: "site-harvest", standing: "listed",
      ...bundleDrinkFieldsFromPrintedName(normalizedSource.drinkLabel, "wine"),
    };
    expect(isCategoryQuarantined(normalizedClaim)).toBe(true);
    expect(authoritativeBundleRows([normalizedClaim])).toEqual([]);
    expect(parseUkPriceBundleRows([normalizedClaim])).toEqual([]);
    expect(bundlePricesForCategory([normalizedClaim], "wine").listed).toBeNull();
    expect(listedCategoryPrices([normalizedClaim], Date.parse("2026-09-30T12:00:00.000Z"))).toEqual([]);

    const published: UkPriceBundleRow[] = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8"));
    expect(published.some((row) => row.lane === "site-harvest" && row.sourceUrl === sourceUrl
      && row.category === "wine" && row.priceGbp === 3.95 && row.drinkLabel === rawDrinkLabel)).toBe(false);
    expect(published.some((row) => row.lane === "site-harvest" && row.sourceUrl === sourceUrl
      && row.category === "wine" && row.priceGbp === 3.95 && row.drinkLabel === normalizedDrinkLabel
      && row.servingSize === "25ml")).toBe(false);

    const genuineWineUrl = "https://www.greeneking.co.uk/pubs/greater-london/punch-and-judy/menu";
    const genuineWineLabel = "a classic Rioja, 13.5% glass";
    const genuineWineSource = ledger.find((row) => row.sourceUrl === genuineWineUrl && row.category === "wine"
      && row.priceGbp === 8.2 && row.drinkLabel === genuineWineLabel);
    expect(genuineWineSource).toBeDefined();
    if (!genuineWineSource) return;
    const genuineWine: UkPriceBundleRow = {
      ...listed, venueId: genuineWineSource.venueId, name: genuineWineSource.name, category: "wine",
      priceGbp: 8.2, sourceUrl: genuineWineUrl, publisher: "greeneking.co.uk",
      observedAt: genuineWineSource.observedAt, drinkLabel: genuineWineLabel,
    };
    expect(isCategoryQuarantined(genuineWine)).toBe(false);
    expect(authoritativeBundleRows([genuineWine])).toEqual([genuineWine]);
    expect(parseUkPriceBundleRows([genuineWine])).toEqual([genuineWine]);
    expect(listedCategoryPrices([genuineWine], Date.parse("2026-09-30T12:00:00.000Z")))
      .toEqual([expect.objectContaining({ category: "wine", priceGbp: 8.2, drinkLabel: genuineWineLabel })]);
  });

  it("withholds retained Punch & Judy slash and Spritz claims from wine", () => {
    const sourceUrl = "https://www.greeneking.co.uk/pubs/greater-london/punch-and-judy/menu";
    const evidence = [
      [8.1, "/"],
      [13, "### Limoncello Spritz Bright and zesty Isolabella Limoncello, prosecco and soda"],
      [13, "#### Aperol Spritz A classic serve of Aperol, prosecco, and soda"],
      [13, "Hugo Spritz Fresh and floral St-Germain Elderflower Liqueur, prosecco and soda"],
    ] as const;
    const ledger = readFileSync("data/uk_prices/site_harvest.jsonl", "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    const published: UkPriceBundleRow[] = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8"));
    for (const [priceGbp, drinkLabel] of evidence) {
      expect(ledger.some((row) => row.sourceUrl === sourceUrl && row.category === "wine" && row.priceGbp === priceGbp && row.drinkLabel === drinkLabel)).toBe(true);
      const row: UkPriceBundleRow = { ...listed, sourceUrl, category: "wine", priceGbp, drinkLabel };
      expect(authoritativeBundleRows([row])).toEqual([]);
      expect(parseUkPriceBundleRows([row])).toEqual([]);
      expect(bundlePricesForCategory([row], "wine").listed).toBeNull();
      expect(published.some((item) => item.lane === "site-harvest" && item.sourceUrl === sourceUrl && item.category === "wine" && item.priceGbp === priceGbp && item.drinkLabel === drinkLabel)).toBe(false);
    }
    const genuine: UkPriceBundleRow = { ...listed, sourceUrl, category: "wine", priceGbp: 8.2, drinkLabel: "Baron de Ley Reserva Rioja, Spain" };
    expect(authoritativeBundleRows([genuine])).toEqual([genuine]);
  });

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

describe("Sun Tavern named drinks do not become single-category offers", () => {
  const sourceUrl = "https://www.thesuntavern.co.uk/menu/";
  const observedAt = "2026-09-04T13:44:58.699Z";
  const now = Date.parse("2026-10-01T12:00:00.000Z");
  const evidence = [
    { category: "gin", priceGbp: 7,
      drinkLabel: "sics Umbrella Vesper Grey Goose Vodka, Boatyard Gin, Kina L’Aero, Vichy Catalan" },
    { category: "beer", priceGbp: 8.5,
      drinkLabel: "BELFAST COFFEE Bán Poitín, Cold Brew Coffee, Cream, Demerara, Nutmeg" },
  ] as const;
  const claimFor = (item: (typeof evidence)[number]): UkPriceBundleRow => ({
    ...listed, ...item, venueId: "venue-uk-n1420042285", name: "The Sun Tavern",
    sourceUrl, publisher: "thesuntavern.co.uk", observedAt,
  });

  it("keeps both exact named observations in the raw source ledger", () => {
    const ledger = readFileSync("data/uk_prices/site_harvest.jsonl", "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    for (const item of evidence) {
      expect(ledger).toContainEqual(expect.objectContaining({
        ...item, venueId: "venue-uk-n1420042285", sourceUrl, observedAt,
      }));
    }
  });

  it.each(evidence)("withholds the named $category claim from all eligible price readings", (item) => {
    const claim = claimFor(item);
    expect(isValidUkPriceBundleRow(claim)).toBe(true);
    expect(parseUkPriceBundleRows([claim])).toEqual([]);
    expect(authoritativeBundleRows([claim])).toEqual([]);
    expect(bundlePricesForCategory([claim], item.category).listed).toBeNull();
    expect(listedCategoryPrices([claim], now, { includeBeer: true })).toEqual([]);
  });

  it.each(evidence)("preserves changed signatures beside the exact $category claim", (item) => {
    const claim = claimFor(item);
    // Synthetic controls exercise exact signatures, not new publisher claims.
    const controls: UkPriceBundleRow[] = [
      { ...claim, sourceUrl: "https://another-pub.example/menu" },
      { ...claim, priceGbp: item.priceGbp + 1 },
      { ...claim, drinkLabel: item.category === "gin" ? "Boatyard Gin" : "Guinness pint" },
      { ...claim, category: "cocktail" },
    ];
    for (const control of controls) {
      expect(parseUkPriceBundleRows([control])).toEqual([control]);
      expect(authoritativeBundleRows([control])).toEqual([control]);
      expect(bundlePricesForCategory([control], control.category).listed?.priceGbp)
        .toBe(control.priceGbp);
      expect(listedCategoryPrices([control], now, { includeBeer: true })).toEqual([
        expect.objectContaining({ category: control.category, priceGbp: control.priceGbp,
          drinkLabel: control.drinkLabel, sourceUrl: control.sourceUrl }),
      ]);
    }
  });

  it("keeps unrelated synthetic single-gin and beer fixtures eligible", () => {
    const controls: UkPriceBundleRow[] = [
      { ...listed, category: "gin", drinkLabel: "Sipsmith London Dry Gin" },
      { ...listed, category: "beer", drinkLabel: "London Pride" },
    ];
    expect(parseUkPriceBundleRows(controls)).toEqual(controls);
    expect(authoritativeBundleRows(controls)).toEqual(controls);
    for (const control of controls) {
      expect(bundlePricesForCategory([control], control.category).listed?.priceGbp)
        .toBe(control.priceGbp);
      expect(listedCategoryPrices([control], now, { includeBeer: true })).toEqual([
        expect.objectContaining({ category: control.category, priceGbp: control.priceGbp,
          drinkLabel: control.drinkLabel, sourceUrl: control.sourceUrl }),
      ]);
    }
  });

  it("preserves the three unnamed Sun Tavern spirit observations without inventing a serving", () => {
    const ledger = readFileSync("data/uk_prices/site_harvest.jsonl", "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    for (const category of ["rum", "shot", "whisky"] as const) {
      const raw = ledger.find((row) => row.sourceUrl === sourceUrl && row.category === category
        && row.priceGbp === 10 && row.drinkLabel === undefined);
      expect(raw).toMatchObject({ venueId: "venue-uk-n1420042285", observedAt });
      const claim: UkPriceBundleRow = {
        ...listed, venueId: "venue-uk-n1420042285", name: "The Sun Tavern", category,
        sourceUrl, publisher: "thesuntavern.co.uk", observedAt, priceGbp: 10,
      };
      expect(claim.drinkLabel).toBeUndefined();
      expect(claim.servingSize).toBeUndefined();
      expect(parseUkPriceBundleRows([claim])).toEqual([claim]);
      expect(authoritativeBundleRows([claim])).toEqual([claim]);
      expect(bundlePricesForCategory([claim], category).listed?.priceGbp).toBe(10);
      expect(listedCategoryPrices([claim], now)).toEqual([
        expect.objectContaining({ category, priceGbp: 10, drinkLabel: null, servingSize: null }),
      ]);
    }
  });
});

describe("Albion retained current publisher category contradictions", () => {
  const sourceUrl = "https://www.thealbionpub.com/uploads/drink.pdf?v=1772220206";
  const ledger = readFileSync("data/uk_prices/site_harvest.jsonl", "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  const evidence = [
    { category: "vodka", priceGbp: 11, drinkLabel: "FRANCE/ABV 40% HENNESSY VSOP", servingSize: undefined },
    { category: "vodka", priceGbp: 9.5, drinkLabel: undefined, servingSize: undefined },
    { category: "wine", priceGbp: 6, drinkLabel: "TEQUILA ROSE", servingSize: undefined },
    { category: "shot", priceGbp: 7, drinkLabel: "PIMM’S", servingSize: "25ml" },
  ] as const;
  const claimFor = (item: (typeof evidence)[number]): UkPriceBundleRow => {
    const raw = ledger.find((row) => row.sourceUrl === sourceUrl && row.category === item.category
      && row.priceGbp === item.priceGbp && row.drinkLabel === item.drinkLabel
      && row.servingSize === item.servingSize);
    expect(raw, "Exact governed observation must remain in the complete raw ledger").toBeDefined();
    return { ...listed, ...item, venueId: raw.venueId, name: raw.name, sourceUrl,
      publisher: "thealbionpub.com", observedAt: raw.observedAt };
  };

  it.each(evidence)("withholds exact $category £$priceGbp retained claim from eligible readings", (item) => {
    const claim = claimFor(item);
    const now = Date.parse(claim.observedAt) + 1_000;
    expect(isValidUkPriceBundleRow(claim)).toBe(true);
    expect(parseUkPriceBundleRows([claim])).toEqual([]);
    expect(authoritativeBundleRows([claim])).toEqual([]);
    expect(bundlePricesForCategory([claim], item.category).listed).toBeNull();
    expect(listedCategoryPrices([claim], now)).toEqual([]);
  });

  it.each(evidence)("preserves altered signatures beside retained $category £$priceGbp", (item) => {
    const claim = claimFor(item);
    const now = Date.parse(claim.observedAt) + 1_000;
    // These synthetic controls constrain exact quarantine scope, not publisher facts.
    const controls: UkPriceBundleRow[] = [
      { ...claim, sourceUrl: "https://another-pub.example/menu" },
      { ...claim, priceGbp: item.priceGbp + 1 },
      { ...claim, drinkLabel: "Another printed spirit" },
      { ...claim, category: "gin" },
      ...(item.servingSize ? [{ ...claim, servingSize: "35ml" }] : []),
    ];
    for (const control of controls) {
      expect(parseUkPriceBundleRows([control])).toEqual([control]);
      expect(authoritativeBundleRows([control])).toEqual([control]);
      expect(bundlePricesForCategory([control], control.category).listed?.priceGbp)
        .toBe(control.priceGbp);
      expect(listedCategoryPrices([control], now)).toEqual([
        expect.objectContaining({ category: control.category, priceGbp: control.priceGbp,
          drinkLabel: control.drinkLabel ?? null, servingSize: control.servingSize ?? null,
          sourceUrl: control.sourceUrl, observedAt: control.observedAt }),
      ]);
    }
  });

  it.each([
    { category: "vodka", priceGbp: 9.5, drinkLabel: "GREY GOOSE" },
    { category: "gin", priceGbp: 4, drinkLabel: "GORDONS" },
  ] as const)("keeps genuine named $drinkLabel 25ml eligible", (item) => {
    const raw = ledger.find((row) => row.sourceUrl === sourceUrl && row.category === item.category
      && row.priceGbp === item.priceGbp && row.drinkLabel === item.drinkLabel
      && row.servingSize === "25ml");
    expect(raw).toBeDefined();
    const claim: UkPriceBundleRow = { ...listed, ...item, venueId: raw.venueId, name: raw.name,
      sourceUrl, publisher: "thealbionpub.com", observedAt: raw.observedAt, servingSize: "25ml" };
    const now = Date.parse(claim.observedAt) + 1_000;
    expect(parseUkPriceBundleRows([claim])).toEqual([claim]);
    expect(authoritativeBundleRows([claim])).toEqual([claim]);
    expect(bundlePricesForCategory([claim], item.category).listed?.priceGbp).toBe(item.priceGbp);
    expect(listedCategoryPrices([claim], now)).toEqual([
      expect.objectContaining({ ...item, servingSize: "25ml", sourceUrl, observedAt: claim.observedAt }),
    ]);
    if (item.category === "vodka") {
      const unnamed = claimFor(evidence[1]);
      expect(ukPriceBundleCollectKey(claim)).not.toBe(ukPriceBundleCollectKey(unnamed));
    }
  });

  it("retains all four exact source observations without rewriting the ledger", () => {
    const before = JSON.stringify(ledger);
    for (const item of evidence) {
      const claim = claimFor(item);
      expect(ledger).toContainEqual(expect.objectContaining({
        sourceUrl, category: item.category, priceGbp: item.priceGbp,
        venueId: claim.venueId, observedAt: claim.observedAt,
      }));
      authoritativeBundleRows([claim]);
      parseUkPriceBundleRows([claim]);
    }
    expect(JSON.stringify(ledger)).toBe(before);
  });
});
