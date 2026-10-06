// WHICH CITIES MAY SHOW A MODELLED PINT PRICE, AND WHAT A MODELLED PRICE MAY
// NEVER BUY.
//
// Issue #1362 asked for estimates to be switched on for London plus Manchester,
// Birmingham, Leeds and Bristol. They cannot be switched on, because an estimate
// is not a flag: `lib/priceEstimate.ts` models a pub from a BASIS, and outside
// London no permitted publisher has stated enough pint prices to make one.
// Measured on the shipped artifacts at the time this file landed, a rebuild
// gains 0 pubs in Manchester, 0 in Bristol, 0 in Birmingham and 0 in Leeds.
//
// The temptation that finding creates is to seed a region so the map fills in.
// `scripts/build_price_estimate_baselines.mjs` already forbids that in words;
// this file forbids it in a test, and the alarm below makes the day supply
// really arrives the day somebody has to revisit the capability copy with it.
//
// Birmingham and Leeds are deliberately absent from the per-city sweeps: they
// are not `CityId`s, and `lib/cities.ts` is owned by the night-areas-cities
// lane. When they land there, `listEnabledCities()` picks them up here for free.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import { listEnabledCities } from "@/lib/cities";
import { isoDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { validatePintIndexSnapshot } from "@/lib/pintIndex";
import { isEstimateBaselines, type EstimateBaselines } from "@/lib/priceEstimate";
import { standingCarriesAuthority } from "@/lib/priceTier";
import { authoritativeBundleRows, parseUkPriceBundleRows } from "@/lib/ukPriceBundle";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
}

const baselines = readJson("public/data/price_estimates/baselines.json");
const bundleRows = parseUkPriceBundleRows(readJson("public/data/uk_prices/rows.json"));

describe("the estimate basis a city would need", () => {
  it("is a well-formed baselines artifact, or nothing downstream means anything", () => {
    expect(isEstimateBaselines(baselines)).toBe(true);
  });

  // THE ALARM. Every basis this tree holds is a London borough. The moment a
  // postcode-area region or a chain qualifies, some city outside London can
  // show a modelled figure for the first time, and the sentence
  // `lib/cityCapabilities.ts` prints for that city stops being the whole truth.
  // This fails then, on purpose, so the copy is revisited in the same commit
  // rather than a release later.
  it("covers London and nowhere else, and says so the day that changes", () => {
    const { chains, regions } = baselines as EstimateBaselines;
    const kinds = [...new Set(regions.map((region) => region.kind))];

    expect(kinds).toEqual(["london_borough"]);
    expect(chains).toEqual([]);
  });

  it("holds no estimate row modelled from anywhere but a London borough", () => {
    const boroughCodes = new Set(
      (baselines as EstimateBaselines).regions.map((region) => region.code),
    );
    const estimates = bundleRows.filter((row) => row.standing === "estimate");

    // The bundle is the supply every surface reads, so this is the measurement
    // itself rather than a restatement of the table above: an estimate names
    // the basis it came from, and every one of them names a London borough.
    expect(estimates.length).toBeGreaterThan(0);
    for (const row of estimates) {
      const [basisKind, basisKey] = String(row.basis).split(":");
      expect(basisKind, row.venueId).toBe("regional_baseline");
      expect(boroughCodes.has(defined(basisKey)), `${row.venueId} modelled from ${row.basis}`).toBe(true);
    }
  });
});

describe("what a city's price capability may claim", () => {
  // A COLLECTION DATE IS THE LINE AN ESTIMATE CANNOT CROSS. A modelled figure
  // carries a `computedAt` — the day we did the arithmetic — and never a day
  // anybody collected a price. So a city switched on off the back of the
  // estimate engine would have nothing honest to put in `asOf`, and this is
  // what stops it being switched on anyway.
  it("owes a collection date wherever it claims prices at all", () => {
    for (const city of listEnabledCities()) {
      const prices = getCityCapabilityProfile(city.id).prices;
      if (prices.availability === "unavailable") {
        expect(prices.asOf, city.id).toBeNull();
        continue;
      }
      expect(prices.asOf, city.id).toEqual(expect.any(String));
      expect(Number.isFinite(Date.parse(prices.asOf as string)), city.id).toBe(true);
    }
  });

  it("gives London the dataset's own collection day and no other city one", () => {
    const claiming = listEnabledCities().filter(
      (city) => getCityCapabilityProfile(city.id).prices.availability !== "unavailable",
    );

    expect(claiming.map((city) => city.id)).toEqual(["london"]);
    expect(getCityCapabilityProfile("london").prices.asOf).toBe(isoDate(PINT_DATASET_OBSERVED_AT));
  });

  it("keeps the non-London sentence about COLLECTED prices, which an estimate is not", () => {
    // The wording survives estimates existing, because a modelled figure was
    // never collected from anybody. It would stop being true only if a city
    // gained observed prices, which is the case the sweep above already fails.
    for (const city of listEnabledCities()) {
      if (city.id === "london") continue;
      expect(getCityCapabilityProfile(city.id).prices.explanation, city.id).toBe(
        "We haven't yet collected pint prices for this city.",
      );
    }
  });
});

describe("a modelled figure and the Pint Index", () => {
  it("carries no authority, which is the one gate every authority lane asks", () => {
    expect(standingCarriesAuthority("estimate")).toBe(false);
  });

  it("is dropped by the bundle's own authority reader, over the shipped rows", () => {
    const authoritative = authoritativeBundleRows(bundleRows);

    expect(authoritative.length).toBeGreaterThan(0);
    expect(authoritative.some((row) => row.standing === "estimate")).toBe(false);
    expect(authoritative.some((row) => row.lane === "estimate")).toBe(false);
  });

  // The static half of this fence lives in priceEstimateAuthorityFence.test.ts,
  // which proves lib/pintIndex.ts never imports the engine. This is the
  // behavioural half: even handed one directly, the Index refuses it, because
  // its source vocabulary has three kinds and none of them is a model.
  it("is refused by the snapshot validator as a source the Index may cite", () => {
    const result = validatePintIndexSnapshot({
      schemaVersion: 1,
      snapshotId: "modelled",
      status: "published",
      generatedAt: new Date().toISOString(),
      observationWindow: null,
      classification: { version: "x", method: "point_in_polygon", sourceArtifact: "x", licence: "x" },
      sources: [
        {
          id: "estimate-1",
          kind: "estimate",
          publisher: "PubMaxx price estimate engine",
          sourceUrl: "https://pubmaxxing.com/how-we-estimate",
          licence: null,
        },
      ],
      observations: [],
      excluded: [],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("kind is not public-index eligible")]),
    );
  });
});
