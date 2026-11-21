import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectRows } from "../scripts/build_uk_price_bundle.mjs";
import { CITIES } from "../scripts/fetch_city_osm_pubs.mjs";
import { buildUkEstimateModel } from "../scripts/lib/ukEstimateModel.mjs";
import { indexUkBeerEstimates } from "../scripts/lib/ukEstimateProjection.mjs";
import { isSampledPintEstimate, sampledPintEstimateNote } from "../lib/sampledPintEstimate";

describe("UK estimate model", () => {
  it("offers sampled estimates to every eligible curated-city pub, including pubs absent from the UK snapshot", async () => {
    const report = {
      droppedRefusedHost: 0, droppedOtherBranch: 0, droppedDemoFixture: 0,
      droppedUnresolvedVenue: 0, droppedInvalidRow: 0, droppedCategoryContradiction: 0,
      droppedOlderThanOnRecord: 0, pubsWithNoBasis: 0,
    };
    const { rows } = await collectRows(report, "2026-11-21T03:36:22.131Z");
    const estimates = indexUkBeerEstimates(rows);
    const missing: string[] = [];
    for (const city of Object.values(CITIES).filter((entry) => entry.enabled)) {
      const pack = JSON.parse(readFileSync(`public/data/cities/${city.id}/venues_slim.json`, "utf8"));
      for (const pub of pack.rows) {
        if ((!pub.kind || pub.kind === "pub") && pub.cheapestPrice === null && !estimates.has(pub.id)) missing.push(pub.id);
      }
    }
    // The coverage contract requires averages for unpriced pubs, including Dog & Partridge.
    expect(missing).toEqual([]);
    expect(estimates.get("venue-mcr-1ugo1eh")).toMatchObject({ computedAt: "2026-11-21T03:36:22.131Z" });
    expect(estimates.get("venue-mcr-1ugo1eh")!.sampleSize).toBeGreaterThanOrEqual(3);
    expect(report.droppedInvalidRow).toBe(0);
  });
  const samples = [
    { id: "a", lat: 53.480, lng: -2.240, priceGbp: 5, locality: "Manchester", postcode: "M1 1AA" },
    { id: "b", lat: 53.481, lng: -2.241, priceGbp: 6, locality: "Manchester", postcode: "M1 1AB" },
    { id: "c", lat: 53.482, lng: -2.242, priceGbp: 7, locality: "Manchester", postcode: "M1 1AC" },
  ] as const;
  it("uses the median of three nearby pubs", () => {
    expect(buildUkEstimateModel(samples)({ id: "target", lat: 53.48, lng: -2.24 })).toEqual({
      priceGbp: 6, basis: "nearby", sampleSize: 3, detail: 2,
    });
  });
  it("uses a stated locality after the nearby sample falls short", () => {
    expect(buildUkEstimateModel(samples)({ id: "target", lat: 53.55, lng: -2.3, locality: "Manchester" })).toEqual({
      priceGbp: 6, basis: "locality", sampleSize: 3, detail: "Manchester",
    });
  });
  it("uses the postcode area only when the locality is unknown", () => {
    expect(buildUkEstimateModel(samples)({ id: "target", lat: 53.55, lng: -2.3, postcode: "M9 1AA" })).toEqual({
      priceGbp: 6, basis: "postcode_area", sampleSize: 3, detail: "M",
    });
  });
  it("refuses a basis below the sample floor and counts each pub once", () => {
    const model = buildUkEstimateModel([samples[0], samples[0], samples[1]]);
    expect(model({ id: "target", lat: 53.48, lng: -2.24, locality: "Manchester", postcode: "M1 1AA" })).toBeNull();
  });
  it("uses the nearest sampled postcode region for a remote pub", () => {
    const farther = samples.map((sample) => ({ ...sample, id: `far-${sample.id}`, lat: 57, lng: -4, postcode: "IV1 1AA", priceGbp: 8 }));
    expect(buildUkEstimateModel([...farther, ...samples])({ id: "atlantic", lat: 49.91527, lng: -6.31716 })).toEqual({
      priceGbp: 6, basis: "nearest_region", sampleSize: 3, detail: "M",
    });
  });
  it("uses the UK median when no postcode region meets the sample floor", () => {
    const scattered = samples.map((sample, index) => ({ ...sample, postcode: ["M1 1AA", "IV1 1AA", null][index] }));
    expect(buildUkEstimateModel(scattered)({ id: "remote", lat: 49.9, lng: -6.3 })).toEqual({
      priceGbp: 6, basis: "uk_median", sampleSize: 3, detail: "UK",
    });
  });
  it("excludes the target and invalid or duplicate records from the wider bases", () => {
    const model = buildUkEstimateModel([...samples, samples[0], { ...samples[0], id: "invalid", priceGbp: 99 }]);
    expect(model({ id: "a", lat: 49.9, lng: -6.3 })).toBeNull();
  });
  it.each([
    ["nearest_region:M", "Estimate from 3 pubs in the nearest sampled postcode area, M."],
    ["uk_median:UK", "UK average from 3 pubs."],
  ])("carries %s through the bundle projection and sheet explanation", (basis, note) => {
    const input = { venueId: "remote", category: "beer", standing: "estimate", priceGbp: 6, basis, sampleSize: 3, observedAt: "2026-11-21T00:00:00Z" };
    const projected = indexUkBeerEstimates([input]).get("remote");
    expect(projected).toMatchObject({ priceGbp: 6, sampleSize: 3, computedAt: input.observedAt });
    const estimate = { ...input, computedAt: input.observedAt };
    expect(isSampledPintEstimate(estimate)).toBe(true);
    expect(sampledPintEstimateNote(estimate)).toBe(note);
  });
});
