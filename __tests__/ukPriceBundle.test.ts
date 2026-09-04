// THE BUNDLE CARRIES EVERY PRICE WE HOLD, AND NOT EVERY ROW MAY BE PAINTED.
//
// A coverage answer that leaves the modelled figures out is not a coverage
// answer, so the bundle holds them. A pin that takes its colour from one would
// be a modelled price wearing the authority of an observed one, so the reader
// splits the two. These are the cases that hold that line.

import { describe, expect, it } from "vitest";

import {
  UK_PRICE_BUNDLE_LANES,
  authoritativeBundleRows,
  bundleRowsByVenue,
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
