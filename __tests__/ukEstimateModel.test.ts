import { describe, expect, it } from "vitest";
import { buildUkEstimateModel } from "../scripts/lib/ukEstimateModel.mjs";

describe("UK estimate model", () => {
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
});
