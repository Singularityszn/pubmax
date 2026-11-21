// Estimates require a sampled basis and never become price authority.
// The baseline artifact and the UK price bundle are separate evidence sources.

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
import { parseUkBaseShard } from "@/lib/ukBasePubs";
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

  // Every current basis is a London borough. A new postcode-area region or
  // chain changes the supported estimate supply, so this check requires a
  // review of that scope. The neutral city explanation remains accurate.
  it("records the current regional baselines", () => {
    const { chains, regions } = baselines as EstimateBaselines;
    const kinds = [...new Set(regions.map((region) => region.kind))];

    expect(kinds).toEqual(["london_borough"]);
    expect(chains).toEqual([]);
  });

  it("records a qualifying basis for every bundled estimate", () => {
    const boroughCodes = new Set(
      (baselines as EstimateBaselines).regions.map((region) => region.code),
    );
    const estimates = bundleRows.filter((row) => row.standing === "estimate");

    expect(estimates.length).toBeGreaterThan(0);
    for (const row of estimates) {
      const [basisKind, ...parts] = String(row.basis).split(":");
      const basisKey = parts.join(":");
      expect(row.sampleSize, row.venueId).toBeGreaterThanOrEqual(3);
      expect(["regional_baseline", "chain_menu", "nearby", "locality", "postcode_area", "nearest_region", "uk_median"], row.venueId).toContain(basisKind);
      expect(basisKey.length, row.venueId).toBeGreaterThan(0);
      if (basisKind === "regional_baseline") expect(boroughCodes.has(defined(basisKey)), row.venueId).toBe(true);
      if (basisKind === "nearby") expect(basisKey, row.venueId).toBe("2");
      if (basisKind === "postcode_area") expect(basisKey, row.venueId).toMatch(/^[A-Z]{1,2}$/);
      if (basisKind === "nearest_region") expect(basisKey, row.venueId).toMatch(/^[A-Z]{1,2}$/);
      if (basisKind === "uk_median") expect(basisKey, row.venueId).toBe("UK");
    }
    expect(estimates.some((row) => row.venueId.startsWith("venue-mcr-") && row.basis?.startsWith("nearby:"))).toBe(true);
  });

  it("gives every unowned pub a figure in the published base shards", () => {
    const manifest = readJson("public/data/uk_base/manifest.json") as { urlPrefix: string; shards: { id: string }[] };
    let pubs = 0;
    for (const shard of manifest.shards) {
      const body = readJson(`public${manifest.urlPrefix}${shard.id}.json`);
      for (const pub of parseUkBaseShard(body)) {
        if (pub.curatedVenueId || pub.kind === "bar") continue;
        pubs++;
        expect(pub.estimate, pub.id).toBeDefined();
      }
    }
    expect(pubs).toBeGreaterThan(30_000);
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

  it("keeps non-London coverage neutral across listed and estimated prices", () => {
    for (const city of listEnabledCities()) {
      if (city.id === "london") continue;
      expect(getCityCapabilityProfile(city.id).prices.explanation, city.id).toBe(
        "Price coverage varies by place and source.",
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
