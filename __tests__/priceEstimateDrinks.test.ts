import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ESTIMATE_DRINK_CATEGORIES,
  estimateForPub,
  isEstimateBaselines,
  MIN_ESTIMATE_OPERATORS,
  MIN_ESTIMATE_SAMPLE,
  type EstimateBaselines,
} from "@/lib/priceEstimate";
import { buildDrinkBaselines, DRINK_MODELS } from "@/scripts/build_price_estimate_baselines.mjs";
import { standingCarriesAuthority } from "@/lib/priceTier";
import { authoritativeBundleRows, parseUkPriceBundleRows } from "@/lib/ukPriceBundle";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

const region = (code: string, medianGbp: number, sampleSize: number, operatorCount = 3) => ({
  kind: "london_borough" as const,
  code,
  label: code,
  medianGbp,
  sampleSize,
  operatorCount,
  provenance: "test",
  sourceUrls: ["https://www.greeneking.co.uk/pubs/greater-london/x/menu"],
});

const baselines: EstimateBaselines = {
  version: 1,
  computedAt: "2026-10-05T00:00:00.000Z",
  method: "test",
  chains: [],
  regions: [],
  drinks: {
    wine: {
      minGbp: 3,
      maxGbp: 12,
      servingNote: "One glass.",
      regions: [
        region("camden", 7.3, 4),
        region("hounslow", 6.5, 2),
        region("westminster", 25, 9),
        region("islington", 7.1, 20, 1),
      ],
    },
    cocktail: {
      minGbp: 4,
      maxGbp: 15,
      servingNote: "One cocktail.",
      regions: [region("camden", 10.5, 5)],
    },
  },
};

describe("wine and cocktail estimates", () => {
  it("model a London pub from its borough, and say how", () => {
    expect(estimateForPub({ londonBoroughCode: "camden" }, baselines, "wine")).toEqual({
      priceGbp: 7.3,
      basis: "regional_baseline",
      basisKey: "camden",
      sampleSize: 4,
      operatorCount: 3,
      computedAt: "2026-10-05T00:00:00.000Z",
    });
  });

  it("stay grey outside London, under the sample or operator floor and outside the serving band", () => {
    expect(MIN_ESTIMATE_SAMPLE).toBe(3);
    expect(MIN_ESTIMATE_OPERATORS).toBe(3);
    expect(estimateForPub({ postcode: "M1 1AA" }, baselines, "wine")).toBeNull();
    expect(estimateForPub({ londonBoroughCode: "hounslow" }, baselines, "wine")).toBeNull();
    expect(estimateForPub({ londonBoroughCode: "westminster" }, baselines, "wine")).toBeNull();
    expect(estimateForPub({ londonBoroughCode: "islington" }, baselines, "wine")).toBeNull();
  });

  it("model a cocktail only for a pub that itself says it serves cocktails", () => {
    expect(
      estimateForPub({ londonBoroughCode: "camden", servesCocktails: true }, baselines, "cocktail")?.priceGbp,
    ).toBe(10.5);
    expect(estimateForPub({ londonBoroughCode: "camden" }, baselines, "cocktail")).toBeNull();
    expect(
      estimateForPub({ londonBoroughCode: "camden", servesCocktails: false }, baselines, "cocktail"),
    ).toBeNull();
    expect(estimateForPub({ londonBoroughCode: "camden" }, baselines, "wine")?.priceGbp).toBe(7.3);
  });

  it("never borrow a chain or a postcode area for a drink that is not beer", () => {
    const withChain: EstimateBaselines = {
      ...baselines,
      chains: [
        {
          id: "greene-king",
          label: "Greene King",
          medianGbp: 6,
          sampleSize: 30,
          operators: ["greene king"],
          hosts: ["greeneking.co.uk"],
          sourceUrls: ["https://www.greeneking.co.uk/"],
        },
      ],
    };
    expect(
      estimateForPub({ operator: "Greene King", londonBoroughCode: null }, withChain, "wine"),
    ).toBeNull();
  });

  it("leave the pint estimate exactly as it was", () => {
    const beer: EstimateBaselines = { ...baselines, regions: [region("camden", 5.5, 8)] };
    expect(estimateForPub({ londonBoroughCode: "camden" }, beer)?.priceGbp).toBe(5.5);
  });
});

