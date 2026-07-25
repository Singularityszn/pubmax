import { describe, expect, it } from "vitest";

import {
  mergeCommunityPriceSignals,
  type PricedVenueSignal,
} from "@/components/map/communityPriceSignals";
import type { CommunityPrice } from "@/lib/communityPrice";

// The one seam that restamps the map. PubMap hands the merged map to the pins,
// the venue list, the route panel and the sheet, so what this function decides
// is what every surface shows. Pin the two things that must never slip:
// freshest-wins (never backwards), and "a logged price is not a Pint Drop".

function price(venueId: string, priceGbp: number, submittedAt: number): CommunityPrice {
  return { venueId, drinkCategory: "beer", priceGbp, submittedAt, source: "community" };
}

function signals(
  entries: Array<[string, PricedVenueSignal]>,
): Map<string, PricedVenueSignal> {
  return new Map(entries);
}

describe("mergeCommunityPriceSignals", () => {
  it("returns the input untouched when there is nothing to merge", () => {
    const input = signals([["v1", { hasPintDrops: true, latestContributorPrice: 5 }]]);
    expect(mergeCommunityPriceSignals(input, new Map())).toBe(input);
  });

  it("restamps a venue with the submitted price without mutating the input", () => {
    const input = signals([["v1", { hasPintDrops: false, latestContributorPrice: null }]]);
    const merged = mergeCommunityPriceSignals(input, new Map([["v1", price("v1", 4.2, 2_000)]]));

    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
    expect(merged.get("v1")?.latestContributorAt).toBe(2_000);
    // Pure: the caller's map is the one React compares against next render.
    expect(input.get("v1")?.latestContributorPrice).toBeNull();
  });

  it("adds a signal for a venue that had none", () => {
    const merged = mergeCommunityPriceSignals(
      signals([]),
      new Map([["v9", price("v9", 6.4, 1_000)]]),
    );
    expect(merged.get("v9")).toEqual({
      hasPintDrops: false,
      latestContributorPrice: 6.4,
      latestContributorAt: 1_000,
    });
  });

  it("yields to a Pint Drop we know is newer, so the map never steps backwards", () => {
    const input = signals([
      ["v1", { hasPintDrops: true, latestContributorPrice: 5.5, latestContributorAt: 9_000 }],
    ]);
    const merged = mergeCommunityPriceSignals(input, new Map([["v1", price("v1", 4.2, 1_000)]]));
    expect(merged.get("v1")?.latestContributorPrice).toBe(5.5);
  });

  it("takes the submission when it is the newer observation", () => {
    const input = signals([
      ["v1", { hasPintDrops: true, latestContributorPrice: 5.5, latestContributorAt: 1_000 }],
    ]);
    const merged = mergeCommunityPriceSignals(input, new Map([["v1", price("v1", 4.2, 9_000)]]));
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("takes the submission when the Pint Drop's age is unknown", () => {
    const input = signals([["v1", { hasPintDrops: true, latestContributorPrice: 5.5 }]]);
    const merged = mergeCommunityPriceSignals(input, new Map([["v1", price("v1", 4.2, 1_000)]]));
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("never lights the has-drops halo - a logged price is not a Pint Drop", () => {
    const merged = mergeCommunityPriceSignals(
      signals([["v1", { hasPintDrops: false, latestContributorPrice: null }]]),
      new Map([["v1", price("v1", 4.2, 2_000)]]),
    );
    expect(merged.get("v1")?.hasPintDrops).toBe(false);
  });

  it("leaves untouched venues exactly as they were", () => {
    const other: PricedVenueSignal = { hasPintDrops: true, latestContributorPrice: 7 };
    const merged = mergeCommunityPriceSignals(
      signals([
        ["v1", { hasPintDrops: false, latestContributorPrice: null }],
        ["v2", other],
      ]),
      new Map([["v1", price("v1", 4.2, 2_000)]]),
    );
    expect(merged.get("v2")).toBe(other);
  });
});
