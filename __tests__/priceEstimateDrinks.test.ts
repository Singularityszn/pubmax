import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ESTIMATE_DRINK_CATEGORIES,
  estimateForPub,
  isEstimateBaselines,
  MIN_ESTIMATE_SAMPLE,
  type EstimateBaselines,
} from "@/lib/priceEstimate";
import { standingCarriesAuthority } from "@/lib/priceTier";
import { authoritativeBundleRows, parseUkPriceBundleRows } from "@/lib/ukPriceBundle";

const ROOT = process.cwd();

const region = (code: string, medianGbp: number, sampleSize: number) => ({
  kind: "london_borough" as const,
  code,
  label: code,
  medianGbp,
  sampleSize,
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
      regions: [region("camden", 7.3, 4), region("hounslow", 6.5, 2), region("westminster", 25, 9)],
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
      computedAt: "2026-10-05T00:00:00.000Z",
    });
  });

  it("stay grey outside London, under the sample floor and outside the serving band", () => {
    expect(MIN_ESTIMATE_SAMPLE).toBe(3);
    expect(estimateForPub({ postcode: "M1 1AA" }, baselines, "wine")).toBeNull();
    expect(estimateForPub({ londonBoroughCode: "hounslow" }, baselines, "wine")).toBeNull();
    expect(estimateForPub({ londonBoroughCode: "westminster" }, baselines, "wine")).toBeNull();
    expect(estimateForPub({ londonBoroughCode: "camden" }, baselines, "cocktail")).toBeNull();
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

describe("the shipped wine and cocktail basis", () => {
  const shipped = JSON.parse(
    readFileSync(join(ROOT, "public/data/price_estimates/baselines.json"), "utf8"),
  ) as EstimateBaselines;

  it("is a well-formed artifact that models both drinks", () => {
    expect(isEstimateBaselines(shipped)).toBe(true);
    expect(Object.keys(shipped.drinks ?? {}).sort()).toEqual([...ESTIMATE_DRINK_CATEGORIES].sort());
  });

  it("names its serving, its pages and a sample of at least three pubs for every borough", () => {
    for (const [category, drink] of Object.entries(shipped.drinks ?? {})) {
      expect(drink.servingNote.length, category).toBeGreaterThan(10);
      expect(drink.regions.length, category).toBeGreaterThan(0);
      for (const row of drink.regions) {
        expect(row.kind).toBe("london_borough");
        expect(row.sampleSize).toBeGreaterThanOrEqual(MIN_ESTIMATE_SAMPLE);
        expect(row.medianGbp).toBeGreaterThanOrEqual(drink.minGbp);
        expect(row.medianGbp).toBeLessThanOrEqual(drink.maxGbp);
        expect(row.provenance.length).toBeGreaterThan(0);
        expect(row.sourceUrls?.length).toBeGreaterThan(0);
        for (const url of row.sourceUrls ?? []) expect(url).toMatch(/^https:\/\//);
      }
    }
  });

  it("reaches the bundle as estimate rows that carry basis and sample, and never as authority", () => {
    const rows = parseUkPriceBundleRows(
      JSON.parse(readFileSync(join(ROOT, "public/data/uk_prices/rows.json"), "utf8")),
    );
    const modelled = rows.filter(
      (row) => row.standing === "estimate" && (row.category === "wine" || row.category === "cocktail"),
    );

    expect(modelled.length).toBeGreaterThan(0);
    for (const row of modelled) {
      expect(row.lane).toBe("estimate");
      expect(row.basis).toMatch(/^regional_baseline:[a-z-]+$/);
      expect(row.sampleSize).toBeGreaterThanOrEqual(MIN_ESTIMATE_SAMPLE);
      expect(row.sourceUrl ?? null).toBeNull();
      expect(standingCarriesAuthority(row.standing)).toBe(false);
    }
    expect(authoritativeBundleRows(rows).some((row) => modelled.includes(row))).toBe(false);
  });
});
