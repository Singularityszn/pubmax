import { describe, expect, it } from "vitest";

import {
  countOgCityPriceBands,
  type OgCityPriceBandVenue,
} from "@/lib/ogCityPriceBands.server";
import type { CommunityPrice } from "@/lib/communityPrice";

const now = Date.parse("2026-08-07T20:00:00.000Z");

const venues: OgCityPriceBandVenue[] = [
  { id: "cheap-pub", kind: "pub", cheapestPrice: 4.5 }, // priceBucket → 0
  { id: "mid-pub", kind: "pub", cheapestPrice: 5.8 }, // priceBucket → 1 (London middle third)
  { id: "dear-pub", kind: "pub", cheapestPrice: 9.0 }, // priceBucket → 2
  { id: "famous-bar", kind: "bar", cheapestPrice: 4.0 }, // non-pub anchor, never counted
  { id: "unpriced-pub", kind: "pub", cheapestPrice: null }, // no figure, excluded
];

function corroboratedBeerReport(venueId: string, priceGbp: number): CommunityPrice {
  return {
    venueId,
    drinkCategory: "beer",
    priceGbp,
    submittedAt: now - 60_000,
    source: "community",
    corroborations: 2,
    mapCandidate: {
      priceGbp,
      submittedAt: now - 60_000,
      corroborations: 2,
    },
  };
}

describe("countOgCityPriceBands", () => {
  it.each([
    { id: "venue-1ibgcpd", counts: [1, 0, 0] },
    { id: "venue-mcr-boundary", counts: [0, 1, 0] },
    { id: "venue-uk-n123", counts: [0, 1, 0] },
  ])("uses the city's boundary for baseline and community prices at $id", ({ id, counts }) => {
    expect(countOgCityPriceBands([
      { id, kind: "pub", cheapestPrice: 5.25 },
    ], [], now)).toEqual(counts);
    expect(countOgCityPriceBands([
      { id, kind: "pub", cheapestPrice: 9 },
    ], [corroboratedBeerReport(id, 5.25)], now)).toEqual(counts);
  });

  it("uses each pub's shared priceBucket as the baseline, dropping non-pub anchors and unpriced pubs", () => {
    expect(countOgCityPriceBands(venues, [], now)).toEqual([1, 1, 1]);
  });

  it("lets a corroborated, in-window beer report override its venue's band", () => {
    const communityRows = [corroboratedBeerReport("dear-pub", 4.8)];
    // dear-pub moves from band 2 to band 0.
    expect(countOgCityPriceBands(venues, communityRows, now)).toEqual([2, 1, 0]);
  });

  it("never lets an uncorroborated report move a count", () => {
    const uncorroboratedReport: CommunityPrice = {
      venueId: "dear-pub",
      drinkCategory: "beer",
      priceGbp: 4.8,
      submittedAt: now - 60_000,
      source: "community",
      corroborations: 1,
    };
    expect(countOgCityPriceBands(venues, [uncorroboratedReport], now)).toEqual([
      1, 1, 1,
    ]);
  });

  it("never lets a stale report outside the max-age window move a count", () => {
    const staleCorroboratedReport: CommunityPrice = {
      venueId: "dear-pub",
      drinkCategory: "beer",
      priceGbp: 4.8,
      submittedAt: now - 40 * 24 * 60 * 60 * 1000, // 40 days ago
      source: "community",
      corroborations: 2,
      mapCandidate: {
        priceGbp: 4.8,
        submittedAt: now - 40 * 24 * 60 * 60 * 1000,
        corroborations: 2,
      },
    };
    expect(
      countOgCityPriceBands(venues, [staleCorroboratedReport], now),
    ).toEqual([1, 1, 1]);
  });

  it("ignores a non-beer report entirely", () => {
    const wineReport = corroboratedBeerReport("dear-pub", 4.8);
    wineReport.drinkCategory = "wine";
    expect(countOgCityPriceBands(venues, [wineReport], now)).toEqual([1, 1, 1]);
  });
});