describe("the wine and cocktail basis builder", () => {
  const boundaries = JSON.parse(
    readFileSync(join(ROOT, "data/london_boroughs_simplified.json"), "utf8"),
  ) as unknown;
  const wine = defined(DRINK_MODELS.find((model) => model.category === "wine"), "the wine model");
  const sohoPub = (i: number, url: string, priceGbp: number) => ({
    venueKey: `soho pub ${i}|${i} dean street, w1d|${(51.5136 + i * 0.0001).toFixed(5)}|-0.13240`,
    category: "wine",
    priceGbp,
    source: { url, label: "menu" },
  });
  const build = (updates: ReturnType<typeof sohoPub>[], hosts: string[]) =>
    buildDrinkBaselines(updates, new Set(hosts), boundaries, wine, { drinks: {} }).regions;

  it("publishes no borough row from one chain, however many of its pubs it covers", () => {
    const greeneKing = Array.from({ length: 13 }, (_, i) =>
      sohoPub(i, `https://www.greeneking.co.uk/pubs/greater-london/pub-${i}/menu`, 7 + i / 10),
    );
    const hungryHorse = sohoPub(20, "https://www.hungryhorse.co.uk/pubs/london/x/menu", 6.5);

    expect(build([...greeneKing, hungryHorse], ["greeneking.co.uk", "hungryhorse.co.uk"])).toEqual([]);
  });

  it("publishes a borough row from three operators and carries the count", () => {
    const rows = build(
      [
        sohoPub(1, "https://www.greeneking.co.uk/pubs/greater-london/a/menu", 7),
        sohoPub(2, "https://www.greeneking.co.uk/pubs/greater-london/b/menu", 7.4),
        sohoPub(3, "https://www.youngs.co.uk/pubs/c/drinks", 8),
        sohoPub(4, "https://www.thedeanstreetarms.co.uk/drinks", 9),
      ],
      ["greeneking.co.uk", "youngs.co.uk", "thedeanstreetarms.co.uk"],
    );

    expect(rows).toHaveLength(1);
    const row = defined(rows[0], "the Westminster row");
    expect(row).toMatchObject({ code: "westminster", sampleSize: 4, operatorCount: 3, medianGbp: 7.7 });
    expect(row.provenance).toMatch(/^Estimate\. .* 4 pubs run by 3 operators/);
  });
});

describe("the shipped wine and cocktail basis", () => {
  const shipped = JSON.parse(
    readFileSync(join(ROOT, "public/data/price_estimates/baselines.json"), "utf8"),
  ) as EstimateBaselines;

  it("is a well-formed artifact that models both drinks", () => {
    expect(isEstimateBaselines(shipped)).toBe(true);
    expect(Object.keys(shipped.drinks ?? {}).sort()).toEqual([...ESTIMATE_DRINK_CATEGORIES].sort());
  });

  it("names its serving, and its pages, three pubs and three operators for every borough", () => {
    for (const [category, drink] of Object.entries(shipped.drinks ?? {})) {
      expect(drink.servingNote.length, category).toBeGreaterThan(10);
      for (const row of drink.regions) {
        expect(row.kind).toBe("london_borough");
        expect(row.sampleSize).toBeGreaterThanOrEqual(MIN_ESTIMATE_SAMPLE);
        expect(row.operatorCount).toBeGreaterThanOrEqual(MIN_ESTIMATE_OPERATORS);
        expect(row.medianGbp).toBeGreaterThanOrEqual(drink.minGbp);
        expect(row.medianGbp).toBeLessThanOrEqual(drink.maxGbp);
        expect(row.provenance.length).toBeGreaterThan(0);
        expect(row.sourceUrls?.length).toBeGreaterThan(0);
        for (const url of row.sourceUrls ?? []) expect(url).toMatch(/^https:\/\//);
      }
    }
  });

  it("reaches the bundle only as estimate rows that carry basis, sample and operators, and never as authority", () => {
    const rows = parseUkPriceBundleRows(
      JSON.parse(readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8")),
    );
    const modelled = rows.filter(
      (row) => row.standing === "estimate" && (row.category === "wine" || row.category === "cocktail"),
    );
    const shippedRows = (category: "wine" | "cocktail") => shipped.drinks?.[category]?.regions.length ?? 0;

    if (shippedRows("wine") + shippedRows("cocktail") === 0) expect(modelled).toEqual([]);
    for (const row of modelled) {
      expect(row.lane).toBe("estimate");
      expect(row.basis).toMatch(/^regional_baseline:[a-z-]+$/);
      expect(row.sampleSize).toBeGreaterThanOrEqual(MIN_ESTIMATE_SAMPLE);
      expect(row.operatorCount).toBeGreaterThanOrEqual(MIN_ESTIMATE_OPERATORS);
      expect(row.sourceUrl ?? null).toBeNull();
      expect(standingCarriesAuthority(row.standing)).toBe(false);
    }
    expect(authoritativeBundleRows(rows).some((row) => modelled.includes(row))).toBe(false);
  });
});
